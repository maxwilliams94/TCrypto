import { Transaction } from '../models/transaction';

/**
 * Supported accounting methods for tax lot selection.
 * Norwegian tax rules allow free choice of which lots to sell for virtual currencies.
 */
export type AccountingMethod = 'FIFO' | 'LIFO';

/**
 * A buy lot available for matching against a sell.
 * Enriched with pre-computed cost basis fields for strategy use.
 */
export interface BuyLot {
    /** The underlying buy transaction */
    transaction: Transaction;
    /** Index in the accounting transaction list (for stable ordering) */
    index: number;
    /** How much of this buy lot remains unconsumed */
    remainingQuantity: number;
    /** Original effective size (baseSize minus any base-currency fee) */
    effectiveBaseSize: number;
    /** Pre-computed: cost basis per unit in tax currency (quote + fee) / effectiveBaseSize */
    costBasisPerUnit: number;
    /** Pre-computed: total remaining cost basis in tax currency */
    totalRemainingCostBasis: number;
    /** Pre-computed: buy fee per unit in tax currency */
    buyFeePerUnit: number;
}

/**
 * Context provided to the strategy for each sell event.
 * Gives the strategy enough information to make fee-aware, gain-aware decisions.
 */
export interface LotSelectionContext {
    /** Sell price per unit in tax currency */
    sellPricePerUnit: number;
    /** Total quantity being sold */
    sellQuantity: number;
    /** Sell fee in tax currency */
    sellFee: number;
    /** Running total of realised gain/loss for in-scope sells processed so far */
    cumulativeGainThisPeriod: number;
    /** Accumulated deductible withdrawal fees this period */
    deductibleFeesThisPeriod: number;
    /** Tax currency (e.g. 'NOK') */
    nativeCurrency: string;
}

/**
 * Result of lot selection — an ordered list of lots to consume, plus an explanation.
 */
export interface LotSelectionResult {
    /** Lots ordered by consumption priority (first = consumed first) */
    orderedLots: BuyLot[];
    /** Human-readable explanation of why lots were ordered this way */
    selectionReason: string;
}

/**
 * Strategy interface for selecting which buy lots to consume when processing a sell.
 * Implementations control the ordering; the caller handles the actual consumption.
 */
export interface AccountingStrategy {
    /** Machine-readable strategy name (e.g. 'FIFO') */
    readonly name: AccountingMethod;
    /** Human-readable description */
    readonly description: string;
    /**
     * Given the available buy lots for an asset and the context of the current sell,
     * return the lots in the order they should be consumed.
     * 
     * The caller will iterate through orderedLots and consume up to sellQuantity.
     * The strategy MUST NOT mutate the input lots.
     */
    selectLots(
        availableLots: BuyLot[],
        context: LotSelectionContext
    ): LotSelectionResult;
}

/**
 * Calculate the cost basis per unit for a buy lot.
 * Shared helper used when constructing BuyLot from a transaction.
 */
export function calculateCostBasisPerUnit(transaction: Transaction): number {
    const taxQuoteSize = (transaction.taxQuoteSize !== undefined)
        ? transaction.taxQuoteSize
        : (transaction.quoteSize * (transaction.taxConversionRate ?? 1));
    const taxFee = transaction.getTaxFee();
    const effectiveBaseSize = transaction.baseSize; // caller adjusts for base-currency fees
    return effectiveBaseSize > 0 ? (taxQuoteSize + taxFee) / effectiveBaseSize : 0;
}

/**
 * Calculate the proportional cost basis for consuming a given quantity from a lot.
 * This is the shared logic that was previously duplicated between the inline sell loop
 * and consumeQuantityFromPositions.
 */
export function calculateProportionalCostBasis(
    lot: BuyLot,
    quantityToAllocate: number
): { costBasis: number; allocatedQuoteValue: number; allocatedBuyFee: number; proportionOfBuy: number } {
    const proportionOfBuy = lot.effectiveBaseSize > 0
        ? (quantityToAllocate / lot.effectiveBaseSize)
        : 0;
    const allocatedBuyFee = lot.transaction.getTaxFee() * proportionOfBuy;

    const buyTaxQuoteSize =
        (lot.transaction.taxQuoteSize !== undefined)
            ? lot.transaction.taxQuoteSize
            : (lot.transaction.quoteSize * (lot.transaction.taxConversionRate ?? 1));
    const allocatedQuoteValue = buyTaxQuoteSize * proportionOfBuy;
    const costBasis = allocatedQuoteValue + allocatedBuyFee;

    return { costBasis, allocatedQuoteValue, allocatedBuyFee, proportionOfBuy };
}

/**
 * Resolve a strategy name string to the corresponding AccountingStrategy instance.
 * Throws if the method is not recognised.
 */
export function resolveStrategy(method: string): AccountingStrategy {
    switch (method.toUpperCase()) {
        case 'FIFO':
            // Lazy import to avoid circular dependencies
            const { FifoStrategy } = require('./strategies/fifo');
            return new FifoStrategy();
        case 'LIFO':
            // Lazy import to avoid circular dependencies
            const { LifoStrategy } = require('./strategies/lifo');
            return new LifoStrategy();
        default:
            throw new Error(
                `Unknown accounting method: '${method}'. Supported methods: FIFO, LIFO`
            );
    }
}
