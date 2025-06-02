import { Transaction } from "./transaction";


export class TaxReport {
    startDate: Date;
    endDate: Date;
    baseCurrency: string;
    accountingMethod: string = 'FIFO';
    transactions?: Transaction[];
    buys?: number = 0;
    sells?: number = 0;
    assets?: Set<string> = new Set();
    exchanges?: Set<string> = new Set();
    profit?: number = 0;
    fees?: number = 0;

    constructor(startDate: Date, endDate: Date, baseCurrency: string, accountingMethod: string = 'FIFO') {
        this.startDate = startDate;
        this.endDate = endDate; 
        this.baseCurrency = baseCurrency;
        this.accountingMethod = accountingMethod;
    }

    toJSON() {
        return {
            startDate: this.startDate.toISOString(),
            endDate: this.endDate.toISOString(),
            baseCurrency: this.baseCurrency,
            accountingMethod: this.accountingMethod,
            transactions: this.transactions,
            buys: this.buys,
            sells: this.sells,
            assets: Array.from(this.assets || []),
            exchanges: Array.from(this.exchanges || []),
            profit: this.profit,
            fees: this.fees
        };
    }
}
