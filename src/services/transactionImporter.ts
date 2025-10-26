import * as fs from 'fs';
import csv from 'csv-parser';
import { isCryptoCryptoTransaction, Transaction, TransactionType } from '../models/transaction';
import { TransactionStorage } from '../repositories/storage';
import { ExchangeRateService } from './exchangeRateService';
import { FileRepository } from '../repositories/file';
import { CurrencyRateStorage } from '../repositories/currencyRateStorage';

export async function loadTransactionData(filePath: string, nativeCurrency: string): Promise<Array<Transaction>>{
    const data: Transaction[] = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', (headers) => {
            for (let reqHeader of ['Id', 'Status', 'Market', 'TransactionType', 'Fee', 'FilledQuantity', 'FilledQuote', 'FilledPrice', 'Filled At'])
            if (!headers.includes(reqHeader)) {
                reject(new Error(`${filePath} does not contain ${reqHeader}`));
            }
        })
        .on('data', (row) => {
            if (row.Status !== 'FILLED') return;
            const transactionType = mapTransactionType(row.TransactionType);
            const price = parseFloat(row.FilledPrice) || 0;
            
            const transaction = new Transaction(
                row.Id,
                row.Market.split('-')[0].trim(),
                row.Market.split('-')[1].trim(),
                row.Exchange || 'unknown',
                row.Side,
                parseFloat(row.FilledQuantity),
                parseFloat(row.FilledQuote),
                price,
                parseFloat(row.Fee || '0'),
                new Date(row['Filled At']),
                transactionType,
                row.Validator,
                row.Epoch ? parseInt(row.Epoch) : undefined,
                row.RewardSource
            )
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
    console.info(`Loaded ${existingTransactions.length} existing transactions from storage`);
    
    console.info("Importing transactions from directory:", transactionDir);

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
        for (const file of files) {
            const filePath = path.join(transactionDir, file);
            try {
                const transactions: Array<Transaction> = await loadTransactionData(filePath, 'NOK');
                
                // Fill in missing prices before processing (with rate limiting)
                const transactionsWithPrices = await fillMissingPricesWithRateLimit(transactions, nativeCurrency, currencyRateStorage);
                
                const splitTransactions = await Promise.all(
                    transactionsWithPrices.map(async (transaction: Transaction) => await splitCryptoCryptoTransaction(transaction, nativeCurrency, currencyRateStorage))
                );
                
                // Only add transactions that don't already exist
                splitTransactions.flat().forEach((transaction: Transaction) => {
                    if (!existingIds.has(transaction.id)) {
                        storage.add(transaction);
                        existingIds.add(transaction.id);
                        newTransactionCount++;
                    }
                });
                console.log(`Successfully imported transactions from ${filePath}`);
            } catch (error: any) {
                console.error(`Error importing transactions from ${filePath}: ${error.message}`);
            }
        }

        const allTransactions = await storage.getAll();
        console.info(`Transaction import process completed. Added ${newTransactionCount} new transactions. Total: ${allTransactions.length} transactions in the repository.`);
        
        // Flush any pending writes for file-based storage
        if (storage instanceof FileRepository) {
            await storage.flush();
        }
    } catch (error: any) {
        console.error(error.message);
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
            const updatedTransaction = await fillMissingPrice(transaction, nativeCurrency, exchangeRateService);
            result.push(updatedTransaction);
            
            // Check if price was successfully updated
            if (needsLookup && updatedTransaction.price && updatedTransaction.price > 0) {
                priceLookupsSuccessful++;
            }
            
            // Add delay if we made an API call (only for transactions that needed price lookup)
            if (needsLookup) {
                // Flush currency rates every 5 successful lookups to ensure we don't lose fetched prices
                if (priceLookupsAttempted > 0 && priceLookupsAttempted % 5 === 0) {
                    console.log(`Flushing currency rates to disk (processed ${priceLookupsAttempted} lookups)...`);
                    await currencyRateStorage.flush?.();
                }
                
                // Wait 2.5 seconds between API calls to stay under 30/minute limit (with some buffer)
                await new Promise(resolve => setTimeout(resolve, 2500));
            }
        } catch (error: any) {
            console.warn(`Error processing transaction ${transaction.id}: ${error.message}`);
            result.push(transaction); // Add original transaction even if price lookup failed
            
            // Flush currency rates even on error to save any successful lookups that happened before the error
            console.log('Flushing currency rates after error to preserve successful lookups...');
            await currencyRateStorage.flush?.();
        }
    }
    
    // Final flush to ensure all fetched prices are saved
    console.log('Final flush of currency rates...');
    await currencyRateStorage.flush?.();
    
    // Log summary statistics
    console.log(`Price lookup summary: ${priceLookupsSuccessful}/${priceLookupsAttempted} successful, ${priceLookupsSkipped} skipped (already have price)`);
    
    return result;
}

