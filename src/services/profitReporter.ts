import { TaxReport } from "../models/taxReport";
import { Transaction, isCryptoCryptoTransaction } from "../models/transaction";
import { CurrencyRateStorage } from "../repositories/currencyRateStorage";
import { SellEvent, BuyAllocation } from "../models/sellEvent";
import { Portfolio } from "../models/portfolio";
import { ExchangeRateService } from "./exchangeRateService";

/**
 * Represents a buy transaction and how much of it remains available for FIFO matching
 */
interface BuyPosition {
    transaction: Transaction;
    index: number;
    remainingQuantity: number;
}

export async function generateTaxReport(
    transactions: Transaction[], 
    nativeCurrency: string, 
    periodStart: Date, 
    periodEnd: Date, 
    accountingMethod: string = 'FIFO',
    currencyRateStorage: CurrencyRateStorage
): Promise<TaxReport> {
    const taxReport = new TaxReport(periodStart, periodEnd, nativeCurrency, accountingMethod);

    const exchangeRateService = new ExchangeRateService(currencyRateStorage);

    // Sort transactions chronologically without mutating the original array reference
    const transactionHistory = [...transactions].sort(
        (a, b) => a.dateTime.getTime() - b.dateTime.getTime()
    );

    // Build accounting view with synthetic legs for crypto-crypto trades
    const accountingTransactions = await expandTransactionsForAccounting(
        transactionHistory,
        nativeCurrency,
        exchangeRateService
    );

    taxReport.accountingTransactions = accountingTransactions;

    // Store only the in-scope original transactions for reporting
    taxReport.transactions = transactionHistory.filter(transaction => 
        inScope(transaction.dateTime, periodStart, periodEnd)
    );

    // Always initialize startDate to periodStart; overwrite if transactions exist
    taxReport.startDate = periodStart;
    if (transactionHistory.length > 0) {
        taxReport.startDate = transactionHistory[0].dateTime;
    }

    // Initialize portfolio tracking
    const portfolio = new Portfolio(nativeCurrency);
    taxReport.portfolio = portfolio;

    // Track buy positions for each asset (for FIFO matching)
    const buyPositions: Map<string, BuyPosition[]> = new Map();
    
    // Native currency has infinite supply at zero cost (we don't track fiat buys)
    buyPositions.set(nativeCurrency, []);

    // Process ALL transactions for FIFO matching, but only count profit/fees for in-scope transactions
    for (let i: number = 0; i < accountingTransactions.length; i++) {
        const t = accountingTransactions[i];
        const isInScope = inScope(t.dateTime, periodStart, periodEnd);
        
        console.debug(`${i} ${JSON.stringify(t.toSimpleJSON())} inscope: ${isInScope}`);
        
        // Only add to report metrics if transaction is in the tax period
        if (isInScope) {
            taxReport.assets!.add(t.baseCurrency);
            taxReport.exchanges!.add(t.exchange);
            // Note: fees are now tracked per sell event, not aggregated here
        }
        
        if (t.side === 'BUY') {
            if (isInScope) taxReport.buys!++;
            
            // Add this buy to the position queue for FIFO matching
            if (!buyPositions.has(t.baseCurrency)) {
                buyPositions.set(t.baseCurrency, []);
            }
            buyPositions.get(t.baseCurrency)!.push({
                transaction: t,
                index: i,
                remainingQuantity: t.baseSize
            });
            
            console.debug(`Added buy position for ${t.baseCurrency}: ${t.baseSize} units at index ${i}`);
            
            // Update portfolio: add ALL buys (not just in-scope) to get correct current holdings
            // But mark whether this buy is in the reporting period
            // Skip native currency (fiat) - we only track crypto assets
            if (t.baseCurrency !== nativeCurrency) {
                const position = portfolio.getPosition(t.baseCurrency);
                position.addBuy(t.baseSize, t.getTaxPrice(), t.getTaxFee(), isInScope);
            }
            
        } else if (t.side === 'SELL') {
            if (isInScope) taxReport.sells!++;
            
            const asset = t.baseCurrency;
            if (!buyPositions.has(asset) || buyPositions.get(asset)!.length === 0) {
                console.warn(`No buy found before SELL of ${asset} at ${t.dateTime.toISOString()}. This may indicate incomplete transaction history.`);
                continue;
            }
            
            // Create a sell event to track this sell and its FIFO matching
            const sellEvent = new SellEvent(
                t.id,
                t.dateTime,
                asset,
                t.exchange,
                nativeCurrency,  // Currency for all monetary values
                t.baseSize,
                t.getTaxPrice(),
                t.getTaxFee()
            );
            
            // Match this sell against buy positions using FIFO
            let remainingToSell = t.baseSize;
            const positions = buyPositions.get(asset)!;
            
            while (remainingToSell > 0 && positions.length > 0) {
                const buyPosition = positions[0];
                const quantityToAllocate = Math.min(buyPosition.remainingQuantity, remainingToSell);
                
                // Calculate proportional fee for this allocation
                // If we're using 50% of the buy, we include 50% of the buy fee in the cost basis
                const proportionOfBuy = quantityToAllocate / buyPosition.transaction.baseSize;
                const allocatedBuyFee = buyPosition.transaction.getTaxFee() * proportionOfBuy;
                
                // Cost basis = (price * quantity) + proportional buy fee
                const costBasis = (buyPosition.transaction.getTaxPrice() * quantityToAllocate) + allocatedBuyFee;
                
                const allocation: BuyAllocation = {
                    buyTransactionId: buyPosition.transaction.id,
                    quantity: quantityToAllocate,
                    costBasis: costBasis
                };
                
                sellEvent.addBuyAllocation(allocation, allocatedBuyFee);
                
                console.debug(
                    `FIFO match: Selling ${quantityToAllocate} ${asset} ` +
                    `from buy ${buyPosition.transaction.id} at ${buyPosition.transaction.dateTime.toISOString()} ` +
                    `(buy price: ${buyPosition.transaction.getTaxPrice()}, buy fee: ${allocatedBuyFee.toFixed(2)}, cost basis: ${costBasis.toFixed(2)})`
                );
                
                // Update remaining quantities
                buyPosition.remainingQuantity -= quantityToAllocate;
                remainingToSell -= quantityToAllocate;
                
                // Remove buy position if fully consumed
                if (buyPosition.remainingQuantity <= 0.00000001) { // Use small epsilon for floating point comparison
                    positions.shift();
                    console.debug(`Buy position fully consumed, removed from queue`);
                }
            }
            
            if (remainingToSell > 0.00000001) {
                console.warn(
                    `Sell event ${t.id} could not be fully matched. ` +
                    `${remainingToSell} ${asset} remaining. Transaction history may be incomplete.`
                );
            }
            
            // Only add sell event to report if the sell is within the tax period
            if (isInScope) {
                taxReport.addSellEvent(sellEvent);
                
                // Update portfolio: record the sell with ALL buys (not just in-scope)
                // This ensures holdings are correct, but only in-scope activity is tracked
                // Skip native currency (fiat) - we only track crypto assets
                if (asset !== nativeCurrency) {
                    const position = portfolio.getPosition(asset);
                    position.addSell(
                        sellEvent.totalQuantity,
                        sellEvent.proceeds,
                        sellEvent.totalCostBasis,
                        sellEvent.sellFee,
                        sellEvent.totalBuyFees,  // Buy fees that were realized in this sell
                        isInScope
                    );
                }
                
                console.debug(
                    `Sell event summary: Asset: ${asset}, Quantity: ${sellEvent.totalQuantity}, ` +
                    `Proceeds: ${sellEvent.proceeds.toFixed(2)} ${nativeCurrency}, Cost Basis: ${sellEvent.totalCostBasis.toFixed(2)} ${nativeCurrency}, ` +
                    `Buy Fees: ${sellEvent.totalBuyFees.toFixed(2)} ${nativeCurrency}, Sell Fee: ${sellEvent.sellFee.toFixed(2)} ${nativeCurrency}, ` +
                    `Profit/Loss: ${sellEvent.profitLoss.toFixed(2)} ${nativeCurrency}`
                );
            } else {
                // Sell is out of scope, but we still need to update holdings
                // Skip native currency (fiat) - we only track crypto assets
                if (asset !== nativeCurrency) {
                    const position = portfolio.getPosition(asset);
                    position.addSell(
                        sellEvent.totalQuantity,
                        sellEvent.proceeds,
                        sellEvent.totalCostBasis,
                        sellEvent.sellFee,
                        sellEvent.totalBuyFees,
                        false  // Not in period, don't track as period activity
                    );
                }
            }
        }
    }
    
    return taxReport;
}

