import { TaxReport } from "../models/taxReport";
import { Transaction } from "../models/transaction";
import { ExchangeRateService } from "./exchangeRateService";
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
    const exchangeRateService = new ExchangeRateService(currencyRateStorage);

    taxReport.transactions = transactions.filter(transaction => 
        inScope(transaction.dateTime, periodStart, periodEnd)
    ).sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
    taxReport.startDate = transactions[0].dateTime;

    const buyPointers: Map<string, number> = new Map(); // Point at the index of the current transaction OR the current buy of a given asset
    const remainingAsset: Map<string, number> = new Map(); // How much of an asset is left to sell for a given asset
    remainingAsset.set(nativeCurrency, 999999999999);
    buyPointers.set(nativeCurrency, -1); // Native currency does not have a buy pointer

    for (let i: number = 0; i < taxReport.transactions.length; i++) {
        let t = taxReport.transactions[i];
        console.debug(`${i} ${JSON.stringify(t.toSimpleJSON())} inscope: ${inScope(t.dateTime, periodStart, periodEnd)}`);
        if (inScope(t.dateTime, periodStart, periodEnd)) {
            taxReport.assets!.add(t.baseCurrency);
            taxReport.exchanges!.add(t.exchange);
            taxReport.fees! += t.fee; // TODO handle fees when currency is not native to the taxReport
        }
        if (t.side === 'BUY') {
            if (inScope(t.dateTime, periodStart, periodEnd)) taxReport.buys!++;
            if (!buyPointers.has(t.baseCurrency)) {
                console.debug(`Adding new buy pointer for ${t.baseCurrency} at index ${i}`);
                buyPointers.set(t.baseCurrency, i);
                remainingAsset.set(t.baseCurrency, t.baseSize);
            }
        } else if (t.side === 'SELL') {
            if (inScope(t.dateTime, periodStart, periodEnd)) taxReport.sells!++;
            if (!buyPointers.has(t.baseCurrency)) throw new Error(`No buy found before a SELL of ${t.baseCurrency} at ${t.dateTime.toISOString()}`);
            let toSell = t.baseSize;
            let cumulativeCostBasis: number = 0;
            do {
                if (buyPointers.get(t.baseCurrency)! < 0) {
                    console.debug(`No more buys for ${t.baseCurrency}. It appears transaction history is ${toSell} short.`);
                    continue;
                }
                const sellAmount = Math.min(remainingAsset.get(t.baseCurrency)!, toSell);
                const buyTransaction = taxReport.transactions[buyPointers.get(t.baseCurrency)!];
                console.debug(`Selling ${toSell} ${t.baseCurrency} into available ${remainingAsset.get(t.baseCurrency)} at index ${buyPointers.get(t.baseCurrency)!}`);
                
                // Convert buy price to native currency if needed
                let buyPriceInNative = buyTransaction.price;
                if (buyTransaction.quoteCurrency !== nativeCurrency) {
                    console.debug(`Converting buy price from ${buyTransaction.quoteCurrency} to ${nativeCurrency} for cost basis calculation`);
                    let exchangeRate: number;
                    if (isFiat(buyTransaction.quoteCurrency)) {
                        // For fiat currencies, use Norges Bank API
                        exchangeRate = await exchangeRateService.getCcyNokRate(buyTransaction.quoteCurrency, buyTransaction.dateTime);
                    } else {
                        // For crypto currencies in quote position, use CoinGecko API
                        exchangeRate = await exchangeRateService.getCryptoPriceInCurrency(buyTransaction.quoteCurrency, nativeCurrency, buyTransaction.dateTime);
                    }
                    buyPriceInNative = buyTransaction.price * exchangeRate;
                    console.debug(`Buy price ${buyTransaction.price} ${buyTransaction.quoteCurrency} converted to ${buyPriceInNative} ${nativeCurrency} (rate: ${exchangeRate})`);
                }
                
                cumulativeCostBasis += buyPriceInNative * sellAmount;
                remainingAsset.set(t.baseCurrency, remainingAsset.get(t.baseCurrency)! - sellAmount);
                toSell -= sellAmount!;
                console.debug(`${t.baseCurrency} still to sell: ${toSell}`);
                if (toSell > 0) {
                    let nextBuyIndex = nextBuy(taxReport.transactions, buyPointers.get(t.baseCurrency)! + 1, t.baseCurrency);
                    if (nextBuyIndex < 0) {
                        console.warn(`No more buys for ${t.baseCurrency}. It appears transaction history is ${toSell} short.`);
                        remainingAsset.set(t.baseCurrency, 0);
                    } else {
                        remainingAsset.set(t.baseCurrency, taxReport.transactions[nextBuyIndex].baseSize);
                    }
                    buyPointers.set(t.baseCurrency, nextBuyIndex)
                }

            } while (toSell > 0 && buyPointers.get(t.baseCurrency)! >= 0);
            if (inScope(t.dateTime, periodStart, periodEnd)) {
                let costBasis: number = cumulativeCostBasis / t.baseSize;
                var profit: number = (t.price - costBasis) * t.baseSize;
                taxReport.profit! += profit;
                console.debug(`Profit selling ${t.baseSize} ${t.baseCurrency} at ${t.price} with cost basis of ${costBasis} is ${profit} ${nativeCurrency}`);
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
function isFiat(currency: string): boolean {
    const fiatCurrencies = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'JPY', 'CNY', 'AUD', 'CAD'];
    return fiatCurrencies.includes(currency.toUpperCase());
}
