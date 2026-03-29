import express, { Express, Request, Response } from 'express';
import { generateTaxReport } from '../services/profitReporter';
import { transactionRepository, currencyRateRepository } from '../index';
import { resolveStrategy } from '../services/accountingStrategy';
import logger from '../logger';

export const taxRouter = express.Router();

taxRouter.get('/', async (req: Request, res: Response) => {
    try {
        let { start, end, method, finalise } = req.query;
        let startDate: Date = start !== undefined ? new Date(start as string) : new Date(0);
        let endDate: Date = end !== undefined ? new Date(end as string) : new Date();
        const accountingMethod = (method as string) || 'FIFO';
        const shouldFinalise = finalise === 'true';

        // Validate the accounting method early
        try {
            resolveStrategy(accountingMethod);
        } catch (error: any) {
            res.status(400).send({ error: error.message });
            return;
        }

        const transactions = await transactionRepository.getAll();
        const report = await generateTaxReport(
            transactions, "NOK", startDate, endDate,
            { accountingMethod, finalise: shouldFinalise },
            currencyRateRepository
        );

        // If finalised, persist lot consumption to storage (force=true since we mutated existing objects)
        if (shouldFinalise && transactionRepository.flush) {
            await transactionRepository.flush(true);
            logger.info(`Tax report finalised for ${start} to ${end} using ${accountingMethod} — lot assignments persisted`);
        }

        res.send(report);
    } catch (error: any) {
        res.status(500).send({ error: error.message });
    }
});
