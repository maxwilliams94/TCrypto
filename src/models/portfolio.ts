/**
 * Represents a position in the portfolio for a specific asset
 */
export class AssetPosition {
    asset: string;
    currency: string;
    totalQuantity: number;          // Current holdings
    averageCostBasis: number;       // Average cost per unit (including fees)
    totalCostBasis: number;         // Total amount invested (including fees)
    currentValue?: number;          // Current market value (if price provided)
    unrealizedGainLoss?: number;    // Unrealized gain/loss (if price provided)
    
    // For tax period reporting
    quantityBought: number;         // Amount bought during period
    quantitySold: number;           // Amount sold during period
    realizedGainLoss: number;       // Realized gain/loss during period
    totalBuyFees: number;           // Total buy fees paid during period
    totalSellFees: number;          // Total sell fees paid during period

    constructor(asset: string, currency: string) {
        this.asset = asset;
        this.currency = currency;
        this.totalQuantity = 0;
        this.averageCostBasis = 0;
        this.totalCostBasis = 0;
        this.quantityBought = 0;
        this.quantitySold = 0;
        this.realizedGainLoss = 0;
        this.totalBuyFees = 0;
        this.totalSellFees = 0;
    }

    /**
     * Add a buy transaction to this position
     * @param quantity Amount bought
     * @param price Price per unit
     * @param fee Fee paid
     * @param isInPeriod Whether this transaction is within the reporting period
     */
    addBuy(quantity: number, price: number, fee: number, isInPeriod: boolean = true): void {
        const costWithFee = (price * quantity) + fee;
        
        // Always update holdings (we need full position state)
        this.totalCostBasis += costWithFee;
        this.totalQuantity += quantity;
        this.averageCostBasis = this.totalQuantity > 0 ? this.totalCostBasis / this.totalQuantity : 0;
        
        // Only track period activity if transaction is in period
        if (isInPeriod) {
            this.quantityBought += quantity;
            this.totalBuyFees += fee;
        }
    }

    /**
     * Record a sell transaction (reduces holdings)
     * Note: This is called AFTER FIFO matching calculates the cost basis
     * @param quantity Amount sold
     * @param proceeds Total proceeds from sale
     * @param costBasis Cost basis of what was sold (from FIFO matching)
     * @param sellFee Fee paid on the sell
     * @param buyFeesInCostBasis Buy fees included in the cost basis (for period tracking)
     * @param isInPeriod Whether this transaction is within the reporting period
     */
    addSell(quantity: number, proceeds: number, costBasis: number, sellFee: number, buyFeesInCostBasis: number, isInPeriod: boolean = true): void {
        // Always reduce holdings by the cost basis of what we sold
        this.totalCostBasis -= costBasis;
        this.totalQuantity -= quantity;
        
        // Recalculate average cost basis for remaining holdings
        this.averageCostBasis = this.totalQuantity > 0 ? this.totalCostBasis / this.totalQuantity : 0;
        
        // Only track period metrics if transaction is in period
        if (isInPeriod) {
            this.quantitySold += quantity;
            this.totalSellFees += sellFee;
            this.totalBuyFees += buyFeesInCostBasis; // Add buy fees that were realized in this sell
            
            // Realized gain/loss = proceeds - cost basis - sell fee
            const gainLoss = proceeds - costBasis - sellFee;
            this.realizedGainLoss += gainLoss;
        }
    }

    /**
     * Update current market value and calculate unrealized gain/loss
     */
    updateMarketValue(currentPrice: number): void {
        this.currentValue = currentPrice * this.totalQuantity;
        this.unrealizedGainLoss = this.currentValue - this.totalCostBasis;
    }

    /**
     * Check if position is closed (no holdings left)
     */
    isClosed(): boolean {
        return this.totalQuantity <= 0.00000001; // Use epsilon for floating point comparison
    }

    toJSON() {
        return {
            asset: this.asset,
            currency: this.currency,
            holdings: {
                quantity: this.totalQuantity,
                averageCostBasis: this.averageCostBasis,
                totalCostBasis: this.totalCostBasis,
                currentValue: this.currentValue,
                unrealizedGainLoss: this.unrealizedGainLoss
            },
            periodActivity: {
                quantityBought: this.quantityBought,
                quantitySold: this.quantitySold,
                realizedGainLoss: this.realizedGainLoss,
                totalBuyFees: this.totalBuyFees,
                totalSellFees: this.totalSellFees,
                totalFees: this.totalBuyFees + this.totalSellFees
            }
        };
    }
}

/**
 * Represents the complete portfolio
 */
export class Portfolio {
    currency: string;
    positions: Map<string, AssetPosition>;

    constructor(currency: string) {
        this.currency = currency;
        this.positions = new Map();
    }

    /**
     * Get or create a position for an asset
     */
    getPosition(asset: string): AssetPosition {
        if (!this.positions.has(asset)) {
            this.positions.set(asset, new AssetPosition(asset, this.currency));
        }
        return this.positions.get(asset)!;
    }

    /**
     * Get all positions (including closed ones if requested)
     */
    getAllPositions(includeClosedPositions: boolean = false): AssetPosition[] {
        const positions = Array.from(this.positions.values());
        if (includeClosedPositions) {
            return positions;
        }
        return positions.filter(p => !p.isClosed());
    }

    /**
     * Get positions that had activity during the period
     */
    getActivePositions(): AssetPosition[] {
        return Array.from(this.positions.values()).filter(
            p => p.quantityBought > 0 || p.quantitySold > 0
        );
    }

    /**
     * Calculate total portfolio value
     */
    getTotalValue(): number {
        return Array.from(this.positions.values())
            .reduce((sum, pos) => sum + (pos.currentValue || 0), 0);
    }

    /**
     * Calculate total cost basis across all positions
     */
    getTotalCostBasis(): number {
        return Array.from(this.positions.values())
            .reduce((sum, pos) => sum + pos.totalCostBasis, 0);
    }

    /**
     * Calculate total unrealized gain/loss
     */
    getTotalUnrealizedGainLoss(): number {
        return Array.from(this.positions.values())
            .reduce((sum, pos) => sum + (pos.unrealizedGainLoss || 0), 0);
    }

    /**
     * Calculate total realized gain/loss during the period
     */
    getTotalRealizedGainLoss(): number {
        return Array.from(this.positions.values())
            .reduce((sum, pos) => sum + pos.realizedGainLoss, 0);
    }

    toJSON() {
        return {
            currency: this.currency,
            summary: {
                totalValue: this.getTotalValue(),
                totalCostBasis: this.getTotalCostBasis(),
                totalUnrealizedGainLoss: this.getTotalUnrealizedGainLoss(),
                totalRealizedGainLoss: this.getTotalRealizedGainLoss(),
                numberOfPositions: this.getAllPositions(false).length,
                numberOfClosedPositions: this.getAllPositions(true).length - this.getAllPositions(false).length
            },
            positions: this.getAllPositions(true).map(p => p.toJSON())
        };
    }
}