function needsPriceLookup(transaction: Transaction): boolean {
    // Only perform price lookup for reward transactions that are missing prices
    // Regular TRADE transactions should already have prices from exchange data
    const hasValidPrice = transaction.price && transaction.price > 0;
    const isRewardWithMissingPrice = transaction.isReward() && !hasValidPrice;
    
    return isRewardWithMissingPrice;
}

async function fillMissingPrice(transaction: Transaction, nativeCurrency: string, exchangeRateService: ExchangeRateService): Promise<Transaction> {
    // Skip if price is already set and not zero
    if (transaction.price && transaction.price > 0) {
        return transaction;
    }

    // Only attempt price lookup for reward transactions (staking rewards, airdrops, etc.)
    // Regular TRADE transactions should already have prices from the exchange
    if (!transaction.isReward()) {
        // Log a warning if a trade has missing price - this might indicate data quality issues
        if (!transaction.price || transaction.price <= 0) {
            console.warn(`Trade transaction ${transaction.id} is missing price data - this may indicate a CSV data issue`);
        }
        return transaction;
    }

    try {
        // Check if the base currency is a cryptocurrency that needs price lookup
        if (!isFiat(transaction.baseCurrency)) {
            console.log(`Looking up price for ${transaction.baseCurrency} on ${transaction.dateTime.toISOString().split('T')[0]} (${transaction.type} reward)`);
            
            // Get crypto price in the quote currency (or native currency if quote is also crypto)
            const targetCurrency = isFiat(transaction.quoteCurrency) ? transaction.quoteCurrency : nativeCurrency;
            const cryptoPrice = await exchangeRateService.getCryptoPriceInCurrency(
                transaction.baseCurrency, 
                targetCurrency, 
                transaction.dateTime
            );
            
            // Update the transaction with the fetched price
            transaction.price = cryptoPrice;
            transaction.quoteSize = transaction.baseSize * cryptoPrice;
            transaction.quoteSizeNative = transaction.quoteSize;
            transaction.nativeCurrency = targetCurrency;
            
            console.log(`Price lookup successful: ${transaction.baseCurrency} = ${cryptoPrice} ${targetCurrency} on ${transaction.dateTime.toISOString().split('T')[0]} (${transaction.type})`);
            
            // Note: ExchangeRateService already handles caching internally and flushes when needed
            // The rate storage will be flushed by the calling function to ensure persistence
        }
    } catch (error: any) {
        console.warn(`Failed to fetch price for ${transaction.baseCurrency} on ${transaction.dateTime.toISOString().split('T')[0]} (${transaction.type}): ${error.message}`);
        // Continue with the original transaction even if price lookup fails
    }

    return transaction;
}

async function splitCryptoCryptoTransaction(transaction: Transaction, nativeCurrency: string, currencyRateStorage: CurrencyRateStorage): Promise<Transaction[]> {
    if (!isCryptoCryptoTransaction(transaction)) return [transaction];

    //split the transaction into two transactions as we must consider the quote currency as being sold
    const exchangeRateService = new ExchangeRateService(currencyRateStorage);
    const exchangeRate: number = await exchangeRateService.getCcyNokRate(transaction.quoteCurrency, transaction.dateTime)
    console.log("Exchange rate for", transaction.quoteCurrency, "on", transaction.dateTime, "is", exchangeRate);
    const sellTransaction = new Transaction(
        transaction.id + '-sell',
        transaction.quoteCurrency,
        nativeCurrency!,
        transaction.exchange,
        "SELL",
        transaction.quoteSize,
        transaction.quoteSize * exchangeRate,
        exchangeRate,
        0,
        transaction.dateTime);
    const buyTransaction = new Transaction(
        transaction.id + '-buy',
        transaction.baseCurrency,
        nativeCurrency!,
        transaction.exchange,
        "BUY",
        transaction.baseSize,
        transaction.quoteSize * exchangeRate,
        transaction.price * exchangeRate,
        transaction.fee * exchangeRate,
        transaction.dateTime
    );
    console.log("Split transaction into:", sellTransaction.toSimpleJSON(), buyTransaction.toSimpleJSON());
    return [sellTransaction, buyTransaction];
}

function mapTransactionType(type: string): TransactionType {
    const typeMap: { [key: string]: TransactionType } = {
        'TRADE': 'TRADE',
        'STAKING_REWARD': 'STAKING_REWARD',
        'LENDING_REWARD': 'LENDING_REWARD',
        'AIRDROP': 'AIRDROP',
        'MINING_REWARD': 'MINING_REWARD',
        'FORK': 'FORK',
        'TRANSFER_IN': 'TRANSFER_IN',
        'TRANSFER_OUT': 'TRANSFER_OUT'
    };
    return typeMap[type];
}

function isFiat(currency: string): boolean {
    const fiatCurrencies = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'JPY', 'CNY', 'AUD', 'CAD'];
    return fiatCurrencies.includes(currency.toUpperCase());
}

