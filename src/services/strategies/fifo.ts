import {
    AccountingStrategy,
    BuyLot,
    LotSelectionContext,
    LotSelectionResult,
} from '../accountingStrategy';

/**
 * FIFO (First In, First Out) strategy.
 * Consumes the oldest buy lots first — the original and default behaviour.
 */
export class FifoStrategy implements AccountingStrategy {
    readonly name = 'FIFO' as const;
    readonly description = 'First In, First Out — oldest buy lots are consumed first';

    selectLots(availableLots: BuyLot[], _context: LotSelectionContext): LotSelectionResult {
        const orderedLots = [...availableLots].sort((a, b) => a.index - b.index);

        return {
            orderedLots,
            selectionReason: 'FIFO: consuming oldest lots first (chronological order)',
        };
    }
}
