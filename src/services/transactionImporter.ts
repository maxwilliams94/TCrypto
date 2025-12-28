type FillMissingPriceResult = { transaction: Transaction, apiCalled: boolean };
import * as fs from 'fs';
import csv from 'csv-parser';
import { Transaction, TransactionType } from '../models/transaction';
import { TransactionStorage } from '../repositories/storage';
import { ExchangeRateService } from './exchangeRateService';
import { FileRepository } from '../repositories/file';
import { CurrencyRateStorage } from '../repositories/currencyRateStorage';
import logger from '../logger';

export async function loadTransactionData(filePath: string, nativeCurrency: string): Promise<Array<Transaction>>{
    const data: Transaction[] = [];
    logger.info(`Loading transactions from file: ${filePath}`);
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', (headers) => {
            const requiredHeaders = ['Id', 'ExchangeId', 'Status', 'Side', 'Market', 'TransactionType', 'Fee', 'FilledQuantity', 'FilledQuote', 'FilledPrice', 'Timestamp'];
            for (let reqHeader of requiredHeaders) {
                if (!headers.includes(reqHeader)) {
                    reject(new Error(`${filePath} does not contain ${reqHeader}`));
                }
            }
            // FeeCurrency is optional but supported if present
        })
        .on('data', (row) => {
            if (row.Status !== 'COMPLETED') return;
            // Import all transaction types including WITHDRAW and DEPOSIT for fee tracking
            const transactionType = mapTransactionType(row.TransactionType);
            if (!transactionType) {
                logger.debug(`Skipping transaction ${row.Id} with unknown type: ${row.TransactionType}`);
                return;
            }
            const price = parseFloat(row.FilledPrice) || 0;
            
            // Normalize Side field for different transaction types
            if (!row.Side && transactionType === 'STAKING_REWARD') {
                row.Side = 'BUY';
            }
            // Clear Side field for WITHDRAW and DEPOSIT (some exchanges incorrectly set Side="DEPOSIT" or "WITHDRAW")
            if (transactionType === 'WITHDRAW' || transactionType === 'DEPOSIT') {
                row.Side = '';
            }
            
            let market_parts = row.Market.split('-');
            if (market_parts.length !== 2) {
                // Handle single-asset markets for rewards, deposits, and withdrawals
                if (row.TransactionType === 'AIRDROP' || row.TransactionType === 'STAKING_REWARD' || 
                    row.TransactionType === 'DEPOSIT' || row.TransactionType === 'WITHDRAW' || row.TransactionType === 'WITHDRAWAL') {
                    market_parts = [market_parts[0], nativeCurrency];
                }
                else {
                    logger.debug(`Skipping transaction ${row.Id} of type ${row.TransactionType} with invalid market format: ${row.Market}`);
                    return;
                }
            }
            const transaction = new Transaction(
                row.ExchangeId || row.Id,
                market_parts[0].trim(),
                market_parts[1].trim(),
                row.Exchange || 'unknown',
                row.Side,
                parseFloat(row.FilledQuantity),
                parseFloat(row.FilledQuote),
                price,
                parseFloat(row.Fee || '0'),
                new Date(row.Timestamp),
                transactionType
            )
            // Allow explicit fee currency from CSV if provided; otherwise default handled downstream
            if (row.FeeCurrency && typeof row.FeeCurrency === 'string') {
                const fc = row.FeeCurrency.trim();
                if (fc) {
                    transaction.feeCurrency = fc;
                }
            }
            data.push(transaction);
        })
        .on('end', () => {
            resolve(data.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime()));
        })
        .on('error', (error) => {
            reject(new Error(`Error reading file ${filePath}: ${error.message}`));
        })
    });
}


