import axios from 'axios';

export class ExchangeRateService {
    private BASE_URL = 'https://data.norges-bank.no/api/data/EXR/B.CCY.NOK.SP';
    private cache: Map<string, number> = new Map();

    /**
     * Fetches the USD to NOK exchange rate for a specific date.
     * @param date The date for which the exchange rate is required (format: YYYY-MM-DD).
     * @returns The exchange rate as a number.
     */
    async getCcyNokRate(currency: string, date: Date): Promise<number> {
        if (this.cache.get(`${currency}-${date}`)) {
            return this.cache.get(`${currency}-${date}`)!;
        }
        const workingDate = getLatestWorkingDay(date);
        const base_url = this.BASE_URL.replace('CCY', mapCurrency(currency).toUpperCase());
        const url = `${base_url}?format=sdmx-json&startPeriod=${formatDateToYYYYMMDD(workingDate)}&endPeriod=${formatDateToYYYYMMDD(workingDate)}&locale=en`;

        try {
            const response = await axios.get(url);
            const observations = response.data?.data?.dataSets?.[0]?.series?.['0:0:0:0']?.observations;

            if (observations && observations['0'] && observations['0'][0]) {
                this.cache.set(`${currency}-${date}`, parseFloat(observations['0'][0]));
                return parseFloat(observations['0'][0]);
            } else {
                throw new Error('Exchange rate data not found for the specified date.');
            }
        } catch (error) {
            console.error('Error fetching exchange rate:', error);
            throw new Error('Failed to fetch exchange rate.');
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