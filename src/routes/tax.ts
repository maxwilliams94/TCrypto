import express, { Express, Request, Response } from 'express';
import { generateTaxReport } from '../services/profitReporter';
import { transactionRepository, currencyRateRepository, taxHistoryService } from '../index';
import { resolveAccountingMethodForPeriod } from '../services/finalisedTaxYear';
import { cleanupLotAllocationsForYear, inspectLotAllocations } from '../services/lotAllocationMaintenance';
import { exportTaxReportComplete } from '../services/csvExporter';
import logger from '../logger';
import path from 'path';

export const taxRouter = express.Router();

function getTaxReportExportDirectory(startDate: Date, endDate: Date, finalised: boolean): string {
    const period = `${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}`;
    const stateDir = finalised ? 'finalised' : 'drafts';
    return path.resolve(process.cwd(), 'exports', 'tax-reports', stateDir, period);
}

function buildTaxResponse(report: any, outputDir: string, exportState: 'draft' | 'finalised') {
    const reportJson = typeof report.toJSON === 'function' ? report.toJSON() : report;
    return {
        ...reportJson,
        export: {
            outputDir,
            exportState,
        },
    };
}

taxRouter.get('/history', async (_req: Request, res: Response) => {
    try {
        const history = await taxHistoryService.listEntries();
        res.send(history);
    } catch (error: any) {
        res.status(500).send({ error: error.message });
    }
});

taxRouter.get('/lot-allocations', async (_req: Request, res: Response) => {
    try {
        const transactions = await transactionRepository.getAll();
        const years = inspectLotAllocations(transactions);
        const finalisedHistory = await taxHistoryService.listEntries();
        res.send({
            years,
            finalisedHistory,
        });
    } catch (error: any) {
        res.status(500).send({ error: error.message });
    }
});

taxRouter.delete('/lot-allocations', async (req: Request, res: Response) => {
    try {
        const taxYear = Number(req.query.taxYear);
        const dryRun = req.query.dryRun !== 'false';
        const confirm = req.query.confirm === 'true';

        if (!Number.isInteger(taxYear)) {
            res.status(400).send({ error: 'taxYear query parameter is required and must be an integer year.' });
            return;
        }

        if (!dryRun && !confirm) {
            res.status(400).send({
                error: 'Destructive cleanup requires confirm=true. Use dryRun=true first to inspect the impact.',
            });
            return;
        }

        const transactions = await transactionRepository.getAll();
        const result = cleanupLotAllocationsForYear(transactions, taxYear, dryRun);
        const deletedHistoryEntries = dryRun ? 0 : await taxHistoryService.deleteEntriesForTaxYear(taxYear);

        if (!dryRun && transactionRepository.flush) {
            await transactionRepository.flush(true);
        }

        res.send({
            ...result,
            deletedHistoryEntries,
            nextStep: dryRun
                ? `Re-run with dryRun=false&confirm=true to remove persisted lot allocations for ${taxYear}.`
                : `Cleanup applied for ${taxYear}. You can now generate a fresh draft report and finalize it again.`,
        });
    } catch (error: any) {
        res.status(500).send({ error: error.message });
    }
});

taxRouter.get('/', async (req: Request, res: Response) => {
    try {
        let { start, end, method, finalise } = req.query;
        let startDate: Date = start !== undefined ? new Date(start as string) : new Date(0);
        let endDate: Date = end !== undefined ? new Date(end as string) : new Date();
        const shouldFinalise = finalise === 'true';
        const transactions = await transactionRepository.getAll();

        const storedReport = await taxHistoryService.getStoredReport(
            startDate,
            endDate,
            method as string | undefined,
            'NOK'
        );
        if (storedReport) {
            const exportOutputDir = getTaxReportExportDirectory(
                startDate,
                endDate,
                storedReport.isFinalised === true
            );
            await exportTaxReportComplete(
                storedReport,
                exportOutputDir,
                storedReport.accountingTransactions ?? transactions
            );
            res.send(buildTaxResponse(
                storedReport,
                exportOutputDir,
                storedReport.isFinalised ? 'finalised' : 'draft'
            ));
            return;
        }

        const { accountingMethod } = resolveAccountingMethodForPeriod({
            transactions,
            startDate,
            endDate,
            requestedMethod: method as string | undefined,
            finalise: shouldFinalise,
        });

        const report = await generateTaxReport(
            transactions, "NOK", startDate, endDate,
            { accountingMethod, finalise: shouldFinalise },
            currencyRateRepository
        );

        // Always generate tax document exports when a report is generated.
        const exportOutputDir = getTaxReportExportDirectory(startDate, endDate, shouldFinalise);
        await exportTaxReportComplete(
            report,
            exportOutputDir,
            report.accountingTransactions ?? transactions
        );
        logger.info(
            `Tax report documents exported for ${start} to ${end} to ${exportOutputDir}`
        );

        // If finalised, persist lot consumption to storage and store the final report snapshot
        if (shouldFinalise) {
            if (transactionRepository.flush) {
                await transactionRepository.flush(true);
            }
            await taxHistoryService.saveFinalisedReport(report);
            logger.info(`Tax report finalised for ${start} to ${end} using ${accountingMethod} — lot assignments persisted`);
        }

        res.send(buildTaxResponse(
            report,
            exportOutputDir,
            shouldFinalise ? 'finalised' : 'draft'
        ));
    } catch (error: any) {
        res.status(500).send({ error: error.message });
    }
});