export async function importInitialTransactions(storage: TransactionStorage, currencyRateStorage: CurrencyRateStorage, nativeCurrency: string = 'NOK'): Promise<void> {
    let transactionDir = process.env.TRANSACTION_DIR;
    if (!transactionDir) {
        transactionDir = process.cwd();
    }
    
    // Load existing transactions from storage FIRST
    const existingTransactions = await storage.getAll();
    const existingIds = new Set(existingTransactions.map(t => t.id));
    logger.info(`Loaded ${existingTransactions.length} existing transactions from storage`);
    
    logger.info(`Importing transactions from directory: ${transactionDir}`);

    const fs = require('fs');
    const path = require('path');

    try {
        const files: string[] = await new Promise((resolve, reject) => {
            fs.readdir(transactionDir, (err: NodeJS.ErrnoException | null, files: string[]) => {
                if (err) {
                    reject(new Error(`Error reading directory ${transactionDir}: ${err.message}`));
                } else {
                    const csvFiles = files.filter(f => f.endsWith(".csv"));
                    if (csvFiles.length === 0) {
                        reject(new Error(`No CSV files found in directory ${transactionDir}.`));
                    }
                    resolve(csvFiles);
                }
            });
        });

        let newTransactionCount = 0;
        let oldTransactionCount = 0;
        for (const file of files) {
            const filePath = path.join(transactionDir, file);
            let newFileTransactionCount = 0;
            let oldFileTransactionCount = 0;
            try {
                const transactions: Array<Transaction> = await loadTransactionData(filePath, 'NOK');
                
                // Fill in missing prices before processing (with rate limiting)
                const transactionsWithPrices = await fillMissingPricesWithRateLimit(transactions, nativeCurrency, currencyRateStorage);
                
                // Only add transactions that don't already exist
                transactionsWithPrices.forEach((transaction: Transaction) => {
                    if (!existingIds.has(transaction.id)) {
                        storage.add(transaction);
                        existingIds.add(transaction.id);
                        newTransactionCount++;
                        newFileTransactionCount++;
                    } else {
                        oldTransactionCount++;
                        oldFileTransactionCount++;
                    }
                });
                logger.info(`Successfully imported ${newFileTransactionCount} new (${oldFileTransactionCount} existing) transactions and skipped ${oldFileTransactionCount} existing transactions from ${filePath}`);
            } catch (error: any) {
                logger.error(`Error importing transactions from ${filePath}: ${error.message}`);
            }
        }

        const allTransactions = await storage.getAll();
        logger.info(`Transaction import process completed. Added ${newTransactionCount} new transactions. Total: ${allTransactions.length} transactions in the repository.`);
        
        // Populate tax conversions for all transactions (including existing ones)
        if (newTransactionCount > 0 || allTransactions.some(t => !t.hasTaxConversion())) {
            logger.info(`Populating tax conversions for transactions (native currency: ${nativeCurrency})...`);
            await populateTaxConversionsForImport(allTransactions, nativeCurrency, currencyRateStorage);
            logger.info('Tax conversion population complete');
        }
        
        // Flush any pending writes for file-based storage
        if (storage instanceof FileRepository) {
            await storage.flush();
        }
    } catch (error: any) {
        logger.error(error.message);
    }
}

async function fillMissingPricesWithRateLimit(transactions: Transaction[], nativeCurrency: string, currencyRateStorage: CurrencyRateStorage): Promise<Transaction[]> {
    const result: Transaction[] = [];
    const exchangeRateService = new ExchangeRateService(currencyRateStorage);
    
    // Track statistics
    let priceLookupsAttempted = 0;
    let priceLookupsSuccessful = 0;
    let priceLookupsSkipped = 0;
    
    // Process transactions sequentially to respect rate limits (30 requests/minute)
    for (let i = 0; i < transactions.length; i++) {
        const transaction = transactions[i];
        const needsLookup = needsPriceLookup(transaction);
        if (needsLookup) {
            priceLookupsAttempted++;
        } else {
            priceLookupsSkipped++;
        }
        try {
            const { transaction: updatedTransaction, apiCalled } = await fillMissingPrice(transaction, nativeCurrency, exchangeRateService);
            result.push(updatedTransaction);
            if (needsLookup && updatedTransaction.price && updatedTransaction.price > 0) {
                priceLookupsSuccessful++;
            }
            // Only wait if we actually called the API
            if (apiCalled) {
                if (priceLookupsAttempted > 0 && priceLookupsAttempted % 5 === 0) {
                    logger.debug(`Flushing currency rates to disk (processed ${priceLookupsAttempted} lookups)...`);
                    await currencyRateStorage.flush?.();
                }
                await new Promise(resolve => setTimeout(resolve, 2500));
            }
        } catch (error: any) {
            logger.warn(`Error processing transaction ${transaction.id}: ${error.message}`);
            result.push(transaction);
            logger.info('Flushing currency rates after error to preserve successful lookups...');
            await currencyRateStorage.flush?.();
        }
    }
    
    // Final flush to ensure all fetched prices are saved
    logger.debug('Final flush of currency rates...');
    await currencyRateStorage.flush?.();
    
    // Log summary statistics
    if (priceLookupsAttempted) logger.info(`Price lookup summary: ${priceLookupsSuccessful}/${priceLookupsAttempted} successful, ${priceLookupsSkipped} skipped (already have price)`);
    
    return result;
}

