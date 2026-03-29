import { Transaction } from '../models/transaction';

export interface LotAllocationYearSummary {
    taxYear: number;
    strategies: string[];
    allocationCount: number;
    affectedTransactionCount: number;
    conflict: boolean;
    totalConsumedQuantity: number;
}

export interface CleanupLotAllocationsResult {
    taxYear: number;
    dryRun: boolean;
    allocationsRemoved: number;
    affectedTransactions: number;
}

export function inspectLotAllocations(transactions: Transaction[]): LotAllocationYearSummary[] {
    const byYear = new Map<number, LotAllocationYearSummary>();

    for (const transaction of transactions) {
        const allocations = transaction.lotAllocations ?? [];
        const perYearCount = new Map<number, number>();

        for (const allocation of allocations) {
            const summary = byYear.get(allocation.taxYear) ?? {
                taxYear: allocation.taxYear,
                strategies: [],
                allocationCount: 0,
                affectedTransactionCount: 0,
                conflict: false,
                totalConsumedQuantity: 0,
            };

            summary.allocationCount += 1;
            summary.totalConsumedQuantity += allocation.quantity;

            if (!summary.strategies.includes(allocation.strategy)) {
                summary.strategies.push(allocation.strategy);
            }

            byYear.set(allocation.taxYear, summary);
            perYearCount.set(allocation.taxYear, (perYearCount.get(allocation.taxYear) ?? 0) + 1);
        }

        for (const taxYear of perYearCount.keys()) {
            const summary = byYear.get(taxYear)!;
            summary.affectedTransactionCount += 1;
        }
    }
 
    return Array.from(byYear.values())
        .map(summary => ({
            ...summary,
            strategies: summary.strategies.sort(),
            conflict: summary.strategies.length > 1,
        }))
        .sort((a, b) => a.taxYear - b.taxYear);
}
 
export function cleanupLotAllocationsForYear(
    transactions: Transaction[],
    taxYear: number,
    dryRun: boolean
): CleanupLotAllocationsResult {
    let allocationsRemoved = 0;
    let affectedTransactions = 0;
 
    for (const transaction of transactions) {
        const existingAllocations = transaction.lotAllocations?.filter(allocation => allocation.taxYear === taxYear).length ?? 0;
        if (existingAllocations === 0) {
            continue;
        }
 
        affectedTransactions += 1;
        allocationsRemoved += existingAllocations;
 
        if (!dryRun) {
            transaction.clearLotConsumptionForYear(taxYear);
        }
    }
 
    return {
        taxYear,
        dryRun,
        allocationsRemoved,
        affectedTransactions,
    };
}
