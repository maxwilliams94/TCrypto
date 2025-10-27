import { TaxReport } from "../models/taxReport";
import { Transaction } from "../models/transaction";
import { CurrencyRateStorage } from "../repositories/currencyRateStorage";

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

    const buyPointers: Map<string, number> = new Map(); // Point at the index of the current transaction OR the current buy of a given asset
    const remainingAsset: Map<string, number> = new Map(); // How much of an asset is left to sell for a given asset
    remainingAsset.set(nativeCurrency, 999999999999);
    buyPointers.set(nativeCurrency, -1); // Native currency does not have a buy pointer

    // Process ALL transactions for FIFO matching, but only count profit/fees for in-scope transactions
    for (let i: number = 0; i < allTransactionsSorted.length; i++) {
        let t = allTransactionsSorted[i];
        const isInScope = inScope(t.dateTime, periodStart, periodEnd);
        
        console.debug(`${i} ${JSON.stringify(t.toSimpleJSON())} inscope: ${isInScope}`);
        
        // Only add to report metrics if transaction is in the tax period
        if (isInScope) {
            taxReport.assets!.add(t.baseCurrency);
            taxReport.exchanges!.add(t.exchange);
            taxReport.fees! += t.getTaxFee(); // Use tax-converted fee
        }
        
        if (t.side === 'BUY') {
            if (isInScope) taxReport.buys!++;
            if (!buyPointers.has(t.baseCurrency)) {
                console.debug(`Adding new buy pointer for ${t.baseCurrency} at index ${i}`);
                buyPointers.set(t.baseCurrency, i);
                remainingAsset.set(t.baseCurrency, t.baseSize);
            }
        } else if (t.side === 'SELL') {
            if (isInScope) taxReport.sells!++;
            if (!buyPointers.has(t.baseCurrency)) throw new Error(`No buy found before a SELL of ${t.baseCurrency} at ${t.dateTime.toISOString()}`);
            let toSell = t.baseSize;
            let cumulativeCostBasis: number = 0;
            do {
                if (buyPointers.get(t.baseCurrency)! < 0) {
                    console.debug(`No more buys for ${t.baseCurrency}. It appears transaction history is ${toSell} short.`);
                    continue;
                }
                const sellAmount = Math.min(remainingAsset.get(t.baseCurrency)!, toSell);
                const buyTransaction = allTransactionsSorted[buyPointers.get(t.baseCurrency)!];
                console.debug(`Selling ${toSell} ${t.baseCurrency} into available ${remainingAsset.get(t.baseCurrency)} at index ${buyPointers.get(t.baseCurrency)!}`);
                
                // Use tax-converted price from the buy transaction (already in native currency)
                const buyPriceInNative = buyTransaction.getTaxPrice();
                
                cumulativeCostBasis += buyPriceInNative * sellAmount;
                remainingAsset.set(t.baseCurrency, remainingAsset.get(t.baseCurrency)! - sellAmount);
                toSell -= sellAmount!;
                console.debug(`${t.baseCurrency} still to sell: ${toSell}`);
                if (toSell > 0) {
                    let nextBuyIndex = nextBuy(allTransactionsSorted, buyPointers.get(t.baseCurrency)! + 1, t.baseCurrency);
                    if (nextBuyIndex < 0) {
                        console.warn(`No more buys for ${t.baseCurrency}. It appears transaction history is ${toSell} short.`);
                        remainingAsset.set(t.baseCurrency, 0);
                    } else {
                        remainingAsset.set(t.baseCurrency, allTransactionsSorted[nextBuyIndex].baseSize);
                    }
                    buyPointers.set(t.baseCurrency, nextBuyIndex)
                }

            } while (toSell > 0 && buyPointers.get(t.baseCurrency)! >= 0);
            
            // Only add profit if the SELL transaction is within the tax period
            if (isInScope) {
                let costBasis: number = cumulativeCostBasis / t.baseSize;
                // Use tax-converted price for the sell transaction
                var profit: number = (t.getTaxPrice() - costBasis) * t.baseSize;
                taxReport.profit! += profit;
                console.debug(`Profit selling ${t.baseSize} ${t.baseCurrency} at ${t.getTaxPrice()} with cost basis of ${costBasis} is ${profit} ${nativeCurrency}`);
            }
        }
    }
    return taxReport;
}

function inScope(date: Date, startDate: Date, endDate: Date): boolean {
    return date >= startDate && date <= endDate;
}           

function nextBuy(transactions: Transaction[], startIndex: number, baseCurrency: string): number {
    for (let i = startIndex; i < transactions.length; i++) {
        if (transactions[i].side === 'BUY' && transactions[i].baseCurrency === baseCurrency) {
            console.log(`Next buy for ${baseCurrency} (${transactions[i].baseSize}) found at index ${i}`);
            return i;
        }
    }
    return -1; // No buy found
}
