import { Transaction } from "./transaction";
import { SellEvent } from "./sellEvent";
import { Portfolio } from "./portfolio";


export class TaxReport {
    startDate: Date;
    endDate: Date;
    baseCurrency: string;
    accountingMethod: string = 'FIFO';
    transactions?: Transaction[];
    accountingTransactions?: Transaction[];
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
    
    // Income tracking for rewards (separate from profit/loss on sales)
    incomeEvents?: Array<{
        transactionId: string;
        asset: string;
        quantity: number;
        incomeValue: number;        // Income in base currency at time of earning
        incomeValueInTaxCurrency: number;  // Income converted to tax currency
        incomeDate: Date;
        type: string;               // STAKING_REWARD, MINING_REWARD, AIRDROP, etc.
    }> = [];
    totalIncome?: number = 0;           // Total income from rewards (in tax currency)
    
    // Deductible fees from withdrawal transactions (tax-deductible operating expenses)
    deductibleFees?: number = 0;        // Total fees from WITHDRAW transactions (in tax currency)
    withdrawalEvents?: Array<{
        transactionId: string;
        asset: string;
        quantity: number;
        fee: number;                // Fee in original currency
        feeCurrency: string;        // Original fee currency
        feeInTaxCurrency: number;   // Fee converted to tax currency
        withdrawalDate: Date;
        includedInReport: boolean;  // Explicit marker for report inclusion
        reportTaxYear: number;      // Tax year this withdrawal is included in
    }> = [];
    
    // Portfolio tracking
    portfolio?: Portfolio;

    // Whether this report was generated with finalise=true (lot assignments persisted)
    isFinalised: boolean = false;

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
        // Total fees includes buy/sell fees (withdrawal fees are added during report generation)
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
            accountingTransactions: this.accountingTransactions,
            buys: this.buys,
            sells: this.sells,
            assets: Array.from(this.assets || []),
            exchanges: Array.from(this.exchanges || []),
            profit: this.profit,
            fees: this.fees,
            sellEvents: this.sellEvents?.map(se => se.toJSON()) || [],
            totalBuyFeesIncluded: this.totalBuyFeesIncluded,
            totalSellFees: this.totalSellFees,
            incomeEvents: this.incomeEvents || [],
            totalIncome: this.totalIncome,
            withdrawalEvents: this.withdrawalEvents || [],
            deductibleFees: this.deductibleFees,
            portfolio: this.portfolio?.toJSON(),
            isFinalised: this.isFinalised,
            summary: {
                totalProfit: this.profit,
                totalFees: this.fees,
                totalBuyFees: this.totalBuyFeesIncluded,
                totalSellFees: this.totalSellFees,
                deductibleFees: this.deductibleFees,
                netTaxableProfit: (this.profit || 0) - (this.deductibleFees || 0),
                numberOfSells: this.sellEvents?.length || 0,
                isFinalised: this.isFinalised,
                realizedGainLoss: this.portfolio?.getTotalRealizedGainLoss(),
                portfolioValueAsOfReportEnd: this.portfolio?.getTotalValue(),
                valuationDate: this.endDate.toISOString().split('T')[0]
            }
        };
    }
}
