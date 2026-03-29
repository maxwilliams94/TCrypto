import logger from '../logger';
import { TaxReport } from "../models/taxReport";
import { Transaction, isCryptoCryptoTransaction } from "../models/transaction";
import { CurrencyRateStorage } from "../repositories/currencyRateStorage";
import { SellEvent, BuyAllocation } from "../models/sellEvent";
import { Portfolio } from "../models/portfolio";
import { ExchangeRateService } from "./exchangeRateService";
import {
    AccountingStrategy,
    BuyLot,
    LotSelectionContext,
    calculateCostBasisPerUnit,
    calculateProportionalCostBasis,
    resolveStrategy
} from "./accountingStrategy";

/**
 * Re-export BuyLot as the position type used internally.
 * Previously this was a local BuyPosition interface; now it's the shared BuyLot
 * from accountingStrategy.ts so strategies can operate on it.
 */
type BuyPosition = BuyLot;

export interface TaxReportOptions {
    /** Accounting method to use for lot selection (default: 'FIFO') */
    accountingMethod?: string;
    /** When true, lot consumption is recorded on buy transactions for persistence.
     *  When false (default), the report is a preview — no mutations are saved. */
    finalise?: boolean;
}

export async function generateTaxReport(
    transactions: Transaction[], 
    nativeCurrency: string, 
    periodStart: Date, 
    periodEnd: Date, 
    accountingMethodOrOptions: string | TaxReportOptions = 'FIFO',
    currencyRateStorage: CurrencyRateStorage
): Promise<TaxReport> {
    // Support both legacy string and new options object
    const options: TaxReportOptions = typeof accountingMethodOrOptions === 'string'
        ? { accountingMethod: accountingMethodOrOptions }
        : accountingMethodOrOptions;
    const accountingMethod = options.accountingMethod || 'FIFO';
    const finalise = options.finalise === true;

    const strategy: AccountingStrategy = resolveStrategy(accountingMethod);
    const taxReport = new TaxReport(periodStart, periodEnd, nativeCurrency, strategy.name);
    taxReport.isFinalised = finalise;

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

    // Always use the requested tax period for report metadata
    taxReport.startDate = periodStart;

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
        const baseFeeQuantity = getBaseFeeQuantity(t);
        
        logger.debug(`${i} ${JSON.stringify(t.toSimpleJSON())} inscope: ${isInScope}`);
        
        // Track income for reward transactions
        if (isInScope && t.isReward()) {
            const incomeValue = t.getIncomeValue();
            const incomeValueInTaxCurrency = t.getIncomeValueInTaxCurrency();
            
            taxReport.incomeEvents!.push({
                transactionId: t.id,
                asset: t.baseCurrency,
                quantity: t.baseSize,
                incomeValue: incomeValue,
                incomeValueInTaxCurrency: incomeValueInTaxCurrency,
                incomeDate: t.dateTime,
                type: t.type
            });
            
            taxReport.totalIncome = (taxReport.totalIncome || 0) + incomeValueInTaxCurrency;
            
            logger.debug(
                `Income event: ${t.type} of ${t.baseSize} ${t.baseCurrency} ` +
                `(value: ${incomeValue} ${t.quoteCurrency} = ${incomeValueInTaxCurrency} ${nativeCurrency})`
            );
        }
        
        // Track deductible fees from withdrawal transactions
        if (isInScope && t.type === 'WITHDRAW' && t.fee > 0) {
            const feeInTaxCurrency = t.getTaxFee();
            
            taxReport.withdrawalEvents!.push({
                transactionId: t.id,
                asset: t.baseCurrency,
                quantity: t.baseSize,
                fee: t.fee,
                feeInTaxCurrency: feeInTaxCurrency,
                withdrawalDate: t.dateTime
            });
            
            taxReport.deductibleFees = (taxReport.deductibleFees || 0) + feeInTaxCurrency;
            
            logger.debug(
                `Withdrawal fee: ${t.fee} ${t.feeCurrency || t.quoteCurrency} = ${feeInTaxCurrency} ${nativeCurrency} ` +
                `for withdrawal of ${t.baseSize} ${t.baseCurrency} on ${t.dateTime.toISOString()}`
            );
        }
        
        // Only add to report metrics if transaction is in the tax period
        if (isInScope) {
            taxReport.assets!.add(t.baseCurrency);
            taxReport.exchanges!.add(t.exchange);
            // Note: fees are now tracked per sell event, not aggregated here
        }
        
        // Skip buy/sell processing for WITHDRAW and DEPOSIT transactions
        // These don't affect cost basis or create taxable events
        if (t.type === 'WITHDRAW' || t.type === 'DEPOSIT') {
            continue;
        }
        
        if (t.side === 'BUY') {
            if (isInScope) taxReport.buys!++;

            const buyQuantity = Math.max(t.baseSize - baseFeeQuantity, 0);
            
            // Add this buy to the position queue for lot matching
            if (!buyPositions.has(t.baseCurrency)) {
                buyPositions.set(t.baseCurrency, []);
            }

            // Build enriched BuyLot with pre-computed cost basis fields
            const cbPerUnit = buyQuantity > 0 ? calculateCostBasisPerUnit(t) : 0;
            const taxFeePerUnit = buyQuantity > 0 ? (t.getTaxFee() / buyQuantity) : 0;

            buyPositions.get(t.baseCurrency)!.push({
                transaction: t,
                index: i,
                remainingQuantity: buyQuantity,
                effectiveBaseSize: buyQuantity,
                costBasisPerUnit: cbPerUnit,
                totalRemainingCostBasis: cbPerUnit * buyQuantity,
                buyFeePerUnit: taxFeePerUnit,
            });
            
            logger.debug(`Added buy position for ${t.baseCurrency}: ${t.baseSize} units at index ${i}`);
            
            // Update portfolio: add ALL buys (not just in-scope) to get correct current holdings
            // But mark whether this buy is in the reporting period
            // Skip native currency (fiat) - we only track crypto assets
            if (t.baseCurrency !== nativeCurrency) {
                const position = portfolio.getPosition(t.baseCurrency);
                // Use quote-based price per unit derived from taxQuoteSize
                const taxQuoteSize = (t.taxQuoteSize !== undefined)
                    ? t.taxQuoteSize
                    : (t.quoteSize * (t.taxConversionRate ?? 1));
                const pricePerUnitFromQuote = t.baseSize > 0 ? (taxQuoteSize / t.baseSize) : t.getTaxPrice();
                position.addBuy(buyQuantity, pricePerUnitFromQuote, t.getTaxFee(), isInScope);
            }
        } else if (t.side === 'SELL') {
            if (isInScope) taxReport.sells!++;
            
            const asset = t.baseCurrency;
            if (!buyPositions.has(asset) || buyPositions.get(asset)!.length === 0) {
                logger.warn(`No buy found before SELL of ${asset} at ${t.dateTime.toISOString()}. This may indicate incomplete transaction history.`);
                continue;
            }
            
            // Create a sell event to track this sell and its lot matching
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
            
            // Use the accounting strategy to determine lot consumption order
            const positions = buyPositions.get(asset)!;
            const selectionContext: LotSelectionContext = {
                sellPricePerUnit: t.getTaxPrice(),
                sellQuantity: t.baseSize,
                sellFee: t.getTaxFee(),
                cumulativeGainThisPeriod: taxReport.profit || 0,
                deductibleFeesThisPeriod: taxReport.deductibleFees || 0,
                nativeCurrency
            };
            
            const selectionResult = strategy.selectLots(positions, selectionContext);
            logger.debug(`Lot selection (${strategy.name}): ${selectionResult.selectionReason}`);
            
            // Match this sell against buy positions in the strategy-determined order
            let remainingToSell = t.baseSize;
            
            for (const selectedLot of selectionResult.orderedLots) {
                if (remainingToSell <= 0.00000000001) break;
                
                // Find the actual position in our mutable positions array
                // (the strategy returns copies, we need to mutate the originals)
                const positionIdx = positions.findIndex(p => p.index === selectedLot.index);
                if (positionIdx === -1) continue;
                const buyPosition = positions[positionIdx];
                if (buyPosition.remainingQuantity <= 0.00000000001) continue;
                
                const quantityToAllocate = Math.min(buyPosition.remainingQuantity, remainingToSell);
                
                // Calculate proportional cost basis using the shared helper
                const { costBasis, allocatedQuoteValue, allocatedBuyFee } = 
                    calculateProportionalCostBasis(buyPosition, quantityToAllocate);
                
                const allocation: BuyAllocation = {
                    buyTransactionId: buyPosition.transaction.id,
                    quantity: quantityToAllocate,
                    costBasis: costBasis
                };
                
                sellEvent.addBuyAllocation(allocation, allocatedBuyFee);
                
                // Record lot consumption on the buy transaction only when finalising
                if (finalise) {
                    const reportTaxYear = periodStart.getFullYear();
                    buyPosition.transaction.recordLotConsumption(
                        t.id,
                        quantityToAllocate,
                        costBasis,
                        allocatedBuyFee,
                        t.dateTime,
                        reportTaxYear,
                        strategy.name
                    );
                }
                
                logger.debug(
                    `${strategy.name} match: Selling ${quantityToAllocate} ${asset} ` +
                    `from buy ${buyPosition.transaction.id} at ${buyPosition.transaction.dateTime.toISOString()} ` +
                    `(allocated quote: ${allocatedQuoteValue.toFixed(8)}, buy fee: ${allocatedBuyFee.toFixed(2)}, cost basis: ${costBasis.toFixed(2)})`
                );
                
                // Update remaining quantities
                buyPosition.remainingQuantity -= quantityToAllocate;
                buyPosition.totalRemainingCostBasis = buyPosition.costBasisPerUnit * buyPosition.remainingQuantity;
                remainingToSell -= quantityToAllocate;
                
                // Remove buy position if fully consumed
                if (buyPosition.remainingQuantity <= 0.00000000001) {
                    positions.splice(positionIdx, 1);
                    logger.debug(`${buyPosition.transaction.baseCurrency} buy position fully consumed, removed from queue`);
                }
            }
            
            if (remainingToSell > 0.00000000001) {
                logger.warn(
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
                
                logger.debug(
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

            // If fee is charged in the asset itself, subtract it from holdings using FIFO
            if (baseFeeQuantity > 0 && asset !== nativeCurrency) {
                const positionsForFee = buyPositions.get(asset);
                if (positionsForFee && positionsForFee.length > 0) {
                    const feeCostBasis = consumeQuantityFromPositions(positionsForFee, baseFeeQuantity);
                    // Add the fee cost in tax currency on top of the FIFO cost basis
                    const totalFeeCost = feeCostBasis + t.getTaxFee();
                    const position = portfolio.getPosition(asset);
                    position.addSell(
                        baseFeeQuantity,
                        0,
                        totalFeeCost,
                        0,
                        0,
                        false
                    );
                } else {
                    logger.warn(`No buy found before fee deduction of ${baseFeeQuantity} ${asset} for transaction ${t.id}.`);
                }
            }
        }
        if (logger.isDebugEnabled()) {
            logger.debug(`Portfolio after processing transaction ${t.id}:\n${mapToJSONString(calculateTotalPositionsPerAsset(buyPositions))}`);
        }
    }
    
    return taxReport;
}

function inScope(date: Date, startDate: Date, endDate: Date): boolean {
    return date >= startDate && date <= endDate;
}

function getBaseFeeQuantity(transaction: Transaction): number {
    if ((transaction.fee ?? 0) <= 0) {
        return 0;
    }
    if (!transaction.feeCurrency) {
        return 0;
    }
    return transaction.feeCurrency.toUpperCase() === transaction.baseCurrency.toUpperCase()
        ? transaction.fee
        : 0;
}

function consumeQuantityFromPositions(positions: BuyPosition[], quantity: number): number {
    let remainingToConsume = quantity;
    let totalCostBasis = 0;

    while (remainingToConsume > 0 && positions.length > 0) {
        const buyPosition = positions[0];
        const quantityToConsume = Math.min(buyPosition.remainingQuantity, remainingToConsume);

        const { costBasis } = calculateProportionalCostBasis(buyPosition, quantityToConsume);
        totalCostBasis += costBasis;

        buyPosition.remainingQuantity -= quantityToConsume;
        buyPosition.totalRemainingCostBasis = buyPosition.costBasisPerUnit * buyPosition.remainingQuantity;
        remainingToConsume -= quantityToConsume;

        if (buyPosition.remainingQuantity <= 0.00000000001) {
            positions.shift();
        }
    }

    return totalCostBasis;
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
            logger.debug(`Expanding transaction ${original.id} (${original.side} ${original.baseCurrency}-${original.quoteCurrency}) for accounting`);
            const quoteToNative = original.taxConversionRate ?? 1;
            const quoteValueNative = original.taxQuoteSize ?? (original.quoteSize * quoteToNative);
            const basePriceNative = original.taxPrice ?? (original.price * quoteToNative);
            const feeNative = original.getTaxFee();

            // For BUY: you spend quote and receive base → SELL quote, BUY base
            // For SELL: you spend base and receive quote → SELL base, BUY quote
            let leg1: Transaction;
            let leg2: Transaction;

            if (original.side === 'BUY') {
                // BUY BASE-QUOTE: spend QUOTE, get BASE
                leg1 = new Transaction(
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
                );
                leg1.processingSequence = sequence++;
                leg1.sourceTransactionId = original.id;
                leg1.leg = 'QUOTE';
                leg1.setTaxConversion(nativeCurrency, 1, original.dateTime);

                leg2 = new Transaction(
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
                );
                leg2.processingSequence = sequence++;
                leg2.sourceTransactionId = original.id;
                leg2.leg = 'BASE';
                leg2.setTaxConversion(nativeCurrency, 1, original.dateTime);
                leg2.feeCurrency = nativeCurrency;
            } else {
                // SELL BASE-QUOTE: spend BASE, get QUOTE
                leg1 = new Transaction(
                    `${original.id}#base-sell`,
                    original.baseCurrency,
                    nativeCurrency,
                    original.exchange,
                    'SELL',
                    original.baseSize,
                    quoteValueNative,
                    basePriceNative,
                    feeNative,
                    original.dateTime,
                    original.type,
                );
                leg1.processingSequence = sequence++;
                leg1.sourceTransactionId = original.id;
                leg1.leg = 'BASE';
                leg1.setTaxConversion(nativeCurrency, 1, original.dateTime);
                leg1.feeCurrency = nativeCurrency;

                leg2 = new Transaction(
                    `${original.id}#quote-buy`,
                    original.quoteCurrency,
                    nativeCurrency,
                    original.exchange,
                    'BUY',
                    original.quoteSize,
                    quoteValueNative,
                    quoteToNative,
                    0,
                    original.dateTime,
                    original.type,
                );
                leg2.processingSequence = sequence++;
                leg2.sourceTransactionId = original.id;
                leg2.leg = 'QUOTE';
                leg2.setTaxConversion(nativeCurrency, 1, original.dateTime);
            }
            logger.debug(`Created synthetic 
                ${leg1.side} ${leg1.id} (${leg1.baseCurrency}-${leg1.quoteCurrency}) and 
                ${leg2.side} ${leg2.id} (${leg2.baseCurrency}-${leg2.quoteCurrency}) for accounting`);
            expanded.push(leg1, leg2);
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
        
        // For reward transactions, also set the income value (FMV at time of earning)
        if (transaction.isReward() && !transaction.hasIncomeTracking()) {
            // Income value = quantity * price (in the original quote currency)
            const incomeValue = transaction.quoteSize;
            transaction.setRewardIncome(incomeValue, conversionRate, transaction.dateTime);
        }
    } catch (error) {
        logger.warn(
            `Failed to ensure tax conversion for transaction ${transaction.id}: ${error}`
        );
        transaction.setTaxConversion(nativeCurrency, 1, transaction.dateTime);
        
        // Still set reward income even if conversion fails
        if (transaction.isReward() && !transaction.hasIncomeTracking()) {
            transaction.setRewardIncome(transaction.quoteSize, 1, transaction.dateTime);
        }
    }
}

function isFiatCurrency(currency: string): boolean {
    const fiatCurrencies = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'JPY', 'CNY', 'AUD', 'CAD'];
    return fiatCurrencies.includes(currency.toUpperCase());
}

function calculateTotalPositionsPerAsset(buyPositions: Map<string, BuyPosition[]>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [asset, positions] of buyPositions.entries()) {
    const total = positions.reduce((sum, pos) => sum + pos.remainingQuantity, 0);
    totals.set(asset, total);
  }
  return totals;
}

function mapToJSONString(map: Map<string, number>): string {
    const obj: { [key: string]: number } = {};
    for (const [key, value] of map.entries()) {
        obj[key] = value;
    }
    return JSON.stringify(obj, null, 2);
}