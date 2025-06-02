

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
    }

    toJSON() {
        return {
            id: this.id,
            baseCurrency: this.baseCurrency,
            quoteCurrency: this.quoteCurrency,
            exchangee: this.exchange,
            side: this.side,
            baseSize: this.baseSize,
            quoteSize: this.quoteSize,
            fee: this.fee,
            dateTime: this.dateTime.toISOString()
        };
    }
  }