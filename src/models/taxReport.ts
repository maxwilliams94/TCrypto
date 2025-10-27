import { Transaction } from "./transaction";
import { SellEvent } from "./sellEvent";


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
    
    // Detailed sell event tracking
    sellEvents?: SellEvent[] = [];
    totalBuyFeesIncluded?: number = 0;  // Total buy fees included in sell events
    totalSellFees?: number = 0;         // Total sell fees

    constructor(startDate: Date, endDate: Date, baseCurrency: string, accountingMethod: string = 'FIFO') {
        this.startDate = startDate;
        this.endDate = endDate; 
        this.baseCurrency = baseCurrency;
        this.accountingMethod = accountingMethod;
    }

    /**
     * Add a sell event to the report
     */
    addSellEvent(sellEvent: SellEvent): void {
        if (!this.sellEvents) {
            this.sellEvents = [];
        }
        this.sellEvents.push(sellEvent);
        
        // Update aggregated metrics
        this.totalBuyFeesIncluded = (this.totalBuyFeesIncluded || 0) + sellEvent.totalBuyFees;
        this.totalSellFees = (this.totalSellFees || 0) + sellEvent.sellFee;
        this.profit = (this.profit || 0) + sellEvent.profitLoss;
        // Total fees includes both buy and sell fees
        this.fees = (this.fees || 0) + sellEvent.getTotalFees();
    }

    /**
     * Get sell events for a specific asset
     */
    getSellEventsByAsset(asset: string): SellEvent[] {
        return this.sellEvents?.filter(se => se.asset === asset) || [];
    }

    /**
     * Get sell events for a specific year
     */
    getSellEventsByYear(year: number): SellEvent[] {
        return this.sellEvents?.filter(se => se.taxYear === year) || [];
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
            fees: this.fees,
            sellEvents: this.sellEvents?.map(se => se.toJSON()) || [],
            totalBuyFeesIncluded: this.totalBuyFeesIncluded,
            totalSellFees: this.totalSellFees,
            summary: {
                totalProfit: this.profit,
                totalFees: this.fees,
                totalBuyFees: this.totalBuyFeesIncluded,
                totalSellFees: this.totalSellFees,
                numberOfSells: this.sellEvents?.length || 0
            }
        };
    }
}