function needsPriceLookup(transaction: Transaction): boolean {
    // Only perform price lookup for reward transactions that are missing prices
    // Regular TRADE transactions should already have prices from exchange data
    const hasValidPrice = transaction.price && transaction.price > 0;
    const isRewardWithMissingPrice = transaction.isReward() && !hasValidPrice;
    
    return isRewardWithMissingPrice;
}

async function fillMissingPrice(transaction: Transaction, nativeCurrency: string, exchangeRateService: ExchangeRateService): Promise<FillMissingPriceResult> {
    // Skip if price is already set and not zero
    if (transaction.price && transaction.price > 0) {
        return { transaction, apiCalled: false };
    }

    // Only attempt price lookup for reward transactions (staking rewards, airdrops, etc.)
    // Regular TRADE transactions should already have prices from the exchange
    if (!transaction.isReward()) {
        if (!transaction.price || transaction.price <= 0) {
            logger.warn(`Trade transaction ${transaction.id} is missing price data - this may indicate a CSV data issue`);
        }
        return { transaction, apiCalled: false };
    }

    let apiCalled = false;
    try {
        if (!isFiat(transaction.baseCurrency)) {
            logger.debug(`Looking up price for ${transaction.baseCurrency} on ${transaction.dateTime.toISOString().split('T')[0]} (${transaction.type} reward)`);
            const targetCurrency = isFiat(transaction.quoteCurrency) ? mapStablecoinToFiat(transaction.quoteCurrency) : nativeCurrency;
            // Try to get price from cache via getCryptoPriceInCurrency, but detect if API was called
            let cacheHit = false;
            let cryptoPrice: number | undefined;
            // We'll wrap getCryptoPriceInCurrency to detect cache hit by timing and error handling
            // But since getCryptoPriceInCurrency always checks cache first, we can do a manual cache check here
            const normalizedDate = new Date(transaction.dateTime.getFullYear(), transaction.dateTime.getMonth(), transaction.dateTime.getDate());
            // Use exchangeRateService['rateStorage'] to access cache
            const cachedRate = await exchangeRateService['rateStorage'].getRate(transaction.baseCurrency.toUpperCase(), targetCurrency.toUpperCase(), normalizedDate);
            if (cachedRate) {
                cryptoPrice = cachedRate.price;
                cacheHit = true;
            } else {
                cryptoPrice = await exchangeRateService.getCryptoPriceInCurrency(
                    transaction.baseCurrency,
                    targetCurrency,
                    transaction.dateTime
                );
                cacheHit = false;
            }
            apiCalled = !cacheHit;
            // Default to 0 if undefined
            transaction.price = typeof cryptoPrice === 'number' ? cryptoPrice : 0;
            transaction.quoteSize = transaction.baseSize * (typeof cryptoPrice === 'number' ? cryptoPrice : 0);
            logger.debug(`Price lookup successful: ${transaction.baseCurrency} = ${transaction.price} ${targetCurrency} on ${transaction.dateTime.toISOString().split('T')[0]} (${transaction.type})`);
        }
    } catch (error: any) {
        logger.warn(`Failed to fetch price for ${transaction.baseCurrency} on ${transaction.dateTime.toISOString().split('T')[0]} (${transaction.type}): ${error.message}`);
    }
    return { transaction, apiCalled };
}

function mapTransactionType(type: string): TransactionType | undefined {
    const typeMap: { [key: string]: TransactionType } = {
        'TRADE': 'TRADE',
        'STAKING_REWARD': 'STAKING_REWARD',
        'LENDING_REWARD': 'LENDING_REWARD',
        'AIRDROP': 'AIRDROP',
        'MINING_REWARD': 'MINING_REWARD',
        'FORK': 'FORK',
        'INTERNAL_TRANSFER': 'INTERNAL_TRANSFER',
        'WITHDRAW': 'WITHDRAW',
        'WITHDRAWAL': 'WITHDRAW',  // Support both spellings
        'DEPOSIT': 'DEPOSIT'
    };
    return typeMap[type];
}

function isFiat(currency: string): boolean {
    const upperCurrency = currency.toUpperCase();
    const fiatCurrencies = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'JPY', 'CNY', 'AUD', 'CAD'];
    const stablecoins = ['USDC', 'USDT', 'USDP', 'DAI', 'FRAX', 'BUSD', 'TUSD'];
    return fiatCurrencies.includes(upperCurrency) || stablecoins.includes(upperCurrency);
}

