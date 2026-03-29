import {
    AccountingStrategy,
    BuyLot,
    LotSelectionContext,
    LotSelectionResult,
} from '../accountingStrategy';

/**
 * LIFO (Last In, First Out) strategy.
 * Consumes the newest buy lots first — the opposite of FIFO.
 * Also known as FILO or LCFS in some contexts.
 */
export class LifoStrategy implements AccountingStrategy {
    readonly name = 'LIFO' as const;
    readonly description = 'Last In, First Out — newest buy lots are consumed first';

    selectLots(availableLots: BuyLot[], _context: LotSelectionContext): LotSelectionResult {
        const orderedLots = [...availableLots].sort((a, b) => b.index - a.index);

        return {
            orderedLots,
            selectionReason: 'LIFO: consuming newest lots first (reverse chronological order)',
        };
    }
}
