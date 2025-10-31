import express from 'express';
import { transactionRepository } from '../index';
import { generateTaxReport } from '../services/profitReporter';
import { 
    exportSellEventsToCSV,
    exportSellEventAllocationsToCSV,
    exportPortfolioToCSV,
    exportTaxReportSummaryToCSV,
    exportTaxReportComplete
} from '../services/csvExporter';
import { CurrencyRateMemoryRepository } from '../repositories/currencyRateMemory';
import path from 'path';

const exportRouter = express.Router();

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
        const { start, end, currency = 'NOK' } = req.query;

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

        // Generate tax report
        const transactions = await transactionRepository.getAll();
        const currencyRateRepo = new CurrencyRateMemoryRepository();
        const taxReport = await generateTaxReport(
            transactions,
            currency as string,
            startDate,
            endDate,
            'FIFO',
            currencyRateRepo
        );

        // Export to directory
        const outputDir = path.resolve(process.cwd(), 'exports/tax-reports');
        await exportTaxReportComplete(
            taxReport,
            outputDir,
            taxReport.accountingTransactions ?? transactions
        );

        res.json({
            success: true,
            message: `Tax report exported to ${outputDir}`,
            files: [
                `tax_report_summary_${start}_to_${end}.csv`,
                `sell_events_${start}_to_${end}.csv`,
                `sell_event_allocations_${start}_to_${end}.csv`,
                `portfolio_${start}_to_${end}.csv`
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
        const { start, end, currency = 'NOK' } = req.query;

        if (!start || !end) {
            res.status(400).json({ 
                error: 'Missing required parameters: start and end dates (YYYY-MM-DD)' 
            });
            return;
        }

        const startDate = new Date(start as string);
        const endDate = new Date(end as string);

        const transactions = await transactionRepository.getAll();
        const currencyRateRepo = new CurrencyRateMemoryRepository();
        const taxReport = await generateTaxReport(
            transactions,
            currency as string,
            startDate,
            endDate,
            'FIFO',
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
        const { start, end, currency = 'NOK' } = req.query;

        if (!start || !end) {
            res.status(400).json({ 
                error: 'Missing required parameters: start and end dates (YYYY-MM-DD)' 
            });
            return;
        }

        const startDate = new Date(start as string);
        const endDate = new Date(end as string);

        const transactions = await transactionRepository.getAll();
        const currencyRateRepo = new CurrencyRateMemoryRepository();
        const taxReport = await generateTaxReport(
            transactions,
            currency as string,
            startDate,
            endDate,
            'FIFO',
            currencyRateRepo
        );

        if (!taxReport.portfolio) {
            res.status(404).json({ 
                error: 'No portfolio data found' 
            });
            return;
        }

        const outputPath = path.resolve(process.cwd(), `exports/portfolio_${start}_to_${end}.csv`);
        await exportPortfolioToCSV(taxReport, outputPath);

        res.download(outputPath, `portfolio_${start}_to_${end}.csv`);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default exportRouter;