function inScope(date: Date, startDate: Date, endDate: Date): boolean {
    return date >= startDate && date <= endDate;
}

async function expandTransactionsForAccounting(
    transactions: Transaction[],
    nativeCurrency: string,
    exchangeRateService: ExchangeRateService
): Promise<Transaction[]> {
    const expanded: Transaction[] = [];
    let sequence = 0;

    for (const original of transactions) {
        await ensureTaxConversion(original, nativeCurrency, exchangeRateService);

        if (isCryptoCryptoTransaction(original)) {
            const quoteToNative = original.taxConversionRate ?? 1;
            const quoteValueNative = original.taxQuoteSize ?? (original.quoteSize * quoteToNative);
            const basePriceNative = original.taxPrice ?? (original.price * quoteToNative);
            const feeNative = original.getTaxFee();

            const sellTx = new Transaction(
                `${original.id}#quote-sell`,
                original.quoteCurrency,
                nativeCurrency,
                original.exchange,
                'SELL',
                original.quoteSize,
                quoteValueNative,
                quoteToNative,
                0,
                original.dateTime,
                original.type,
                original.validator,
                original.epoch,
                original.rewardSource
            );
            sellTx.processingSequence = sequence++;
            sellTx.sourceTransactionId = original.id;
            sellTx.leg = 'QUOTE';
            sellTx.setTaxConversion(nativeCurrency, 1, original.dateTime);

            const buyTx = new Transaction(
                `${original.id}#base-buy`,
                original.baseCurrency,
                nativeCurrency,
                original.exchange,
                'BUY',
                original.baseSize,
                quoteValueNative,
                basePriceNative,
                feeNative,
                original.dateTime,
                original.type,
                original.validator,
                original.epoch,
                original.rewardSource
            );
            buyTx.processingSequence = sequence++;
            buyTx.sourceTransactionId = original.id;
            buyTx.leg = 'BASE';
            buyTx.setTaxConversion(nativeCurrency, 1, original.dateTime);
            buyTx.feeCurrency = nativeCurrency;

            expanded.push(sellTx, buyTx);
        } else {
            original.processingSequence = sequence++;
            original.leg = 'ORIGINAL';
            expanded.push(original);
        }
    }

    return expanded.sort((a, b) => {
        const dateDiff = a.dateTime.getTime() - b.dateTime.getTime();
        if (dateDiff !== 0) {
            return dateDiff;
        }
        const seqA = a.processingSequence ?? 0;
        const seqB = b.processingSequence ?? 0;
        if (seqA !== seqB) {
            return seqA - seqB;
        }
        return a.id.localeCompare(b.id);
    });
}

