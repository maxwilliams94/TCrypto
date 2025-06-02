import express, { Express, Request, Response, Application } from 'express';

import { createTransactionRespository } from './repositories/memory';
import { TransactionStorage } from './repositories/storage';
import { importInitialTransactions } from './services/transactionImporter';
import { transactionsRouter } from './routes/transactions';
import { taxRouter } from './routes/tax';

export const app: Application = express();

const PORT: string | number = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const transactionRepository: TransactionStorage = createTransactionRespository();
  
app.get('/', (req: Request, res: Response) => {
    transactionRepository.getCount().then(count => {
        res.send({"Transactions": count});
    })
});

app.use('/transactions', transactionsRouter);
app.use('/tax', taxRouter);

async function main() {
    await importInitialTransactions(transactionRepository)

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