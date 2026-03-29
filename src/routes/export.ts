import express from 'express';
import { transactionRepository, taxHistoryService } from '../index';
import { generateTaxReport } from '../services/profitReporter';
import { resolveAccountingMethodForPeriod } from '../services/finalisedTaxYear';
import { 
    exportSellEventsToCSV,
    exportSellEventAllocationsToCSV,
    exportPortfolioToCSV,
    exportTaxReportSummaryToCSV,
    exportTaxReportComplete
} from '../services/csvExporter';
import { CurrencyRateMemoryRepository } from '../repositories/currencyRateMemory';
import { ExchangeRateService } from '../services/exchangeRateService';
import { Portfolio } from '../models/portfolio';
import logger from '../logger';
import path from 'path';

const exportRouter = express.Router();

function getTaxReportExportDirectory(startDate: Date, endDate: Date, finalised: boolean): string {
    const period = `${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}`;
    const stateDir = finalised ? 'finalised' : 'drafts';
    return path.resolve(process.cwd(), 'exports', 'tax-reports', stateDir, period);
}

async function updatePortfolioMarketValues(
    portfolio: Portfolio,
    nativeCurrency: string,
    asOfDate: Date,
    currencyRateRepo: CurrencyRateMemoryRepository
): Promise<void> {
    const exchangeRateService = new ExchangeRateService(currencyRateRepo);

    for (const position of portfolio.getAllPositions(false)) {
        try {
            const currentPrice = await exchangeRateService.getCryptoPriceInCurrency(
                position.asset,
                nativeCurrency,
                asOfDate
            );
            position.updateMarketValue(currentPrice);
        } catch (error: any) {
            logger.warn(`Failed to fetch price for ${position.asset}: ${error?.message || error}`);
        }
    }
}

function getPortfolioDustThreshold(currency: string): number {
    switch (currency.toUpperCase()) {
        case 'USD':
        case 'EUR':
            return 0.1;
        case 'NOK':
            return 1;
        default:
            return 1;
    }
}

function applyPortfolioDustThreshold(portfolio: Portfolio, valueThreshold: number): void {
    for (const position of portfolio.positions.values()) {
        const value = position.currentValue ?? 0;
        logger.debug(`Checking if position for asset ${position.asset} with quantity ${position.totalQuantity} and current value ${value} is below dust threshold of ${valueThreshold}`);
        if (Math.abs(value) < valueThreshold) {
            logger.debug(`Applying dust threshold, zeroing position for asset ${position.asset}`);
            position.totalQuantity = 0;
            position.totalCostBasis = 0;
            position.averageCostBasis = 0;
            position.currentValue = 0;
            position.unrealizedGainLoss = 0;
        }
    }
}

/**
 * GET /export/transactions/csv
 * Export all transactions to CSV
 */
