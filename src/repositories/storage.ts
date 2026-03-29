import { Transaction } from "../models/transaction";

export interface TransactionStorage {
    add: (transaction: Transaction) => Promise<void>;
    getAll: () => Promise<Transaction[]>;
    getByDate: (startDate: Date, endDate: Date) => Promise<Transaction[]>;
    getById: (id: string) => Promise<Transaction | null>;
    getByIndex: (index: number) => Promise<Transaction | null>;
    getCount: () => Promise<number>;
    clear: () => Promise<void>;
    /** Persist any pending in-memory changes to durable storage.
     *  Pass force=true to persist even if no new transactions were added
     *  (e.g. when existing transaction objects were mutated in place).
     *  No-op for storage backends that don't buffer writes (e.g. in-memory). */
    flush?: (force?: boolean) => Promise<void>;
}