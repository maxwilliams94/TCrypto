import express, { Express, Request, Response } from 'express';
import { transactionRepository } from '../index';
import { FileRepository } from '../repositories/file';
import { Transaction, TransactionType } from '../models/transaction';

export const transactionsRouter = express.Router();


transactionsRouter.get('/', async (req: Request, res: Response) => {
    try {
        const { type, asset, startDate, endDate } = req.query;
        
        let transactions = await transactionRepository.getAll();
        
        // Filter by transaction type (e.g., ?type=STAKING_REWARD)
        if (type) {
            transactions = transactions.filter(t => t.type === type);
        }
        
        // Filter by asset (e.g., ?asset=ETH)
        if (asset) {
            transactions = transactions.filter(t => 
                t.baseCurrency.toUpperCase() === (asset as string).toUpperCase()
            );
        }
        
        // Filter by date range
        if (startDate) {
            const start = new Date(startDate as string);
            transactions = transactions.filter(t => new Date(t.dateTime) >= start);
        }
        
        if (endDate) {
            const end = new Date(endDate as string);
            transactions = transactions.filter(t => new Date(t.dateTime) <= end);
        }
        
        res.json({
            count: transactions.length,
            transactions: transactions.map(t => t.toSimpleJSON())
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Add a new transaction (including staking rewards)
transactionsRouter.post('/', async (req: Request, res: Response) => {
    try {
        const { 
            baseCurrency, 
            quoteCurrency = 'NOK', 
            exchange = 'manual', 
            side = 'BUY', 
            baseSize, 
            price = 0, 
            fee = 0, 
            dateTime, 
            type = 'TRADE',
            validator,
            epoch,
            rewardSource 
        } = req.body;
        
        if (!baseCurrency || !baseSize || !dateTime) {
            res.status(400).json({ error: 'Missing required fields: baseCurrency, baseSize, dateTime' });
            return;
        }
        
        const quoteSize = parseFloat(baseSize) * parseFloat(price);
        const id = `${type.toLowerCase()}-${baseCurrency}-${new Date(dateTime).getTime()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const transaction = new Transaction(
            id,
            baseCurrency,
            quoteCurrency,
            exchange,
            side,
            parseFloat(baseSize),
            quoteSize,
            parseFloat(price),
            parseFloat(fee),
            new Date(dateTime),
            type as TransactionType,
            validator,
            epoch ? parseInt(epoch) : undefined,
            rewardSource
        );

        await transactionRepository.add(transaction);
        
        // Flush file storage if applicable
        if (transactionRepository instanceof FileRepository) {
            await transactionRepository.flush();
        }

        res.status(201).json({
            message: 'Transaction added successfully',
            transaction: transaction.toSimpleJSON()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

transactionsRouter.get('/export/csv', async (req: Request, res: Response) => {
    try {
        // Only works with FileRepository
        if (transactionRepository instanceof FileRepository) {
            const outputPath = './data/export.csv';
            await transactionRepository.exportToCSV(outputPath);
            res.download(outputPath, 'transactions.csv');
        } else {
            res.status(501).send({ error: 'CSV export only available with file-based storage' });
        }
    } catch (error: any) {
        res.status(500).send({ error: error.message });
    }
});

transactionsRouter.get('/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    transactionRepository.getByIndex(id).then(transaction => {
        if (transaction) {
            res.send(transaction);
        } else {
            res.status(404).send({ error: 'Transaction not found' });
        }
    }).catch(err => {
        res.status(500).send({ error: 'Internal server error' });
    });

});