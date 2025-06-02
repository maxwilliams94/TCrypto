// In-mememory storage

import { Transaction } from "../models/transaction";
import { TransactionStorage } from './storage';

export var transactionRepository: MemoryRepository;

export class MemoryRepository implements TransactionStorage {
    async getByIndex(index: number): Promise<Transaction | null> {
        if (index < 0 || index >= this.transactions.length) {
            return null;
        }
        return this.transactions[index];
    }

    async getCount(): Promise<number> {
        return Promise.resolve(this.transactions.length);
    }

    async clear(): Promise<void> {
        this.transactions = [];
    }
    private transactions: Transaction[] = [];

    async add(transaction: Transaction): Promise<void> {
        this.transactions.push(transaction);
    }

    async getAll(): Promise<Transaction[]> {
        return this.transactions;
    }

    async getByDate(startDate: Date, endDate: Date): Promise<Transaction[]> {
        return this.transactions.filter(transaction => 
            transaction.dateTime >= startDate && transaction.dateTime <= endDate
        );
    }
    async getById(id: string): Promise<Transaction | null> {
        const transaction = this.transactions.find(transaction => transaction.id === id);
        return transaction || null;
    }
}


export function createTransactionRespository(): MemoryRepository {
    if (!transactionRepository) {
        transactionRepository = new MemoryRepository();
    }
    return transactionRepository;
}