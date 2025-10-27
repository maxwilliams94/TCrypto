/**
 * Represents a single sell event for tax reporting purposes.
 * Tracks the sell transaction, the buy transactions it matched against (FIFO),
 * and calculates profit/loss including all fees.
 */
export interface BuyAllocation {
    buyTransactionId: string;    // Reference to the buy transaction
    quantity: number;            // How much of this buy was used for this sell
    costBasis: number;          // Total cost basis for this allocation (includes proportional fee)
}

export class SellEvent {
    sellTransactionId: string;
    sellDate: Date;
    asset: string;
    exchange: string;
    currency: string;            // Currency for all monetary amounts (e.g., 'NOK')
    totalQuantity: number;       // Total amount sold
    sellPrice: number;           // Price per unit in currency
    sellFee: number;             // Fee paid on the sell in currency
    proceeds: number;            // Total proceeds (sellPrice * totalQuantity) in currency
    
    buyAllocations: BuyAllocation[];  // Which buys this sell matched against (FIFO)
    
    totalCostBasis: number;      // Sum of all buy cost bases including buy fees in currency
    totalBuyFees: number;        // Sum of fees from all associated buys in currency
    profitLoss: number;          // proceeds - totalCostBasis - sellFee in currency
    
    taxYear: number;             // Year this sell event occurred for tax purposes

    constructor(
        sellTransactionId: string,
        sellDate: Date,
        asset: string,
        exchange: string,
        currency: string,
        totalQuantity: number,
        sellPrice: number,
        sellFee: number
    ) {
        this.sellTransactionId = sellTransactionId;
        this.sellDate = sellDate;
        this.asset = asset;
        this.exchange = exchange;
        this.currency = currency;
        this.totalQuantity = totalQuantity;
        this.sellPrice = sellPrice;
        this.sellFee = sellFee;
        this.proceeds = sellPrice * totalQuantity;
        this.buyAllocations = [];
        this.totalCostBasis = 0;
        this.totalBuyFees = 0;
        this.profitLoss = 0;
        this.taxYear = sellDate.getFullYear();
    }

    /**
     * Add a buy allocation to this sell event (FIFO matching)
     * @param allocation The buy allocation with transaction ID, quantity, and total cost basis
     * @param buyFee The proportional buy fee included in the cost basis (for tracking)
     */
    addBuyAllocation(allocation: BuyAllocation, buyFee: number): void {
        this.buyAllocations.push(allocation);
        this.totalCostBasis += allocation.costBasis;
        this.totalBuyFees += buyFee;
        this.recalculateProfitLoss();
    }

    /**
     * Recalculate profit/loss after adding buy allocations
     * Formula: proceeds - totalCostBasis - sellFee
     * Note: totalCostBasis already includes buy fees proportionally allocated
     */
    private recalculateProfitLoss(): void {
        this.profitLoss = this.proceeds - this.totalCostBasis - this.sellFee;
    }

    /**
     * Get average cost basis per unit (including buy fees)
     */
    getAverageCostBasis(): number {
        return this.totalQuantity > 0 ? this.totalCostBasis / this.totalQuantity : 0;
    }

    /**
     * Get total fees (buy fees + sell fee)
     */
    getTotalFees(): number {
        return this.totalBuyFees + this.sellFee;
    }

    toJSON() {
        return {
            sellTransactionId: this.sellTransactionId,
            sellDate: this.sellDate.toISOString(),
            asset: this.asset,
            exchange: this.exchange,
            currency: this.currency,
            totalQuantity: this.totalQuantity,
            sellPrice: this.sellPrice,
            sellFee: this.sellFee,
            proceeds: this.proceeds,
            buyAllocations: this.buyAllocations,
            totalCostBasis: this.totalCostBasis,
            totalBuyFees: this.totalBuyFees,
            averageCostBasis: this.getAverageCostBasis(),
            profitLoss: this.profitLoss,
            totalFees: this.getTotalFees(),
            taxYear: this.taxYear
        };
    }
}
