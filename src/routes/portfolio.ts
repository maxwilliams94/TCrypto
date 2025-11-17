import express, { Request, Response } from 'express';
import { generatePortfolioSnapshot } from '../services/portfolioService';
import { transactionRepository, currencyRateRepository } from '../index';

export const portfolioRouter = express.Router();

portfolioRouter.get('/', async (req: Request, res: Response) => {
    try {
        const { date } = req.query;
        const asOfDate: Date = date !== undefined ? new Date(date as string) : new Date();

        const transactions = await transactionRepository.getAll();
        const portfolio = await generatePortfolioSnapshot(transactions, "NOK", asOfDate, currencyRateRepository);
        
        res.send(portfolio);
    } catch (error) {
        res.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
});
