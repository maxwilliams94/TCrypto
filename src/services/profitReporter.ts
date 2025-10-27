import { TaxReport } from "../models/taxReport";
import { Transaction } from "../models/transaction";
import { CurrencyRateStorage } from "../repositories/currencyRateStorage";
import { SellEvent, BuyAllocation } from "../models/sellEvent";

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

    // Verify that transactions have tax conversions populated
    const missingConversions = transactions.filter(t => !t.hasTaxConversion());
    if (missingConversions.length > 0) {
        console.warn(
            `Warning: ${missingConversions.length} transactions are missing tax conversions. ` +
            `These should have been populated during import. Transaction IDs: ${missingConversions.slice(0, 5).map(t => t.id).join(', ')}` +
            `${missingConversions.length > 5 ? '...' : ''}`
        );
    }

    // Sort ALL transactions chronologically for correct FIFO matching
    // We need the full history to calculate cost basis correctly
    const allTransactionsSorted = transactions.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
    
    // Store only the in-scope transactions for the report
    taxReport.transactions = allTransactionsSorted.filter(transaction => 
        inScope(transaction.dateTime, periodStart, periodEnd)
    );
    taxReport.startDate = allTransactionsSorted[0].dateTime;

    // Track buy positions for each asset (for FIFO matching)
    const buyPositions: Map<string, BuyPosition[]> = new Map();
    
    // Native currency has infinite supply at zero cost (we don't track fiat buys)
    buyPositions.set(nativeCurrency, []);

    // Process ALL transactions for FIFO matching, but only count profit/fees for in-scope transactions
    for (let i: number = 0; i < allTransactionsSorted.length; i++) {
        let t = allTransactionsSorted[i];
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
                console.debug(
                    `Sell event summary: Asset: ${asset}, Quantity: ${sellEvent.totalQuantity}, ` +
                    `Proceeds: ${sellEvent.proceeds.toFixed(2)} ${nativeCurrency}, Cost Basis: ${sellEvent.totalCostBasis.toFixed(2)} ${nativeCurrency}, ` +
                    `Buy Fees: ${sellEvent.totalBuyFees.toFixed(2)} ${nativeCurrency}, Sell Fee: ${sellEvent.sellFee.toFixed(2)} ${nativeCurrency}, ` +
                    `Profit/Loss: ${sellEvent.profitLoss.toFixed(2)} ${nativeCurrency}`
                );
            }
        }
    }
    
    return taxReport;
}

function inScope(date: Date, startDate: Date, endDate: Date): boolean {
    return date >= startDate && date <= endDate;
}