async function ensureTaxConversion(
    transaction: Transaction,
    nativeCurrency: string,
    exchangeRateService: ExchangeRateService
): Promise<void> {
    if (transaction.hasTaxConversion() && transaction.taxCurrency === nativeCurrency) {
        return;
    }

    try {
        let conversionRate = 1;

        if (transaction.quoteCurrency === nativeCurrency) {
            conversionRate = 1;
        } else if (isFiatCurrency(nativeCurrency) && isFiatCurrency(transaction.quoteCurrency)) {
            conversionRate = await exchangeRateService.getCcyNokRate(
                transaction.quoteCurrency,
                transaction.dateTime
            );
        } else {
            conversionRate = await exchangeRateService.getCryptoPriceInCurrency(
                transaction.quoteCurrency,
                nativeCurrency,
                transaction.dateTime
            );
        }

        transaction.setTaxConversion(nativeCurrency, conversionRate, transaction.dateTime);
    } catch (error) {
        console.warn(
            `Failed to ensure tax conversion for transaction ${transaction.id}: ${error}`
        );
        transaction.setTaxConversion(nativeCurrency, 1, transaction.dateTime);
    }
}

function isFiatCurrency(currency: string): boolean {
    const fiatCurrencies = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'JPY', 'CNY', 'AUD', 'CAD'];
    return fiatCurrencies.includes(currency.toUpperCase());
}
