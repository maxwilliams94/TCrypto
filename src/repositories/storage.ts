import { Transaction } from "../models/transaction";

export interface TransactionStorage {
    add: (transaction: Transaction) => Promise<void>;
    getAll: () => Promise<Transaction[]>;
    getByDate: (startDate: Date, endDate: Date) => Promise<Transaction[]>;
    getById: (id: string) => Promise<Transaction | null>;
    getByIndex: (index: number) => Promise<Transaction | null>;
    getCount: () => Promise<number>;
    clear: () => Promise<void>;
}