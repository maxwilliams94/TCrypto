import axios from 'axios';
import { CurrencyRate } from '../models/currencyRate';
import { CurrencyRateStorage } from '../repositories/currencyRateStorage';

export class ExchangeRateService {
    private BASE_URL = 'https://data.norges-bank.no/api/data/EXR/B.CCY.NOK.SP';
    private cryptoApiBaseUrl = 'https://api.coingecko.com/api/v3';
    
    constructor(private rateStorage: CurrencyRateStorage) {}

    /**
     * Fetches the currency to NOK exchange rate for a specific date.
     * @param currency The currency to convert from (e.g., 'USD', 'EUR').
     * @param date The date for which the exchange rate is required.
     * @returns The exchange rate as a number.
     */
    async getCcyNokRate(currency: string, date: Date): Promise<number> {
        // Try to get from storage first
        const existingRate = await this.rateStorage.getRate(currency, 'NOK', date);
        if (existingRate) {
            return existingRate.price;
        }

        // Fetch from Norges Bank API
        const rate = await this.fetchNorgesBankRate(currency, date);
        
        // Store for future use
        const currencyRate = new CurrencyRate(currency, 'NOK', rate, date, 'norges-bank');
        await this.rateStorage.add(currencyRate);
        await this.rateStorage.flush?.(); // Persist if supported

        return rate;
    }

    /**
     * Fetches cryptocurrency to USD exchange rate for a specific date.
     * @param cryptoSymbol The crypto symbol (e.g., 'BTC', 'ETH').
     * @param date The date for which the exchange rate is required.
     * @returns The exchange rate as a number.
     */
    async getCryptoUsdRate(cryptoSymbol: string, date: Date): Promise<number> {
        // Try storage first
        const existingRate = await this.rateStorage.getRate(cryptoSymbol, 'USD', date);
        if (existingRate) {
            return existingRate.price;
        }

        // Fetch from crypto API
        const rate = await this.fetchCryptoRate(cryptoSymbol, date);
        
        // Store for future use
        const currencyRate = new CurrencyRate(cryptoSymbol, 'USD', rate, date, 'coingecko');
        await this.rateStorage.add(currencyRate);
        await this.rateStorage.flush?.();

        return rate;
    }

    private async fetchNorgesBankRate(currency: string, date: Date): Promise<number> {
        const workingDate = getLatestWorkingDay(new Date(date)); // Don't mutate original date
        const base_url = this.BASE_URL.replace('CCY', mapCurrency(currency).toUpperCase());
        const url = `${base_url}?format=sdmx-json&startPeriod=${formatDateToYYYYMMDD(workingDate)}&endPeriod=${formatDateToYYYYMMDD(workingDate)}&locale=en`;

        try {
            const response = await axios.get(url);
            const observations = response.data?.data?.dataSets?.[0]?.series?.['0:0:0:0']?.observations;

            if (observations && observations['0'] && observations['0'][0]) {
                return parseFloat(observations['0'][0]);
            } else {
                throw new Error('Exchange rate data not found for the specified date.');
            }
        } catch (error) {
            console.error('Error fetching exchange rate from Norges Bank:', error);
            throw new Error('Failed to fetch exchange rate.');
        }
    }

    private async fetchCryptoRate(cryptoSymbol: string, date: Date): Promise<number> {
        const dateStr = formatDateToYYYYMMDD(date);
        const url = `${this.cryptoApiBaseUrl}/coins/${cryptoSymbol.toLowerCase()}/history?date=${dateStr.split('-').reverse().join('-')}&localization=false`;

        try {
            const response = await axios.get(url);
            const price = response.data?.market_data?.current_price?.usd;

            if (price) {
                return parseFloat(price);
            } else {
                throw new Error(`Crypto price data not found for ${cryptoSymbol} on ${dateStr}.`);
            }
        } catch (error) {
            console.error(`Error fetching crypto rate for ${cryptoSymbol}:`, error);
            throw new Error(`Failed to fetch crypto rate for ${cryptoSymbol}.`);
        }
    }
}

function formatDateToYYYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function mapCurrency(currency: string): string {
    if (currency.toUpperCase() === 'USDC') {
        return 'USD';
    }
    return currency;
}

function getLatestWorkingDay(date: Date): Date {
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday

    if (dayOfWeek === 0) {
        // If it's Sunday, go back to Friday
        date.setDate(date.getDate() - 2);
    } else if (dayOfWeek === 6) {
        // If it's Saturday, go back to Friday
        date.setDate(date.getDate() - 1);
    }

    return date;
}