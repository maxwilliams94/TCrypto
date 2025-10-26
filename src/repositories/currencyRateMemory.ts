import { CurrencyRate } from '../models/currencyRate';
import { CurrencyRateStorage } from './currencyRateStorage';

export var currencyRateRepository: CurrencyRateMemoryRepository;

export class CurrencyRateMemoryRepository implements CurrencyRateStorage {
    private rates: Map<string, CurrencyRate> = new Map();

    async add(rate: CurrencyRate): Promise<void> {
        this.rates.set(rate.getCacheKey(), rate);
    }

    async addBatch(rates: CurrencyRate[]): Promise<void> {
        rates.forEach(rate => this.rates.set(rate.getCacheKey(), rate));
    }

    async getRate(asset: string, quote: string, date: Date): Promise<CurrencyRate | null> {
        const tempRate = new CurrencyRate(asset, quote, 0, date, '');
        const key = tempRate.getCacheKey();
        return this.rates.get(key) || null;
    }

    async getRatesByAsset(asset: string, quote: string): Promise<CurrencyRate[]> {
        return Array.from(this.rates.values()).filter(rate => 
            rate.asset === asset && rate.quote === quote
        );
    }

    async getRatesByDate(date: Date): Promise<CurrencyRate[]> {
        const targetDateStr = date.toISOString().split('T')[0];
        return Array.from(this.rates.values()).filter(rate => 
            rate.date.toISOString().split('T')[0] === targetDateStr
        );
    }

    async getAll(): Promise<CurrencyRate[]> {
        return Array.from(this.rates.values());
    }

    async clear(): Promise<void> {
        this.rates.clear();
    }
}

export function createCurrencyRateRepository(): CurrencyRateMemoryRepository {
    if (!currencyRateRepository) {
        currencyRateRepository = new CurrencyRateMemoryRepository();
    }
    return currencyRateRepository;
}