exportRouter.get('/transactions/csv', async (req, res) => {
    try {
        const outputPath = path.resolve(process.cwd(), 'exports/transactions.csv');
        
        // Check if repository supports CSV export
        if ('exportToCSV' in transactionRepository) {
            await (transactionRepository as any).exportToCSV(outputPath);
            res.download(outputPath, 'transactions.csv');
        } else {
            res.status(400).json({ 
                error: 'CSV export not supported. Enable USE_FILE_STORAGE=true to use CSV export.' 
            });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /export/tax-report/complete?start=YYYY-MM-DD&end=YYYY-MM-DD&currency=NOK
 * Export complete tax report to multiple CSV files
 */
exportRouter.get('/tax-report/complete', async (req, res): Promise<void> => {
    try {
        const { start, end, currency = 'NOK', method } = req.query;

        if (!start || !end) {
            res.status(400).json({ 
                error: 'Missing required parameters: start and end dates (YYYY-MM-DD)' 
            });
            return;
        }

        const startDate = new Date(start as string);
        const endDate = new Date(end as string);
        
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            res.status(400).json({ 
                error: 'Invalid date format. Use YYYY-MM-DD' 
            });
            return;
        }

        const shouldFinalise = (req.query.finalise === 'true');
        const storedReport = await taxHistoryService.getStoredReport(
            startDate,
            endDate,
            method as string | undefined,
            currency as string
        );

        // Generate tax report
        const transactions = await transactionRepository.getAll();
        const accountingMethod = storedReport?.accountingMethod ?? resolveAccountingMethodForPeriod({
            transactions,
            startDate,
            endDate,
            requestedMethod: method as string | undefined,
            finalise: shouldFinalise,
        }).accountingMethod;
        const currencyRateRepo = new CurrencyRateMemoryRepository();
        const taxReport = storedReport ?? await generateTaxReport(
            transactions,
            currency as string,
            startDate,
            endDate,
            { accountingMethod, finalise: shouldFinalise },
            currencyRateRepo
        );

        // If finalised, persist lot consumption to storage and store the final report snapshot
        if (shouldFinalise && !storedReport) {
            if (transactionRepository.flush) {
                await transactionRepository.flush(true);
            }
            await taxHistoryService.saveFinalisedReport(taxReport);
            logger.info(`Tax report finalised for ${start} to ${end} using ${accountingMethod} — lot assignments persisted`);
        }

        if (taxReport.portfolio) {
            await updatePortfolioMarketValues(
                taxReport.portfolio,
                currency as string,
                endDate,
                currencyRateRepo
            );

            applyPortfolioDustThreshold(
                taxReport.portfolio,
                getPortfolioDustThreshold(currency as string)
            );
        }

        // Export to directory grouped by draft/finalised state and period.
        const outputDir = getTaxReportExportDirectory(startDate, endDate, shouldFinalise);
        await exportTaxReportComplete(
            taxReport,
            outputDir,
            taxReport.accountingTransactions ?? transactions
        );

        res.json({
            success: true,
            message: `Tax report exported to ${outputDir}`,
            exportState: shouldFinalise ? 'finalised' : 'draft',
            files: [
                `tax_report_summary_${start}_to_${end}.csv`,
                `sell_events_${start}_to_${end}.csv`,
                `sell_event_allocations_${start}_to_${end}.csv`,
                `transactions_${start}_to_${end}.csv`,
                `portfolio_${start}_to_${end}.csv`,
            ],
            stats: {
                sellEvents: taxReport.sellEvents?.length || 0,
                portfolioAssets: taxReport.portfolio?.positions.size || 0,
                realizedGainLoss: taxReport.profit?.toFixed(2)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /export/tax-report/sell-events?start=YYYY-MM-DD&end=YYYY-MM-DD&currency=NOK
 * Export sell events to CSV
 */
exportRouter.get('/tax-report/sell-events', async (req, res): Promise<void> => {
    try {
        const { start, end, currency = 'NOK', method } = req.query;

        if (!start || !end) {
            res.status(400).json({ 
                error: 'Missing required parameters: start and end dates (YYYY-MM-DD)' 
            });
            return;
        }

        const startDate = new Date(start as string);
        const endDate = new Date(end as string);

        const transactions = await transactionRepository.getAll();
        const storedReport = await taxHistoryService.getStoredReport(
            startDate,
            endDate,
            method as string | undefined,
            currency as string
        );
        const { accountingMethod } = resolveAccountingMethodForPeriod({
            transactions,
            startDate,
            endDate,
            requestedMethod: method as string | undefined,
        });
        const currencyRateRepo = new CurrencyRateMemoryRepository();
        const taxReport = storedReport ?? await generateTaxReport(
            transactions,
            currency as string,
            startDate,
            endDate,
            { accountingMethod },
            currencyRateRepo
        );

        if (!taxReport.sellEvents || taxReport.sellEvents.length === 0) {
            res.status(404).json({ 
                error: 'No sell events found for the specified period' 
            });
            return;
        }

        const outputPath = path.resolve(process.cwd(), `exports/sell_events_${start}_to_${end}.csv`);
        await exportSellEventsToCSV(
            taxReport.sellEvents,
            outputPath,
            taxReport.accountingTransactions ?? transactions
        );

        res.download(outputPath, `sell_events_${start}_to_${end}.csv`);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /export/tax-report/portfolio?start=YYYY-MM-DD&end=YYYY-MM-DD&currency=NOK
 * Export portfolio to CSV
 */
exportRouter.get('/tax-report/portfolio', async (req, res): Promise<void> => {
    try {
        const { start, end, currency = 'NOK', method } = req.query;

        if (!start || !end) {
            res.status(400).json({ 
                error: 'Missing required parameters: start and end dates (YYYY-MM-DD)' 
            });
            return;
        }

        const startDate = new Date(start as string);
        const endDate = new Date(end as string);

        const transactions = await transactionRepository.getAll();
        const storedReport = await taxHistoryService.getStoredReport(
            startDate,
            endDate,
            method as string | undefined,
            currency as string
        );
        const { accountingMethod } = resolveAccountingMethodForPeriod({
            transactions,
            startDate,
            endDate,
            requestedMethod: method as string | undefined,
        });
        const currencyRateRepo = new CurrencyRateMemoryRepository();
        const taxReport = storedReport ?? await generateTaxReport(
            transactions,
            currency as string,
            startDate,
            endDate,
            { accountingMethod },
            currencyRateRepo
        );

        if (!taxReport.portfolio) {
            res.status(404).json({ 
                error: 'No portfolio data found' 
            });
            return;
        }

        await updatePortfolioMarketValues(
            taxReport.portfolio,
            currency as string,
            endDate,
            currencyRateRepo
        );

        applyPortfolioDustThreshold(
            taxReport.portfolio,
            getPortfolioDustThreshold(currency as string)
        );

        const outputPath = path.resolve(process.cwd(), `exports/portfolio_${start}_to_${end}.csv`);
        await exportPortfolioToCSV(taxReport, outputPath);

        res.download(outputPath, `portfolio_${start}_to_${end}.csv`);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /export/portfolio/csv?date=YYYY-MM-DD&currency=NOK
 * Export portfolio snapshot as of a specific date to CSV
 */
exportRouter.get('/portfolio/csv', async (req, res): Promise<void> => {
    try {
        const { date, currency = 'NOK', method } = req.query;
        const asOfDate = date ? new Date(date as string) : new Date();

        if (isNaN(asOfDate.getTime())) {
            res.status(400).json({ 
                error: 'Invalid date format. Use YYYY-MM-DD' 
            });
            return;
        }

        const transactions = await transactionRepository.getAll();
        const { accountingMethod } = resolveAccountingMethodForPeriod({
            transactions,
            startDate: new Date(0),
            endDate: asOfDate,
            requestedMethod: method as string | undefined,
        });
        const currencyRateRepo = new CurrencyRateMemoryRepository();
        
        // Generate portfolio snapshot using tax report (from beginning to asOfDate)
        const taxReport = await generateTaxReport(
            transactions,
            currency as string,
            new Date(0),
            asOfDate,
            { accountingMethod },
            currencyRateRepo
        );

        if (!taxReport.portfolio) {
            res.status(404).json({ 
                error: 'No portfolio data found' 
            });
            return;
        }

        const dateStr = asOfDate.toISOString().split('T')[0];
        const outputPath = path.resolve(process.cwd(), `exports/portfolio_snapshot_${dateStr}.csv`);
        await exportPortfolioToCSV(taxReport, outputPath);

        res.download(outputPath, `portfolio_snapshot_${dateStr}.csv`);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default exportRouter;
