

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