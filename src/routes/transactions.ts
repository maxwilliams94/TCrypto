import express, { Express, Request, Response } from 'express';
import { transactionRepository } from '../index';
import { FileRepository } from '../repositories/file';

export const transactionsRouter = express.Router();


transactionsRouter.get('/', async (req: Request, res: Response) => {
    transactionRepository.getAll().then(transactions => {
        res.send(transactions);
    })}
);

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