import axios from 'axios';
import { CurrencyRate } from '../models/currencyRate';
import { CurrencyRateStorage } from '../repositories/currencyRateStorage';

export class ExchangeRateService {
    private BASE_URL = 'https://data.norges-bank.no/api/data/EXR/B.CCY.NOK.SP';
    private cryptoApiBaseUrl = 'https://api.coingecko.com/api/v3';
    private coinGeckoApiKey: string | undefined;
    
    constructor(private rateStorage: CurrencyRateStorage) {
        this.coinGeckoApiKey = process.env.COINGECKO_API_KEY;
        if (this.coinGeckoApiKey) {
            console.log('CoinGecko API key found - using authenticated requests');
        } else {
            console.log('WARNING: No CoinGecko API key found. CoinGecko now requires API keys for all requests.');
            console.log('Sign up for a free Demo account at https://www.coingecko.com/en/api/pricing');
            console.log('Set COINGECKO_API_KEY environment variable to enable crypto price fetching.');
        }
    }

    /**
     * Helper method to create CoinGecko API requests with required authentication.
     * CoinGecko no longer supports unauthenticated requests.
     */
    private async makeCoingeckoRequest(url: string): Promise<any> {
        if (!this.coinGeckoApiKey) {
            throw new Error(
                'CoinGecko API key is required. Get a free Demo account at https://www.coingecko.com/en/api/pricing ' +
                'and set the COINGECKO_API_KEY environment variable.'
            );
        }

        const config = {
            headers: {
                'x-cg-demo-api-key': this.coinGeckoApiKey
            }
        };

        try {
            const response = await axios.get(url, config);
            return response;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error(`CoinGecko API error: ${error.response?.status} - ${error.response?.statusText}`);
                console.error('URL:', url);
                if (error.response?.status === 401) {
                    console.error('Authentication failed - check your CoinGecko API key');
                    console.error('Get a free API key at: https://www.coingecko.com/en/api/pricing');
                } else if (error.response?.status === 429) {
                    console.error('Rate limit exceeded - Demo plan allows 30 calls/minute, 10k calls/month');
                }
            }
            throw error;
        }
    }

    /**
     * Fetches the currency to NOK exchange rate for a specific date.
     * @param currency The currency to convert from (e.g., 'USD', 'EUR').
     * @param date The date for which the exchange rate is required.
     * @returns The exchange rate as a number.
     */
    async getCcyNokRate(currency: string, date: Date): Promise<number> {
        // Try to get from storage first (normalize date to start of day)
        const normalizedDate = this.normalizeDate(date);
        const existingRate = await this.rateStorage.getRate(currency, 'NOK', normalizedDate);
        if (existingRate) {
            return existingRate.price;
        }

        // Fetch from Norges Bank API
        const rate = await this.fetchNorgesBankRate(currency, date);
        
        // Store for future use (normalize date to start of day)
        const currencyRate = new CurrencyRate(currency, 'NOK', rate, normalizedDate, 'norges-bank');
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
        // Try storage first (normalize date to start of day)
        const normalizedDate = this.normalizeDate(date);
        const existingRate = await this.rateStorage.getRate(cryptoSymbol, 'USD', normalizedDate);
        if (existingRate) {
            return existingRate.price;
        }

        // Fetch from crypto API
        const rate = await this.fetchCryptoRate(cryptoSymbol, date);
        
        // Store for future use (normalize date to start of day)
        const currencyRate = new CurrencyRate(cryptoSymbol, 'USD', rate, normalizedDate, 'coingecko');
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

    /**
     * Fetches cryptocurrency price in any supported currency for a specific date.
     * @param cryptoSymbol The crypto symbol (e.g., 'bitcoin', 'ethereum') - CoinGecko coin ID.
     * @param quoteCurrency The target currency (e.g., 'usd', 'eur', 'nok').
     * @param date The date for which the price is required.
     * @returns The price as a number.
     */
    async getCryptoPriceInCurrency(cryptoSymbol: string, quoteCurrency: string, date: Date): Promise<number> {
        const normalizedQuote = quoteCurrency.toLowerCase();
        
        // Try storage first (normalize date to start of day)
        const normalizedDate = this.normalizeDate(date);
        const existingRate = await this.rateStorage.getRate(cryptoSymbol.toUpperCase(), quoteCurrency.toUpperCase(), normalizedDate);
        if (existingRate) {
            return existingRate.price;
        }

        // Fetch from CoinGecko API
        const price = await this.fetchCryptoHistoricalPrice(cryptoSymbol, normalizedQuote, date);
        
        // Store for future use (normalize date to start of day)
        const currencyRate = new CurrencyRate(
            cryptoSymbol.toUpperCase(), 
            quoteCurrency.toUpperCase(), 
            price, 
            normalizedDate, 
            'coingecko'
        );
        await this.rateStorage.add(currencyRate);
        await this.rateStorage.flush?.();

        return price;
    }

    /**
     * Get current cryptocurrency price (useful for recent staking rewards).
     * @param cryptoSymbol The crypto symbol (CoinGecko coin ID).
     * @param quoteCurrency The target currency.
     * @returns The current price as a number.
     */
    async getCurrentCryptoPrice(cryptoSymbol: string, quoteCurrency: string): Promise<number> {
        const normalizedQuote = quoteCurrency.toLowerCase();
        const coinId = this.mapSymbolToCoinGeckoId(cryptoSymbol);
        
        const url = `${this.cryptoApiBaseUrl}/simple/price?ids=${coinId}&vs_currencies=${normalizedQuote}`;

        try {
            const response = await this.makeCoingeckoRequest(url);
            const price = response.data?.[coinId]?.[normalizedQuote];

            if (price) {
                return parseFloat(price);
            } else {
                throw new Error(`Current crypto price not found for ${cryptoSymbol} in ${quoteCurrency}.`);
            }
        } catch (error) {
            console.error(`Error fetching current crypto price for ${cryptoSymbol}:`, error);
            throw new Error(`Failed to fetch current crypto price for ${cryptoSymbol}.`);
        }
    }

    /**
     * Batch fetch multiple cryptocurrency prices for a specific date.
     * Useful for processing multiple staking rewards at once.
     */
    async getBatchCryptoPrices(
        cryptoSymbols: string[], 
        quoteCurrency: string, 
        date: Date
    ): Promise<Map<string, number>> {
        const results = new Map<string, number>();
        const normalizedQuote = quoteCurrency.toLowerCase();
        
        // Try to get cached prices first (normalize date to start of day)
        const normalizedDate = this.normalizeDate(date);
        const uncachedSymbols: string[] = [];
        for (const symbol of cryptoSymbols) {
            const existingRate = await this.rateStorage.getRate(symbol.toUpperCase(), quoteCurrency.toUpperCase(), normalizedDate);
            if (existingRate) {
                results.set(symbol.toUpperCase(), existingRate.price);
            } else {
                uncachedSymbols.push(symbol);
            }
        }

        // Fetch uncached prices (with rate limiting consideration)
        for (const symbol of uncachedSymbols) {
            try {
                const price = await this.fetchCryptoHistoricalPrice(symbol, normalizedQuote, date);
                results.set(symbol.toUpperCase(), price);
                
                // Store for future use (normalize date to start of day)
                const normalizedDate = this.normalizeDate(date);
                const currencyRate = new CurrencyRate(
                    symbol.toUpperCase(), 
                    quoteCurrency.toUpperCase(), 
                    price, 
                    normalizedDate, 
                    'coingecko'
                );
                await this.rateStorage.add(currencyRate);
                
                // Small delay to respect rate limits (CoinGecko free tier: 10-30 calls/minute)
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.warn(`Failed to fetch price for ${symbol}: ${error}`);
                // Continue with other symbols
            }
        }

        await this.rateStorage.flush?.();
        return results;
    }

    private async fetchCryptoRate(cryptoSymbol: string, date: Date): Promise<number> {
        return this.fetchCryptoHistoricalPrice(cryptoSymbol, 'usd', date);
    }

    private async fetchCryptoHistoricalPrice(cryptoSymbol: string, quoteCurrency: string, date: Date): Promise<number> {
        const coinId = this.mapSymbolToCoinGeckoId(cryptoSymbol);
        const dateStr = formatDateToDDMMYYYY(date); // CoinGecko expects DD-MM-YYYY format
        
        const url = `${this.cryptoApiBaseUrl}/coins/${coinId}/history?date=${dateStr}&localization=false`;

        try {
            const response = await this.makeCoingeckoRequest(url);
            const price = response.data?.market_data?.current_price?.[quoteCurrency.toLowerCase()];

            if (price) {
                return parseFloat(price);
            } else {
                throw new Error(`Crypto price data not found for ${cryptoSymbol} in ${quoteCurrency} on ${dateStr}.`);
            }
        } catch (error) {
            console.error(`Error fetching crypto price for ${cryptoSymbol}:`, error);
            
            // If historical data fails, try a fallback approach for recent dates
            if (this.isRecentDate(date)) {
                console.log(`Attempting current price fallback for recent date: ${cryptoSymbol}`);
                try {
                    return await this.getCurrentCryptoPrice(cryptoSymbol, quoteCurrency);
                } catch (fallbackError) {
                    console.error(`Fallback also failed: ${fallbackError}`);
                }
            }
            
            throw new Error(`Failed to fetch crypto price for ${cryptoSymbol} in ${quoteCurrency}.`);
        }
    }

    /**
     * Map common cryptocurrency symbols to CoinGecko coin IDs.
     * This mapping is essential because CoinGecko uses coin IDs (e.g., 'bitcoin') rather than symbols (e.g., 'BTC').
     */
    private mapSymbolToCoinGeckoId(symbol: string): string {
        const symbolMap: { [key: string]: string } = {
            'BTC': 'bitcoin',
            'ETH': 'ethereum',
            'ADA': 'cardano',
            'DOT': 'polkadot',
            'SOL': 'solana',
            'AVAX': 'avalanche-2',
            'MATIC': 'matic-network',
            'ATOM': 'cosmos',
            'NEAR': 'near',
            'FTM': 'fantom',
            'ALGO': 'algorand',
            'TEZOS': 'tezos',
            'XTZ': 'tezos',
            'ONE': 'harmony',
            'EGLD': 'elrond-erd-2',
            'OSMO': 'osmosis',
            'JUNO': 'juno-network',
            'SCRT': 'secret',
            'LUNA': 'terra-luna-2',
            'UST': 'terrausd',
            'USDC': 'usd-coin',
            'USDT': 'tether',
            'DAI': 'dai',
            'LINK': 'chainlink',
            'UNI': 'uniswap',
            'AAVE': 'aave',
            'COMP': 'compound-governance-token',
            'MKR': 'maker',
            'SNX': 'havven',
            'CRV': 'curve-dao-token',
            'YFI': 'yearn-finance',
            'SUSHI': 'sushi',
            'BAL': 'balancer',
            'RUNE': 'thorchain',
            'CAKE': 'pancakeswap-token'
        };

        const upperSymbol = symbol.toUpperCase();
        return symbolMap[upperSymbol] || symbol.toLowerCase();
    }

    private isRecentDate(date: Date): boolean {
        const now = new Date();
        const diffInDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
        return diffInDays <= 7; // Consider within last 7 days as "recent"
    }

    /**
     * Normalize date to start of day (00:00:00) to ensure consistent caching
     * This prevents multiple cache entries for the same date with different times
     */
    private normalizeDate(date: Date): Date {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }
}

function formatDateToYYYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateToDDMMYYYY(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${day}-${month}-${year}`;
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