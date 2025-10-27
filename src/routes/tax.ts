import express, { Express, Request, Response } from 'express';
import { generateTaxReport } from '../services/profitReporter';
import { transactionRepository, currencyRateRepository } from '../index';

export const taxRouter = express.Router();

taxRouter.get('/', (req: Request, res: Response) => {
    let { start, end } = req.query;
    let startDate: Date = start !== undefined ? new Date(start as string) : new Date(0);
    let endDate: Date = end !== undefined ? new Date(end as string) : new Date();

    transactionRepository
        .getAll()
        .then((transactions) => {
            return generateTaxReport(transactions, "NOK", startDate, endDate, 'FIFO', currencyRateRepository);
        })
        .then((report) => {
            res.send(report);
        })
        .catch((error) => {
            res.status(500).send({ error: error.message });
        });
});
