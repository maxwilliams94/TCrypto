import { CurrencyRate } from '../models/currencyRate';

export interface CurrencyRateStorage {
    add: (rate: CurrencyRate) => Promise<void>;
    addBatch: (rates: CurrencyRate[]) => Promise<void>;
    getRate: (asset: string, quote: string, date: Date) => Promise<CurrencyRate | null>;
    getRatesByAsset: (asset: string, quote: string) => Promise<CurrencyRate[]>;
    getRatesByDate: (date: Date) => Promise<CurrencyRate[]>;
    getAll: () => Promise<CurrencyRate[]>;
    clear: () => Promise<void>;
    flush?: () => Promise<void>; // For file-based implementations
}