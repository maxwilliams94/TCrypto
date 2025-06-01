// In-mememory storage

import { Transaction } from "../models/transaction";
import { TransactionStorage } from './storage';

export class MemoryRepository implements TransactionStorage {
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