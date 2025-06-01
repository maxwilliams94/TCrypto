import express, { Express, Request, Response, Application } from 'express';

import { MemoryRepository } from './repositories/memory';
import { Transaction } from './models/transaction';
import { TransactionStorage } from './repositories/storage';

const app: Application = express();

const PORT: string | number = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

  
app.get('/', (req: Request, res: Response) => {
    transactionRepository.getAll().then(transactions => {
        res.send({"Transactions": transactions.length});
    })
});

app.get('/transactions', (req: Request, res: Response) => {
    transactionRepository.getAll().then(transactions => {
        res.send(transactions.map(transaction => transaction.toJSON()));
    })}
);

const transactionRepository = new MemoryRepository();
const transactionImporter = require('./services/transactionImporter');


async function main() {
    await transactionImporter.importInitialTransactions(transactionRepository)

    try {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
    } catch (error) {
    if (error instanceof Error) {
        console.error(`Error starting server: ${error.message}`);
    } else {
        console.error('An unknown error occurred while starting the server.');
    }
    process.exit(1);
    }
}
main();