/**
 * Maps stablecoins to their underlying fiat currencies for exchange rate lookups.
 * Stablecoins should be treated as their underlying fiat for Norges Bank API calls.
 */
function mapStablecoinToFiat(currency: string): string {
    const upperCurrency = currency.toUpperCase();
    const stablecoinMap: { [key: string]: string } = {
        'USDC': 'USD',
        'USDT': 'USD',
        'USDP': 'USD',
        'DAI': 'USD',
        'FRAX': 'USD',
        'BUSD': 'USD',
        'TUSD': 'USD'
    };
    return stablecoinMap[upperCurrency] || upperCurrency;
}

/**
 * Populate tax conversion fields for all transactions during import.
 * Only converts transactions that don't already have tax conversions.
 * 
 * @param transactions All transactions to process
 * @param taxCurrency The currency to use for tax calculations
 * @param currencyRateStorage Storage for exchange rates
 */
async function populateTaxConversionsForImport(
    transactions: Transaction[],
    taxCurrency: string,
    currencyRateStorage: CurrencyRateStorage
): Promise<void> {
    const exchangeRateService = new ExchangeRateService(currencyRateStorage);
    
    // Filter transactions that need tax conversion
    const transactionsNeedingConversion = transactions.filter(
        t => !t.hasTaxConversion() || t.taxCurrency !== taxCurrency
    );
    
    if (transactionsNeedingConversion.length === 0) {
        logger.info('All transactions already have tax conversions');
        return;
    }
    
    logger.info(`Converting ${transactionsNeedingConversion.length} transactions to ${taxCurrency}`);
    
    for (const transaction of transactionsNeedingConversion) {
        // Skip if quote currency is already the tax currency
        if (transaction.quoteCurrency === taxCurrency) {
            transaction.setTaxConversion(taxCurrency, 1.0, transaction.dateTime);
            continue;
        }

        try {
            // Skip if quote currency is already the tax currency (case-insensitive check)
            if (transaction.quoteCurrency?.toUpperCase() === taxCurrency?.toUpperCase()) {
                transaction.setTaxConversion(taxCurrency, 1.0, transaction.dateTime);
                continue;
            }
            
            // Fetch exchange rate for quote currency -> tax currency
            let exchangeRate: number;
            const quoteCurrencyForLookup = mapStablecoinToFiat(transaction.quoteCurrency);
            
            if (isFiat(transaction.quoteCurrency)) {
                exchangeRate = await exchangeRateService.getCcyNokRate(quoteCurrencyForLookup, transaction.dateTime);
            } else {
                exchangeRate = await exchangeRateService.getCryptoPriceInCurrency(
                    transaction.quoteCurrency,
                    taxCurrency,
                    transaction.dateTime
                );
            }

            // Determine effective fee currency only if a non-zero fee exists
            let feeConversionRate: number | undefined = undefined;
            let effectiveFeeCurrency: string | undefined = transaction.feeCurrency;
            if ((transaction.fee ?? 0) > 0 && !effectiveFeeCurrency) {
                const fiatInPair = isFiat(transaction.baseCurrency) ? transaction.baseCurrency : (isFiat(transaction.quoteCurrency) ? transaction.quoteCurrency : undefined);
                effectiveFeeCurrency = fiatInPair;
            }

            if ((transaction.fee ?? 0) > 0 && effectiveFeeCurrency && effectiveFeeCurrency?.toUpperCase() !== transaction.quoteCurrency?.toUpperCase()) {
                const feeCurrencyForLookup = mapStablecoinToFiat(effectiveFeeCurrency);
                if (isFiat(effectiveFeeCurrency)) {
                    feeConversionRate = await exchangeRateService.getCcyNokRate(feeCurrencyForLookup, transaction.dateTime);
                } else {
                    feeConversionRate = await exchangeRateService.getCryptoPriceInCurrency(
                        effectiveFeeCurrency,
                        taxCurrency,
                        transaction.dateTime
                    );
                }
                // Record effective fee currency for consistency downstream
                transaction.feeCurrency = effectiveFeeCurrency;
            }

            // Set tax conversion fields, using feeConversionRate if available
            transaction.setTaxConversion(taxCurrency, exchangeRate, transaction.dateTime, feeConversionRate);
            
        } catch (error) {
            logger.warn(
                `Failed to convert transaction ${transaction.id} from ${transaction.quoteCurrency} to ${taxCurrency}: ${error}`
            );
            // Fall back to no conversion (rate of 1.0)
            transaction.setTaxConversion(taxCurrency, 1.0, transaction.dateTime);
        }
    }
}
