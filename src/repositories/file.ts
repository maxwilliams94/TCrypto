import logger from '../logger';
// File-based persistent storage for transactions

import * as fs from 'fs/promises';
import * as path from 'path';
import { Transaction } from "../models/transaction";
import { TransactionStorage } from './storage';

export class FileRepository implements TransactionStorage {
    private transactions: Transaction[] = [];
    private filePath: string;
    private isLoaded: boolean = false;
    private isDirty: boolean = false; // Track if we have unsaved changes

    constructor(filePath: string = './data/transactions.json') {
        this.filePath = filePath;
    }

    private async ensureLoaded(): Promise<void> {
        if (this.isLoaded) return;

        try {
            // Ensure directory exists
            const dir = path.dirname(this.filePath);
            await fs.mkdir(dir, { recursive: true });

            // Try to read existing file
            const data = await fs.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(data);
            
            // Reconstruct Transaction objects with proper Date objects
            this.transactions = parsed.map((t: any) => {
                const transaction = new Transaction(
                    t.id,
                    t.baseCurrency,
                    t.quoteCurrency,
                    t.exchange,
                    t.side,
                    t.baseSize,
                    t.quoteSize,
                    t.price,
                    t.fee,
                    new Date(t.dateTime),
                    t.type ?? 'TRADE'
                );
                
                // Restore tax conversion fields
                if (t.taxCurrency !== undefined) transaction.taxCurrency = t.taxCurrency;
                if (t.taxQuoteSize !== undefined) transaction.taxQuoteSize = t.taxQuoteSize;
                if (t.taxPrice !== undefined) transaction.taxPrice = t.taxPrice;
                if (t.taxFee !== undefined) transaction.taxFee = t.taxFee;
                if (t.taxConversionRate !== undefined) transaction.taxConversionRate = t.taxConversionRate;
                if (t.taxConversionDate) transaction.taxConversionDate = new Date(t.taxConversionDate);
                if (t.feeCurrency !== undefined) transaction.feeCurrency = t.feeCurrency;
                
                // Restore processing/leg/source
                if (t.sourceTransactionId !== undefined) transaction.sourceTransactionId = t.sourceTransactionId;
                if (t.leg !== undefined) transaction.leg = t.leg;
                if (t.processingSequence !== undefined) transaction.processingSequence = t.processingSequence;
                
                // Restore reward/income fields
                if (t.rewardSource !== undefined) transaction.rewardSource = t.rewardSource;
                if (t.incomeValue !== undefined) transaction.incomeValue = t.incomeValue;
                if (t.incomeValueInTaxCurrency !== undefined) transaction.incomeValueInTaxCurrency = t.incomeValueInTaxCurrency;
                if (t.incomeConversionRate !== undefined) transaction.incomeConversionRate = t.incomeConversionRate;
                if (t.incomeDate) transaction.incomeDate = new Date(t.incomeDate);
                
                return transaction;
            });

            logger.info(`Loaded ${this.transactions.length} transactions from ${this.filePath}`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                logger.info(`No existing transaction file found at ${this.filePath}. Starting fresh.`);
                this.transactions = [];
            } else {
                logger.error(`Error loading transactions: ${error.message}`);
                throw error;
            }
        }
        
        this.isLoaded = true;
    }

    private async persist(): Promise<void> {
        try {
            const data = JSON.stringify(this.transactions, null, 2);
            await fs.writeFile(this.filePath, data, 'utf-8');
            this.isDirty = false;
            console.log(`Persisted ${this.transactions.length} transactions to ${this.filePath}`);
        } catch (error: any) {
            console.error(`Error persisting transactions: ${error.message}`);
            throw error;
        }
    }

    async add(transaction: Transaction): Promise<void> {
        await this.ensureLoaded();
        this.transactions.push(transaction);
        this.isDirty = true; // Mark as having unsaved changes
    }

    async addBatch(transactions: Transaction[]): Promise<void> {
        await this.ensureLoaded();
        this.transactions.push(...transactions);
        this.isDirty = true;
    }

    async flush(): Promise<void> {
        if (this.isDirty) {
            await this.persist();
        }
    }

    async getAll(): Promise<Transaction[]> {
        await this.ensureLoaded();
        return this.transactions.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
    }

    async getByDate(startDate: Date, endDate: Date): Promise<Transaction[]> {
        await this.ensureLoaded();
        return this.transactions.filter(transaction => 
            transaction.dateTime >= startDate && transaction.dateTime <= endDate
        )
        .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
    }

    async getById(id: string): Promise<Transaction | null> {
        await this.ensureLoaded();
        const transaction = this.transactions.find(transaction => transaction.id === id);
        return transaction || null;
    }

    async getByIndex(index: number): Promise<Transaction | null> {
        await this.ensureLoaded();
        if (index < 0 || index >= this.transactions.length) {
            return null;
        }
        return this.transactions[index];
    }

    async getCount(): Promise<number> {
        await this.ensureLoaded();
        return this.transactions.length;
    }

    async clear(): Promise<void> {
        await this.ensureLoaded();
        this.transactions = [];
        await this.persist();
    }

    /**
     * Export transactions to CSV format
     * @param outputPath Path where CSV should be written
     */
    async exportToCSV(outputPath: string): Promise<void> {
        await this.ensureLoaded();
        
        const headers = ['Id', 'Status', 'Type', 'Market', 'Exchange', 'Side', 'FilledQuantity', 'FilledQuote', 'FilledPrice', 'Fee', 'Filled At'];
        const rows = this.transactions
            .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime())
            .map(t => {
                const filledQuoteNumber = t.isReward()
                    ? (t.getIncomeValueInTaxCurrency() || t.getIncomeValue() || 0)
                    : (t.taxQuoteSize !== undefined
                        ? t.taxQuoteSize
                        : ((t.quoteSize ?? 0) * (t.taxConversionRate ?? 1)));
                return [
                    t.id || '',
                    'FILLED', // Assuming all stored transactions are filled
                    t.type || 'TRADE',
                    `${t.baseCurrency}-${t.quoteCurrency}`,
                    t.exchange || '',
                    t.side || '',
                    (t.baseSize ?? 0).toString(),
                    (filledQuoteNumber ?? 0).toString(),
                    (t.price ?? 0).toString(),
                    (t.fee ?? 0).toString(),
                    t.dateTime ? t.dateTime.toISOString() : ''
                ];
            });

        const csv = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');

        await fs.writeFile(outputPath, csv, 'utf-8');
        console.log(`Exported ${this.transactions.length} transactions to ${outputPath}`);
    }
}

export function createFileRepository(filePath?: string): FileRepository {
    return new FileRepository(filePath);
}
