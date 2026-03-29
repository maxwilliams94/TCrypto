import * as fs from 'fs/promises';
import * as path from 'path';
import { TaxReport } from '../models/taxReport';
import { Transaction } from '../models/transaction';
import { SellEvent } from '../models/sellEvent';
import { AssetPosition, Portfolio } from '../models/portfolio';
import { normaliseAccountingMethod } from './finalisedTaxYear';

interface TaxHistoryEntry {
    startDate: string;
    endDate: string;
    accountingMethod: string;
    finalisedAt: string;
    profit?: number;
    taxYear?: number;
    report: ReturnType<TaxReport['toJSON']>;
}

export class TaxHistoryService {
    private entries: TaxHistoryEntry[] = [];
    private loaded = false;

    constructor(
        private readonly useFileStorage: boolean,
        private readonly filePath: string = './data/tax_history.json'
    ) {}

    async getStoredReport(
        startDate: Date,
        endDate: Date,
        requestedMethod?: string,
        requestedCurrency?: string
    ): Promise<TaxReport | null> {
        await this.ensureLoaded();

        const entry = this.findExactEntry(startDate, endDate);
        if (!entry) {
            return null;
        }

        const normalisedRequestedMethod = normaliseAccountingMethod(requestedMethod);
        if (normalisedRequestedMethod && normalisedRequestedMethod !== entry.accountingMethod) {
            throw new Error(
                `Tax period ${entry.startDate.split('T')[0]} to ${entry.endDate.split('T')[0]} ` +
                `has already been finalised using ${entry.accountingMethod}. ` +
                `Omit the method parameter or use method=${entry.accountingMethod}.`
            );
        }

        const normalisedRequestedCurrency = requestedCurrency?.toUpperCase();
        const storedCurrency = entry.report.baseCurrency?.toUpperCase();
        if (normalisedRequestedCurrency && storedCurrency && normalisedRequestedCurrency !== storedCurrency) {
            throw new Error(
                `Tax period ${entry.startDate.split('T')[0]} to ${entry.endDate.split('T')[0]} ` +
                `has already been finalised in ${storedCurrency}. ` +
                `Generate reports in ${storedCurrency} for the stored final report.`
            );
        }

        return hydrateTaxReport(entry.report);
    }

    async saveFinalisedReport(report: TaxReport): Promise<void> {
        await this.ensureLoaded();

        const entry: TaxHistoryEntry = {
            startDate: report.startDate.toISOString(),
            endDate: report.endDate.toISOString(),
            accountingMethod: normaliseAccountingMethod(report.accountingMethod) || report.accountingMethod,
            finalisedAt: new Date().toISOString(),
            profit: report.profit || 0,
            taxYear: report.startDate.getFullYear() === report.endDate.getFullYear()
                ? report.startDate.getFullYear()
                : undefined,
            report: report.toJSON(),
        };

        const existingIndex = this.entries.findIndex(candidate =>
            candidate.startDate === entry.startDate && candidate.endDate === entry.endDate
        );

        if (existingIndex >= 0) {
            this.entries[existingIndex] = entry;
        } else {
            this.entries.push(entry);
        }

        await this.persist();
    }

    async listEntries(): Promise<Array<Omit<TaxHistoryEntry, 'report'>>> {
        await this.ensureLoaded();
        return this.entries.map(({ report, ...entry }) => ({
            ...entry,
            // Backfill profit for legacy history entries that predate the top-level field.
            profit: entry.profit ?? report?.profit ?? 0,
        }));
    }

    async deleteEntriesForTaxYear(taxYear: number): Promise<number> {
        await this.ensureLoaded();

        const before = this.entries.length;
        this.entries = this.entries.filter(entry => !entry.taxYear || entry.taxYear !== taxYear);
        const removed = before - this.entries.length;

        if (removed > 0) {
            await this.persist();
        }

        return removed;
    }

    private findExactEntry(startDate: Date, endDate: Date): TaxHistoryEntry | undefined {
        const start = startDate.toISOString();
        const end = endDate.toISOString();
        return this.entries.find(entry => entry.startDate === start && entry.endDate === end);
    }

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) {
            return;
        }

        if (!this.useFileStorage) {
            this.entries = [];
            this.loaded = true;
            return;
        }

        try {
            const dir = path.dirname(this.filePath);
            await fs.mkdir(dir, { recursive: true });
            const raw = await fs.readFile(this.filePath, 'utf-8');
            this.entries = JSON.parse(raw);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                this.entries = [];
            } else {
                throw error;
            }
        }

        this.loaded = true;
    }

    private async persist(): Promise<void> {
        if (!this.useFileStorage) {
            return;
        }

        const dir = path.dirname(this.filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8');
    }
}

