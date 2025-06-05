

export class Transaction {
    id: string;
    baseCurrency: string;
    quoteCurrency: string;
    exchange: string;
    side: string;
    baseSize: number;
    quoteSize: number;
    price: number;
    fee: number;
    dateTime: Date;
    quoteSizeNative?: number;
    nativeCurrency?: string;
    baseSizeRemaining?: number;
    soldOn?: Date;
    

    constructor(
        id: string,
        baseCurrency: string,
        quoteCurrency: string,
        exchange: string,
        side: string,
        baseSize: number,
        quoteSize: number,
        price: number,
        fee: number,
        dateTime: Date
    ) {
        this.id = id;
        this.baseCurrency = baseCurrency;
        this.quoteCurrency = quoteCurrency;
        this.exchange = exchange;
        this.side = side;
        this.baseSize = baseSize;
        this.quoteSize = quoteSize;
        this.price = price;
        this.fee = fee;
        this.dateTime = dateTime;
        this.baseSizeRemaining = baseSize;

    }

    toSimpleJSON() {
        return {
            CCY: `${this.baseCurrency}-${this.quoteCurrency}`,
            exchange: this.exchange,
            side: this.side,
            baseSize: this.baseSize,
            price: this.price,
            fee: this.fee,
            dateTime: this.dateTime.toISOString()
        };
    }
  }

  export function isCryptoCryptoTransaction(transaction: Transaction): boolean {
    return !isFiat(transaction.baseCurrency) && !isFiat(transaction.quoteCurrency);
  }

  function isFiat(currency: string): boolean {
    const fiatCurrencies = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'JPY', 'CNY', 'AUD', 'CAD'];
    return fiatCurrencies.includes(currency.toUpperCase());
  }