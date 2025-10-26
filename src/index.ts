import express, { Express, Request, Response, Application } from 'express';

import { createTransactionRespository } from './repositories/memory';
import { createFileRepository, FileRepository } from './repositories/file';
import { TransactionStorage } from './repositories/storage';
import { importInitialTransactions } from './services/transactionImporter';
import { transactionsRouter } from './routes/transactions';
import { taxRouter } from './routes/tax';

export const app: Application = express();

const PORT: string | number = process.env.PORT || 3000;
const USE_FILE_STORAGE: boolean = process.env.USE_FILE_STORAGE === 'true';
const DATA_FILE_PATH: string = process.env.DATA_FILE_PATH || './data/transactions.json';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const transactionRepository: TransactionStorage = USE_FILE_STORAGE 
    ? createFileRepository(DATA_FILE_PATH)
    : createTransactionRespository();

export { transactionRepository };

console.log(`Using ${USE_FILE_STORAGE ? 'file-based' : 'in-memory'} storage${USE_FILE_STORAGE ? ` at ${DATA_FILE_PATH}` : ''}`);

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    
    // Flush any pending writes for file-based storage
    if (transactionRepository instanceof FileRepository) {
        console.log('Flushing transactions to disk...');
        await transactionRepository.flush();
    }
    
    console.log('Shutdown complete. Exiting.');
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Kill command
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));   // Terminal closed
  
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