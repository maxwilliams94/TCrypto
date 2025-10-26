export class CurrencyRate {
    asset: string;        // e.g., "BTC", "EUR", "USD"
    quote: string;        // e.g., "USD", "NOK" 
    price: number;        // Price of 1 unit of asset in quote currency
    date: Date;           // The date this rate is valid for
    source: string;       // e.g., "norges-bank", "coinbase", "binance"
    
    constructor(asset: string, quote: string, price: number, date: Date, source: string) {
        this.asset = asset;
        this.quote = quote;
        this.price = price;
        this.date = date;
        this.source = source;
    }

    // Generate a unique key for caching/storage
    getCacheKey(): string {
        return `${this.asset}-${this.quote}-${this.formatDate()}`;
    }

    private formatDate(): string {
        return this.date.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    toJSON() {
        return {
            asset: this.asset,
            quote: this.quote,
            price: this.price,
            date: this.date.toISOString(),
            source: this.source
        };
    }
}