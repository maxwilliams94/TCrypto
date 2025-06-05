import * as fs from 'fs';
import csv from 'csv-parser';
import { isCryptoCryptoTransaction, Transaction } from '../models/transaction';
import { TransactionStorage } from '../repositories/storage';
import { ExchangeRateService } from './exchangeRateService';

const exchangeRateService = new ExchangeRateService();

export async function loadTransactionData(filePath: string, nativeCurrency: string): Promise<Array<Transaction>>{
    const data: Transaction[] = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', (headers) => {
            for (let reqHeader of ['Id', 'Status', 'Market', 'FilledQuantity', 'FilledQuote', 'FilledPrice', 'Filled At'])
            if (!headers.includes(reqHeader)) {
                reject(new Error(`${filePath} does not contain ${reqHeader}`));
            }
        })
        .on('data', (row) => {
            const transaction = new Transaction(
                row.Id,
                row.Market.split('-')[0].trim(),
                row.Market.split('-')[1].trim(),
                row.Exchange,
                row.Side,
                parseFloat(row.FilledQuantity),
                parseFloat(row.FilledQuote),
                parseFloat(row.FilledPrice),
                parseFloat(row.Fee || '0'),
                new Date(row['Filled At'])
            )
            data.push(transaction);
        })
        .on('end', () => {
            resolve(data.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime()));
        })
        .on('error', (error) => {
            reject(new Error(`Error reading file ${filePath}: ${error.message}`));
        })
    });
}


export async function importInitialTransactions(storage: TransactionStorage, nativeCurrency: string = 'NOK'): Promise<void> {
    let transactionDir = process.env.TRANSACTION_DIR;
    if (!transactionDir) {
        transactionDir = process.cwd();
    }
    console.info("Importing transactions from directory:", transactionDir);

    const fs = require('fs');
    const path = require('path');

    try {
        const files: string[] = await new Promise((resolve, reject) => {
            fs.readdir(transactionDir, (err: NodeJS.ErrnoException | null, files: string[]) => {
                if (err) {
                    reject(new Error(`Error reading directory ${transactionDir}: ${err.message}`));
                } else {
                    if (files.filter(f => f.endsWith(".csv")).length === 0) {
                        reject(new Error(`No files found in directory ${transactionDir}.`));
                    }
                    resolve(files);
                }
            });
        });

        for (const file of files) {
            const filePath = path.join(transactionDir, file);
            try {
                const transactions: Array<Transaction> = await loadTransactionData(filePath, 'NOK');
                const splitTransactions = await Promise.all(
                    transactions.map(async (transaction: Transaction) => await splitCryptoCryptoTransaction(transaction, nativeCurrency))
                );
                splitTransactions.flat().forEach((transaction: Transaction) => {
                    storage.add(transaction);
                });
                console.log(`Successfully imported transactions from ${filePath}`);
            } catch (error: any) {
                console.error(`Error importing transactions from ${filePath}: ${error.message}`);
            }
        }

        const allTransactions = await storage.getAll();
        console.info(`Transaction import process completed. There are ${allTransactions.length} transactions in the repository.`);
    } catch (error: any) {
        console.error(error.message);
    }
}

async function splitCryptoCryptoTransaction(transaction: Transaction, nativeCurrency: string): Promise<Transaction[]> {
    if (!isCryptoCryptoTransaction(transaction)) return [transaction];

    //split the transaction into two transactions as we must consider the quote currency as being sold
    const exchangeRate: number = await exchangeRateService.getCcyNokRate(transaction.quoteCurrency, transaction.dateTime)
    console.log("Exchange rate for", transaction.quoteCurrency, "on", transaction.dateTime, "is", exchangeRate);
    const sellTransaction = new Transaction(
        transaction.id + '-sell',
        transaction.quoteCurrency,
        nativeCurrency!,
        transaction.exchange,
        "SELL",
        transaction.quoteSize,
        transaction.quoteSize * exchangeRate,
        exchangeRate,
        0,
        transaction.dateTime);
    const buyTransaction = new Transaction(
        transaction.id + '-buy',
        transaction.baseCurrency,
        nativeCurrency!,
        transaction.exchange,
        "BUY",
        transaction.baseSize,
        transaction.quoteSize * exchangeRate,
        transaction.price * exchangeRate,
        transaction.fee * exchangeRate,
        transaction.dateTime
    );
    console.log("Split transaction into:", sellTransaction.toSimpleJSON(), buyTransaction.toSimpleJSON());
    return [sellTransaction, buyTransaction];

    
        
        
                
}
