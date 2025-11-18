import logger from '../logger';
import { Transaction } from "../models/transaction";
import { Portfolio } from "../models/portfolio";
import { CurrencyRateStorage } from "../repositories/currencyRateStorage";
import { ExchangeRateService } from "./exchangeRateService";
import { generateTaxReport } from "./profitReporter";

/**
 * Generates a portfolio snapshot as of a specific date
 * @param transactions All transactions
 * @param nativeCurrency The currency to use for valuations
 * @param asOfDate The date to calculate portfolio as of
 * @param currencyRateStorage Storage for exchange rates
 * @returns Portfolio object with current holdings and valuations
 */
export async function generatePortfolioSnapshot(
    transactions: Transaction[],
    nativeCurrency: string,
    asOfDate: Date,
    currencyRateStorage: CurrencyRateStorage
): Promise<Portfolio> {
    // Use tax report generation to calculate portfolio state up to the asOfDate
    // Set period start to beginning of time to include all transactions
    const periodStart = new Date(0);
    
    const taxReport = await generateTaxReport(
        transactions,
        nativeCurrency,
        periodStart,
        asOfDate,
        'FIFO',
        currencyRateStorage
    );

    const portfolio = taxReport.portfolio;
    
    if (!portfolio) {
        throw new Error('Failed to generate portfolio from tax report');
    }
    
    // Update market values for all positions
    const exchangeRateService = new ExchangeRateService(currencyRateStorage);
    
    for (const position of portfolio.getAllPositions(false)) {
        try {
            const currentPrice = await exchangeRateService.getCryptoPriceInCurrency(
                position.asset,
                nativeCurrency,
                asOfDate
            );
            position.updateMarketValue(currentPrice);
        } catch (error) {
            logger.warn(`Failed to fetch price for ${position.asset}: ${error}`);
            // Leave market value undefined if price lookup fails
        }
    }
    
    return portfolio;
}