function hydrateTaxReport(snapshot: any): TaxReport {
    const report = new TaxReport(
        new Date(snapshot.startDate),
        new Date(snapshot.endDate),
        snapshot.baseCurrency,
        snapshot.accountingMethod
    );

    report.transactions = (snapshot.transactions || []).map(hydrateTransaction);
    report.accountingTransactions = (snapshot.accountingTransactions || []).map(hydrateTransaction);
    report.buys = snapshot.buys || 0;
    report.sells = snapshot.sells || 0;
    report.assets = new Set(snapshot.assets || []);
    report.exchanges = new Set(snapshot.exchanges || []);
    report.profit = snapshot.profit || 0;
    report.fees = snapshot.fees || 0;
    report.sellEvents = (snapshot.sellEvents || []).map(hydrateSellEvent);
    report.totalBuyFeesIncluded = snapshot.totalBuyFeesIncluded || 0;
    report.totalSellFees = snapshot.totalSellFees || 0;
    report.withdrawalEvents = (snapshot.withdrawalEvents || []).map((event: any) => ({
        ...event,
        feeCurrency: event.feeCurrency || '',
        withdrawalDate: new Date(event.withdrawalDate),
        includedInReport: event.includedInReport === true,
        reportTaxYear: event.reportTaxYear || new Date(snapshot.startDate).getFullYear(),
    }));
    report.deductibleFees = snapshot.deductibleFees || 0;
    report.incomeEvents = (snapshot.incomeEvents || []).map((event: any) => ({
        ...event,
        incomeDate: new Date(event.incomeDate),
    }));
    report.totalIncome = snapshot.totalIncome || 0;
    report.portfolio = snapshot.portfolio ? hydratePortfolio(snapshot.portfolio) : undefined;
    report.isFinalised = snapshot.isFinalised === true;

    return report;
}

function hydrateTransaction(raw: any): Transaction {
    const transaction = new Transaction(
        raw.id,
        raw.baseCurrency,
        raw.quoteCurrency,
        raw.exchange,
        raw.side,
        raw.baseSize,
        raw.quoteSize,
        raw.price,
        raw.fee,
        new Date(raw.dateTime),
        raw.type ?? 'TRADE'
    );

    transaction.taxCurrency = raw.taxCurrency;
    transaction.taxQuoteSize = raw.taxQuoteSize;
    transaction.taxPrice = raw.taxPrice;
    transaction.taxFee = raw.taxFee;
    transaction.taxConversionRate = raw.taxConversionRate;
    transaction.taxConversionDate = raw.taxConversionDate ? new Date(raw.taxConversionDate) : undefined;
    transaction.feeCurrency = raw.feeCurrency;
    transaction.sourceTransactionId = raw.sourceTransactionId;
    transaction.leg = raw.leg;
    transaction.processingSequence = raw.processingSequence;
    transaction.rewardSource = raw.rewardSource;
    transaction.incomeValue = raw.incomeValue;
    transaction.incomeValueInTaxCurrency = raw.incomeValueInTaxCurrency;
    transaction.incomeConversionRate = raw.incomeConversionRate;
    transaction.incomeDate = raw.incomeDate ? new Date(raw.incomeDate) : undefined;
    transaction.lotConsumedQuantity = raw.lotConsumedQuantity;
    transaction.lotRemainingQuantity = raw.lotRemainingQuantity;
    transaction.lotFullyConsumed = raw.lotFullyConsumed;
    transaction.lotConsumptionStrategy = raw.lotConsumptionStrategy;
    transaction.lotAllocations = (raw.lotAllocations || []).map((allocation: any) => ({
        ...allocation,
        sellDate: new Date(allocation.sellDate),
    }));

    return transaction;
}

function hydrateSellEvent(raw: any): SellEvent {
    const sellEvent = new SellEvent(
        raw.sellTransactionId,
        new Date(raw.sellDate),
        raw.asset,
        raw.exchange,
        raw.currency,
        raw.totalQuantity,
        raw.sellPrice,
        raw.sellFee
    );

    sellEvent.proceeds = raw.proceeds;
    sellEvent.buyAllocations = raw.buyAllocations || [];
    sellEvent.totalCostBasis = raw.totalCostBasis;
    sellEvent.totalBuyFees = raw.totalBuyFees;
    sellEvent.profitLoss = raw.profitLoss;
    sellEvent.taxYear = raw.taxYear;

    return sellEvent;
}

function hydratePortfolio(raw: any): Portfolio {
    const portfolio = new Portfolio(raw.currency);

    for (const rawPosition of raw.positions || []) {
        const position = new AssetPosition(rawPosition.asset, rawPosition.currency);
        position.totalQuantity = rawPosition.holdings?.quantity || 0;
        position.averageCostBasis = rawPosition.holdings?.averageCostBasis || 0;
        position.totalCostBasis = rawPosition.holdings?.totalCostBasis || 0;
        position.currentValue = rawPosition.holdings?.currentValue;
        position.unrealizedGainLoss = rawPosition.holdings?.unrealizedGainLoss;
        position.quantityBought = rawPosition.periodActivity?.quantityBought || 0;
        position.quantitySold = rawPosition.periodActivity?.quantitySold || 0;
        position.realizedGainLoss = rawPosition.periodActivity?.realizedGainLoss || 0;
        position.totalBuyFees = rawPosition.periodActivity?.totalBuyFees || 0;
        position.totalSellFees = rawPosition.periodActivity?.totalSellFees || 0;
        portfolio.positions.set(position.asset, position);
    }

    return portfolio;
}
