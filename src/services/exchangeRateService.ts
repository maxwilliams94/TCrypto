import logger from '../logger';
import axios from 'axios';
import * as fs from 'fs/promises';
import csv from 'csv-parser';
import { CurrencyRate } from '../models/currencyRate';
import { CurrencyRateStorage } from '../repositories/currencyRateStorage';

export class ExchangeRateService {
    private BASE_URL = 'https://data.norges-bank.no/api/data/EXR/B.CCY.NOK.SP';
    private cryptoApiBaseUrl = 'https://api.coingecko.com/api/v3';
    private coinGeckoApiKey: string | undefined;
    private csvRatesLoaded: boolean = false;
    private csvRatesMap: Map<string, Map<string, Array<{ date: string; rate: number }>>> = new Map();
    
    constructor(private rateStorage: CurrencyRateStorage) {
        this.coinGeckoApiKey = process.env.COINGECKO_API_KEY;
        if (this.coinGeckoApiKey) {
            logger.debug('CoinGecko API key found - using authenticated requests');
        } else {
            logger.warn('WARNING: No CoinGecko API key found. CoinGecko now requires API keys for all requests.');
            logger.info('Set COINGECKO_API_KEY environment variable to enable crypto price fetching.');
        }
    }

    /**
     * Helper method to create CoinGecko API requests with required authentication.
     * CoinGecko no longer supports unauthenticated requests.
     */
    private async makeCoingeckoRequest(url: string): Promise<any> {
        if (!this.coinGeckoApiKey) {
            throw new Error(
                'CoinGecko API key is required. Set the COINGECKO_API_KEY environment variable.'
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
                logger.error(`CoinGecko API error: ${error.response?.status} - ${error.response?.statusText}`);
                logger.error(`URL: ${url}`);
                if (error.response?.status === 401) {
                    logger.error('Authentication failed - check your CoinGecko API key');
                    logger.error('Get a free API key at: https://www.coingecko.com/en/api/pricing');
                } else if (error.response?.status === 429) {
                    logger.error('Rate limit exceeded - Demo plan allows 30 calls/minute, 10k calls/month');
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
        // Short-circuit: if currency is already NOK, no conversion needed
        if (currency.toUpperCase() === 'NOK') {
            return 1.0;
        }

        // Try to get from storage first (normalize date to start of day)
        const normalizedDate = this.normalizeDate(date);
        const existingRate = await this.rateStorage.getRate(currency, 'NOK', normalizedDate);
        if (existingRate) {
            // Return cached value immediately without waiting
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
            // Return cached value immediately without API call
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
        const base_url = this.BASE_URL.replace('CCY', mapCurrency(currency).toUpperCase());
        
        // Try up to 10 days back to handle weekends and bank holidays
        const maxRetries = 6;
        let currentDate = new Date(date); // Don't mutate original date
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const url = `${base_url}?format=sdmx-json&startPeriod=${formatDateToYYYYMMDD(currentDate)}&endPeriod=${formatDateToYYYYMMDD(currentDate)}&locale=en`;

            try {
                const response = await axios.get(url);
                const observations = response.data?.data?.dataSets?.[0]?.series?.['0:0:0:0']?.observations;

                if (observations && observations['0'] && observations['0'][0]) {
                    if (attempt > 0) {
                        logger.debug(`Found exchange rate for ${currency} on ${formatDateToYYYYMMDD(currentDate)} (requested: ${formatDateToYYYYMMDD(date)})`);
                    }
                    return parseFloat(observations['0'][0]);
                }
                // No data in response - try previous day
                logger.warn(`No data from Norges Bank for ${currency} on ${formatDateToYYYYMMDD(currentDate)}, trying previous day...`);
            } catch (error) {
                if (axios.isAxiosError(error)) {
                    // 404 means no data for this date (non-working day)
                    if (error.response?.status === 404) {
                        logger.warn(`No data from Norges Bank for ${currency} on ${formatDateToYYYYMMDD(currentDate)} (404), trying previous day...`);
                    } else {
                        // Other HTTP errors might be more serious, but still try previous day
                        logger.warn(`HTTP ${error.response?.status} from Norges Bank for ${currency} on ${formatDateToYYYYMMDD(currentDate)}, trying previous day...`);
                    }
                } else {
                    // Non-axios error - something more serious, don't retry
                    console.error('Error fetching exchange rate from Norges Bank:', error);
                    throw new Error('Failed to fetch exchange rate.');
                }
            }
            
            // Go back one day and try again
            currentDate.setDate(currentDate.getDate() - 1);
        }
        
        // Fallback to CSV rates on API failure
        logger.info(`Norges Bank API failed for ${currency}. Attempting fallback to CSV rates...`);
        try {
            return await this.getCsvRate(currency, date);
        } catch (csvError) {
            throw new Error(`Failed to fetch exchange rate for ${currency} from API and CSV fallback: ${csvError}`);
        }
    }

    /**
     * Fetches cryptocurrency price in any supported currency for a specific date.
     * Also caches USD price for flexibility in future conversions.
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
            // Return cached value immediately without API call
            return existingRate.price;
        }

        // Fetch from CoinGecko API - this single API call can return multiple currencies
        // We'll fetch both the target currency AND USD for future flexibility
        const prices = await this.fetchCryptoHistoricalPriceMulti(cryptoSymbol, [normalizedQuote, 'usd'], date);
        
        // Store both prices for future use (normalize date to start of day)
        for (const [currency, price] of Object.entries(prices)) {
            const currencyRate = new CurrencyRate(
                cryptoSymbol.toUpperCase(), 
                currency.toUpperCase(), 
                price, 
                normalizedDate, 
                'coingecko'
            );
            await this.rateStorage.add(currencyRate);
        }
        await this.rateStorage.flush?.();

        return prices[normalizedQuote];
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
     * Also caches USD prices for flexibility.
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
        // Only wait between API calls, not when all prices are cached
        for (const symbol of uncachedSymbols) {
            try {
                // Fetch both target currency and USD for future flexibility
                const prices = await this.fetchCryptoHistoricalPriceMulti(symbol, [normalizedQuote, 'usd'], date);
                // Store all fetched prices
                for (const [currency, price] of Object.entries(prices)) {
                    const currencyRate = new CurrencyRate(
                        symbol.toUpperCase(), 
                        currency.toUpperCase(), 
                        price, 
                        normalizedDate, 
                        'coingecko'
                    );
                    await this.rateStorage.add(currencyRate);
                }
                // Add the requested currency to results
                if (prices[normalizedQuote]) {
                    results.set(symbol.toUpperCase(), prices[normalizedQuote]);
                }
            } catch (error) {
                console.warn(`Failed to fetch price for ${symbol}: ${error}`);
                // Continue with other symbols
            } finally {
                // Always wait after every API call, success or failure
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Only flush if we added new data
        if (uncachedSymbols.length > 0) {
            await this.rateStorage.flush?.();
        }
        return results;
    }

    private async fetchCryptoRate(cryptoSymbol: string, date: Date): Promise<number> {
        return this.fetchCryptoHistoricalPrice(cryptoSymbol, 'usd', date);
    }

    private async fetchCryptoHistoricalPrice(cryptoSymbol: string, quoteCurrency: string, date: Date): Promise<number> {
        if (!cryptoSymbol) {
            throw new Error('Crypto symbol is required to fetch price.');
        }
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
     * Fetches cryptocurrency prices in multiple currencies with a single API call.
     * This is more efficient than making separate calls for each currency.
     * @param cryptoSymbol The crypto symbol (e.g., 'bitcoin', 'ethereum') - CoinGecko coin ID.
     * @param quoteCurrencies Array of target currencies (e.g., ['usd', 'eur', 'nok']).
     * @param date The date for which the prices are required.
     * @returns Object mapping currency to price.
     */
    private async fetchCryptoHistoricalPriceMulti(cryptoSymbol: string, quoteCurrencies: string[], date: Date): Promise<Record<string, number>> {
        if (!cryptoSymbol) {
            throw new Error('Crypto symbol is required to fetch price.');
        }
        const coinId = this.mapSymbolToCoinGeckoId(cryptoSymbol);
        const dateStr = formatDateToDDMMYYYY(date); // CoinGecko expects DD-MM-YYYY format
        
        const url = `${this.cryptoApiBaseUrl}/coins/${coinId}/history?date=${dateStr}&localization=false`;

        try {
            const response = await this.makeCoingeckoRequest(url);
            const currentPrices = response.data?.market_data?.current_price;

            if (!currentPrices) {
                throw new Error(`Crypto price data not found for ${cryptoSymbol} on ${dateStr}.`);
            }

            const result: Record<string, number> = {};
            for (const currency of quoteCurrencies) {
                const normalizedCurrency = currency.toLowerCase();
                const price = currentPrices[normalizedCurrency];
                if (price) {
                    result[normalizedCurrency] = parseFloat(price);
                } else {
                    console.warn(`Price not found for ${cryptoSymbol} in ${currency} on ${dateStr}, skipping.`);
                }
            }

            if (Object.keys(result).length === 0) {
                throw new Error(`No prices found for ${cryptoSymbol} in requested currencies on ${dateStr}.`);
            }

            return result;
        } catch (error) {
            console.error(`Error fetching crypto prices for ${cryptoSymbol}:`, error);
            throw new Error(`Failed to fetch crypto prices for ${cryptoSymbol} in requested currencies.`);
        }
    }

    /**
     * Map common cryptocurrency symbols to CoinGecko coin IDs.
     * This mapping is essential because CoinGecko uses coin IDs (e.g., 'bitcoin') rather than symbols (e.g., 'BTC').
     */
    private mapSymbolToCoinGeckoId(symbol: string): string {
        const symbolMap: { [key: string]: string } = {
            'APT': 'aptos',
            'BTC': 'bitcoin',
            'ETH': 'ethereum',
            'ADA': 'cardano',
            'DOT': 'polkadot',
            'SOL': 'solana',
            'LTC': 'litecoin',
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
            'USDG': 'global-dollar',
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
            'CAKE': 'pancakeswap-token',
            'XRP': 'ripple',
            'XLM': 'stellar',
            'LRC': 'loopring',
            'CLV': 'clover-finance',
            'AMP': 'amp-token',
            'GRT': 'the-graph',
            'FET': 'fetch-ai',
            
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

    /**
     * Lazily load and query historical exchange rates from CSV file (USDEURGBP-NOK_rates_2020-12-28-2025-12-28.csv).
     * Only loaded on first call (first API failure), then cached in memory.
     * Results are stored in currency-rates.json for persistence.
     */
    private async getCsvRate(currency: string, date: Date): Promise<number> {
        // Lazy-load CSV on first call
        if (!this.csvRatesLoaded) {
            await this.loadCsvRates();
        }

        const normalizedDate = this.normalizeDate(date);
        const dateStr = formatDateToYYYYMMDD(normalizedDate);
        
        // Query the in-memory map
        const currencyRates = this.csvRatesMap.get(currency.toUpperCase());
        if (!currencyRates) {
            throw new Error(`No CSV rates found for currency ${currency}`);
        }

        // Try exact date first
        const dateRates = currencyRates.get(dateStr);
        if (dateRates && dateRates.length > 0) {
            const rate = dateRates[0].rate;
            logger.debug(`Retrieved ${currency}-NOK rate from CSV for ${dateStr}: ${rate}`);
            
            // Persist to storage for future use
            const currencyRate = new CurrencyRate(currency, 'NOK', rate, normalizedDate, 'csv-fallback');
            await this.rateStorage.add(currencyRate);
            await this.rateStorage.flush?.();
            
            return rate;
        }

        // If exact date not found, try previous business days (up to 6 days back)
        // Always store with the original requested date (normalizedDate), not the fallback date
        const maxRetries = 7; // Loop 6 times (attempts 1-6) for 6 days back
        let currentDate = new Date(normalizedDate);
        for (let attempt = 1; attempt < maxRetries; attempt++) {
            currentDate.setDate(currentDate.getDate() - 1);
            const previousDateStr = formatDateToYYYYMMDD(currentDate);
            const previousDateRates = currencyRates.get(previousDateStr);
            if (previousDateRates && previousDateRates.length > 0) {
                const rate = previousDateRates[0].rate;
                logger.info(`Retrieved ${currency}-NOK rate from CSV for ${previousDateStr} (requested: ${dateStr}): ${rate}`);
                
                // Persist with original requested date to cache the result for future lookups
                const currencyRate = new CurrencyRate(currency, 'NOK', rate, normalizedDate, 'csv-fallback');
                await this.rateStorage.add(currencyRate);
                await this.rateStorage.flush?.();
                
                return rate;
            }
        }

        throw new Error(`No CSV rates found for ${currency} on or near ${dateStr}`);
    }

    private async loadCsvRates(): Promise<void> {
        const csvFilePath = './data/USDEURGBP_2018_2025_NOK_rates.csv';
        logger.info(`Loading historical exchange rates from CSV: ${csvFilePath}`);

        try {
            const data = await fs.readFile(csvFilePath, 'utf-8');
            const lines = data.split('\n');
            
            // Parse semicolon-separated CSV (Norges Bank format)
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const parts = line.split(';');
                if (parts.length < 16) continue;

                const baseCurrency = parts[2]; // BASE_CUR
                const quoteCurrency = parts[4]; // QUOTE_CUR
                const dateStr = parts[14]; // TIME_PERIOD (YYYY-MM-DD)
                const rateStr = parts[15]; // OBS_VALUE

                if (quoteCurrency !== 'NOK') continue; // Only interested in *-NOK pairs

                const rate = parseFloat(rateStr);
                if (isNaN(rate)) continue;

                // Organize by base currency, then date
                if (!this.csvRatesMap.has(baseCurrency)) {
                    this.csvRatesMap.set(baseCurrency, new Map());
                }
                const currencyMap = this.csvRatesMap.get(baseCurrency)!;
                if (!currencyMap.has(dateStr)) {
                    currencyMap.set(dateStr, []);
                }
                currencyMap.get(dateStr)!.push({ date: dateStr, rate });
            }

            this.csvRatesLoaded = true;
            logger.info(`Loaded exchange rates for ${this.csvRatesMap.size} currencies from CSV`);
        } catch (error) {
            logger.error(`Failed to load CSV rates from ${csvFilePath}: ${error}`);
            throw new Error(`Failed to load historical exchange rates from CSV: ${error}`);
        }
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