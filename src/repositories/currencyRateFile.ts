import logger from '../logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CurrencyRate } from '../models/currencyRate';
import { CurrencyRateStorage } from './currencyRateStorage';

export class CurrencyRateFileRepository implements CurrencyRateStorage {
    private rates: Map<string, CurrencyRate> = new Map();
    private filePath: string;
    private isLoaded: boolean = false;
    private isDirty: boolean = false;

    constructor(filePath: string = './data/currency-rates.json') {
        this.filePath = filePath;
    }

    private async ensureLoaded(): Promise<void> {
        if (this.isLoaded) return;
        
        try {
            const dir = path.dirname(this.filePath);
            await fs.mkdir(dir, { recursive: true });

            const data = await fs.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(data);
            
            this.rates.clear();
            parsed.forEach((r: any) => {
                const rate = new CurrencyRate(r.asset, r.quote, r.price, new Date(r.date), r.source);
                this.rates.set(rate.getCacheKey(), rate);
            });

            logger.info(`Loaded ${this.rates.size} currency rates from ${this.filePath}`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                logger.info(`No existing currency rates file found at ${this.filePath}. Starting fresh.`);
                this.rates.clear();
            } else {
                logger.error(`Error loading currency rates: ${error.message}`);
                throw error;
            }
        }
        
        this.isLoaded = true;
    }

    private async persist(): Promise<void> {
        try {
            const data = JSON.stringify(Array.from(this.rates.values()), null, 2);
            await fs.writeFile(this.filePath, data, 'utf-8');
            this.isDirty = false;
            logger.info(`Persisted ${this.rates.size} currency rates to ${this.filePath}`);
        } catch (error: any) {
            logger.error(`Error persisting currency rates: ${error.message}`);
            throw error;
        }
    }

    async add(rate: CurrencyRate): Promise<void> {
        await this.ensureLoaded();
        this.rates.set(rate.getCacheKey(), rate);
        this.isDirty = true;
    }

    async addBatch(rates: CurrencyRate[]): Promise<void> {
        await this.ensureLoaded();
        rates.forEach(rate => this.rates.set(rate.getCacheKey(), rate));
        this.isDirty = true;
    }

    async flush(): Promise<void> {
        if (this.isDirty) {
            await this.persist();
        }
    }

    async getRate(asset: string, quote: string, date: Date): Promise<CurrencyRate | null> {
        await this.ensureLoaded();
        const tempRate = new CurrencyRate(asset, quote, 0, date, '');
        const key = tempRate.getCacheKey();
        return this.rates.get(key) || null;
    }

    async getRatesByAsset(asset: string, quote: string): Promise<CurrencyRate[]> {
        await this.ensureLoaded();
        return Array.from(this.rates.values()).filter(rate => 
            rate.asset === asset && rate.quote === quote
        );
    }

    async getRatesByDate(date: Date): Promise<CurrencyRate[]> {
        await this.ensureLoaded();
        const targetDateStr = date.toISOString().split('T')[0];
        return Array.from(this.rates.values()).filter(rate => 
            rate.date.toISOString().split('T')[0] === targetDateStr
        );
    }

    async getAll(): Promise<CurrencyRate[]> {
        await this.ensureLoaded();
        return Array.from(this.rates.values());
    }

    async clear(): Promise<void> {
        await this.ensureLoaded();
        this.rates.clear();
        await this.persist();
    }
}

export function createCurrencyRateFileRepository(filePath?: string): CurrencyRateFileRepository {
    return new CurrencyRateFileRepository(filePath);
}