import express, { Express, Request, Response } from 'express';
import { transactionRepository } from '../repositories/memory';

export const transactionsRouter = express.Router();


transactionsRouter.get('/', async (req: Request, res: Response) => {
    transactionRepository.getAll().then(transactions => {
        res.send(transactions);
    })}
);

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