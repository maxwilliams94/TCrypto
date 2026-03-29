import { Transaction } from '../models/transaction';
import { resolveStrategy } from './accountingStrategy';

interface ResolveAccountingMethodOptions {
    transactions: Transaction[];
    startDate: Date;
    endDate: Date;
    requestedMethod?: string;
    finalise?: boolean;
}

export interface ResolvedAccountingMethod {
    accountingMethod: string;
    lockedTaxYear?: number;
    isLockedForTaxYear: boolean;
}

export function normaliseAccountingMethod(method?: string): string | undefined {
    if (!method) {
        return undefined;
    }

    const upper = method.toUpperCase();
    if (upper === 'FOFI' || upper === 'FILO') {
        return 'LIFO';
    }

    return upper;
}

export function resolveAccountingMethodForPeriod(
    options: ResolveAccountingMethodOptions
): ResolvedAccountingMethod {
    const requestedMethod = normaliseAccountingMethod(options.requestedMethod);
    if (requestedMethod) {
        resolveStrategy(requestedMethod);
    }

    const taxYear = getSingleTaxYear(options.startDate, options.endDate);
    const defaultMethod = requestedMethod ?? 'FIFO';

    if (taxYear === undefined) {
        return {
            accountingMethod: defaultMethod,
            isLockedForTaxYear: false,
        };
    }

    const lockedMethod = getLockedMethodForTaxYear(options.transactions, taxYear);
    if (!lockedMethod) {
        return {
            accountingMethod: defaultMethod,
            lockedTaxYear: taxYear,
            isLockedForTaxYear: false,
        };
    }

    if (options.finalise) {
        throw new Error(
            `Tax year ${taxYear} has already been finalised using ${lockedMethod}. ` +
            `Generate reports without finalise=true and omit method or use method=${lockedMethod}.`
        );
    }

    if (requestedMethod && requestedMethod !== lockedMethod) {
        throw new Error(
            `Tax year ${taxYear} has already been finalised using ${lockedMethod}. ` +
            `Omit the method parameter or use method=${lockedMethod}.`
        );
    }

    return {
        accountingMethod: lockedMethod,
        lockedTaxYear: taxYear,
        isLockedForTaxYear: true,
    };
}

function getSingleTaxYear(startDate: Date, endDate: Date): number | undefined {
    if (startDate.getFullYear() !== endDate.getFullYear()) {
        return undefined;
    }

    return startDate.getFullYear();
}

function getLockedMethodForTaxYear(transactions: Transaction[], taxYear: number): string | undefined {
    const strategies = new Set<string>();

    for (const transaction of transactions) {
        for (const allocation of transaction.lotAllocations ?? []) {
            if (allocation.taxYear === taxYear) {
                strategies.add(normaliseAccountingMethod(allocation.strategy) ?? allocation.strategy);
            }
        }
    }

    if (strategies.size > 1) {
        throw new Error(
            `Tax year ${taxYear} contains persisted lot allocations from multiple accounting methods: ` +
            `${Array.from(strategies).join(', ')}. Clean up the stored lot allocations before generating new reports.`
        );
    }

    return strategies.size === 1 ? Array.from(strategies)[0] : undefined;
}