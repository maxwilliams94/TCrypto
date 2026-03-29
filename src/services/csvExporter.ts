import logger from '../logger';
/**
 * CSV export utilities for tax reports and sell events
 */

import * as fs from 'fs/promises';
import { TaxReport } from '../models/taxReport';
import { SellEvent } from '../models/sellEvent';
import { Transaction } from '../models/transaction';

/**
 * Escape CSV field (wrap in quotes if contains comma, quote, or newline)
 */
function escapeCsvField(value: any): string {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function formatFixed(value: unknown, digits: number, fallback = '0'): string {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return fallback;
    }
    return num.toFixed(digits);
}

/**
 * Convert array of rows to CSV string
 */
function arrayToCSV(headers: string[], rows: string[][]): string {
    const headerRow = headers.map(escapeCsvField).join(',');
    const dataRows = rows.map(row => row.map(escapeCsvField).join(','));
    return [headerRow, ...dataRows].join('\n');
}

/**
 * Export sell events to CSV
 * Includes all sell event details with FIFO matching
 */
export async function exportSellEventsToCSV(
    sellEvents: SellEvent[],
    outputPath: string,
    transactions?: Transaction[]
): Promise<void> {
    const headers = [
        'Date',
        'Asset',
        'Exchange',
        'Quantity',
        'Sell Price',
        'Proceeds',
        'Cost Basis',
        'Buy Fees',
        'Sell Fee',
        'Total Fees',
        'Profit/Loss',
        'Tax Year',
        'Currency',
        'Buy Count',
        'Buy Transaction IDs',
        'First Buy Date',
        'Last Buy Date'
    ];

    const rows = sellEvents.map(event => {
        // Get buy dates from transaction IDs if transactions are provided
        let firstBuyDate = '';
        let lastBuyDate = '';
        if (transactions && event.buyAllocations.length > 0) {
            const buyDates = event.buyAllocations
                .map(alloc => transactions.find(t => t.id === alloc.buyTransactionId)?.dateTime)
                .filter(d => d !== undefined)
                .sort((a, b) => a!.getTime() - b!.getTime());
            
            if (buyDates.length > 0) {
                firstBuyDate = buyDates[0]!.toISOString().split('T')[0];
                lastBuyDate = buyDates[buyDates.length - 1]!.toISOString().split('T')[0];
            }
        }

        return [
            event.sellDate.toISOString().split('T')[0],
            event.asset,
            event.exchange,
            event.totalQuantity.toFixed(8),
            event.sellPrice.toFixed(2),
            event.proceeds.toFixed(2),
            event.totalCostBasis.toFixed(2),
            event.totalBuyFees.toFixed(2),
            event.sellFee.toFixed(2),
            event.getTotalFees().toFixed(2),
            event.profitLoss.toFixed(2),
            event.taxYear.toString(),
            event.currency,
            event.buyAllocations.length.toString(),
            event.buyAllocations.map(a => a.buyTransactionId).join('; '),
            firstBuyDate,
            lastBuyDate
        ];
    });

    const csv = arrayToCSV(headers, rows);
    await fs.writeFile(outputPath, csv, 'utf-8');
    logger.info(`Exported ${sellEvents.length} sell events to ${outputPath}`);
}

/**
 * Export detailed sell event allocations to CSV
 * One row per buy allocation showing FIFO matching
 */
export async function exportSellEventAllocationsToCSV(
    sellEvents: SellEvent[],
    outputPath: string,
    transactions?: Transaction[]
): Promise<void> {
    const headers = [
        'Sell Date',
        'Sell ID',
        'Sell Exchange',
        'Asset',
        'Sell Quantity',
        'Sell Price',
        'Buy Date',
        'Buy ID',
        'Buy Exchange',
        'Buy Quantity',
        'Buy Price',
        'Allocation Quantity',
        'Allocation Cost Basis',
        'Proportional Buy Fee',
        'Currency'
    ];

    const rows: string[][] = [];

    for (const event of sellEvents) {
        for (const allocation of event.buyAllocations) {
            const buyTx = transactions?.find(t => t.id === allocation.buyTransactionId);
            const buyFee = buyTx ? 
                (allocation.quantity / buyTx.baseSize) * buyTx.getTaxFee() : 0;
            
            // Find the sell transaction to get its exchange
            const sellTx = transactions?.find(t => t.id === event.sellTransactionId);

            rows.push([
                event.sellDate.toISOString().split('T')[0],
                event.sellTransactionId,
                sellTx?.exchange || 'Unknown',
                event.asset,
                event.totalQuantity.toFixed(8),
                event.sellPrice.toFixed(2),
                buyTx?.dateTime.toISOString().split('T')[0] || 'Unknown',
                allocation.buyTransactionId,
                buyTx?.exchange || 'Unknown',
                formatFixed(buyTx?.baseSize, 8, 'Unknown'),
                formatFixed(buyTx?.getTaxPrice(), 2, 'Unknown'),
                allocation.quantity.toFixed(8),
                allocation.costBasis.toFixed(2),
                buyFee.toFixed(2),
                event.currency
            ]);
        }
    }

    const csv = arrayToCSV(headers, rows);
    await fs.writeFile(outputPath, csv, 'utf-8');
    logger.info(`Exported ${rows.length} sell event allocations to ${outputPath}`);
}

/**
 * Export portfolio summary to CSV
 */
export async function exportPortfolioToCSV(
    taxReport: TaxReport,
    outputPath: string
): Promise<void> {
    if (!taxReport.portfolio) {
        throw new Error('Tax report does not contain portfolio data');
    }

    const headers = [
        'Asset',
        'Current Quantity',
        'Average Cost Basis',
        'Total Cost Basis',
        'Quantity Bought',
        'Quantity Sold',
        'Realized Gain/Loss',
        'Unrealized Gain/Loss (est)',
        'Total Buy Fees',
        'Total Sell Fees',
        'Total Fees',
        'Status'
    ];

    const rows: string[][] = [];
    
    for (const [asset, position] of taxReport.portfolio.positions) {
        rows.push([
            asset,
            position.totalQuantity.toFixed(8),
            position.averageCostBasis.toFixed(2),
            position.totalCostBasis.toFixed(2),
            position.quantityBought.toFixed(8),
            position.quantitySold.toFixed(8),
            position.realizedGainLoss.toFixed(2),
            position.unrealizedGainLoss?.toFixed(2) || 'N/A',
            position.totalBuyFees.toFixed(2),
            position.totalSellFees.toFixed(2),
            (position.totalBuyFees + position.totalSellFees).toFixed(2),
            position.totalQuantity > 0 ? 'OPEN' : 'CLOSED'
        ]);
    }

    const csv = arrayToCSV(headers, rows);
    await fs.writeFile(outputPath, csv, 'utf-8');
    logger.info(`Exported ${rows.length} portfolio positions to ${outputPath}`);
}

/**
 * Export complete tax report summary to CSV
 */
export async function exportTaxReportSummaryToCSV(
    taxReport: TaxReport,
    outputPath: string
): Promise<void> {
    const headers = ['Metric', 'Value'];
    
    const rows = [
        ['Tax Period Start', taxReport.startDate.toISOString().split('T')[0]],
        ['Tax Period End', taxReport.endDate.toISOString().split('T')[0]],
        ['Currency', taxReport.baseCurrency],
        ['Accounting Method', taxReport.accountingMethod],
        ['Total Buys', (taxReport.buys || 0).toString()],
        ['Total Sells', (taxReport.sells || 0).toString()],
        ['Number of Sell Events', (taxReport.sellEvents?.length || 0).toString()],
        ['Total Realized Gain/Loss', (taxReport.profit || 0).toFixed(2)],
        ['Total Fees', (taxReport.fees || 0).toFixed(2)],
        ['Total Buy Fees', (taxReport.totalBuyFeesIncluded || 0).toFixed(2)],
        ['Total Sell Fees', (taxReport.totalSellFees || 0).toFixed(2)],
        ['Deductible Withdrawal Fees', (taxReport.deductibleFees || 0).toFixed(2)],
        ['Included Withdrawals', (taxReport.withdrawalEvents?.length || 0).toString()],
        ['Assets Traded', Array.from(taxReport.assets || []).join(', ')],
        ['Exchanges Used', Array.from(taxReport.exchanges || []).join(', ')],
        ['Portfolio Total Realized Gain/Loss', (taxReport.portfolio?.getTotalRealizedGainLoss() || 0).toFixed(2)],
        ['Portfolio Total Unrealized Gain/Loss', (taxReport.portfolio?.getTotalUnrealizedGainLoss() || 0).toFixed(2)]
    ];

    const csv = arrayToCSV(headers, rows);
    await fs.writeFile(outputPath, csv, 'utf-8');
    logger.info(`Exported tax report summary to ${outputPath}`);
}

/**
 * Export all transactions involved in the tax period (buys, sells, and supporting transactions)
 */
export async function exportTransactionListToCSV(
    transactions: Transaction[],
    taxReport: TaxReport,
    outputPath: string
): Promise<void> {
    const headers = [
        'Date',
        'ID',
        'Type',
        'Side',
        'Market',
        'Exchange',
        'Base Size',
        'Base Currency',
        'Quote Size',
        'Quote Currency',
        'Price',
        'Fee',
        'Fee Currency',
        'Tax Price',
        'Tax Quote Size',
        'Tax Fee',
        'Tax Currency',
        'In-Scope',
        'Source TX ID',
        'Leg',
        'Reward Source',
        'Income Value'
    ];

    const rows: string[][] = [];

    for (const tx of transactions) {
        const isInScope = tx.dateTime >= taxReport.startDate && tx.dateTime <= taxReport.endDate;
        
        rows.push([
            tx.dateTime.toISOString().split('T')[0],
            tx.id,
            tx.type,
            tx.side,
            `${tx.baseCurrency}-${tx.quoteCurrency}`,
            tx.exchange,
            formatFixed(tx.baseSize, 8),
            tx.baseCurrency,
            formatFixed(tx.quoteSize, 8),
            tx.quoteCurrency,
            formatFixed(tx.price, 8),
            (tx.fee ?? 0).toFixed(8),
            tx.feeCurrency || '',
            (tx.taxPrice ?? 'N/A').toString(),
            (tx.taxQuoteSize ?? 'N/A').toString(),
            (tx.taxFee ?? 'N/A').toString(),
            tx.taxCurrency || '',
            isInScope ? 'YES' : 'NO',
            tx.sourceTransactionId || '',
            tx.leg || '',
            tx.rewardSource || '',
            (tx.incomeValue ?? '').toString()
        ]);
    }

    const csv = arrayToCSV(headers, rows);
    await fs.writeFile(outputPath, csv, 'utf-8');
    logger.info(`Exported ${transactions.length} transactions to ${outputPath}`);
}

/**
 * Export all tax report data to multiple CSV files in a directory
 */
export async function exportTaxReportComplete(
    taxReport: TaxReport,
    outputDir: string,
    transactions?: Transaction[]
): Promise<void> {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    const period = `${taxReport.startDate.toISOString().split('T')[0]}_to_${taxReport.endDate.toISOString().split('T')[0]}`;

    // Export summary
    await exportTaxReportSummaryToCSV(
        taxReport,
        `${outputDir}/tax_report_summary_${period}.csv`
    );

    // Export sell events
    if (taxReport.sellEvents && taxReport.sellEvents.length > 0) {
        await exportSellEventsToCSV(
            taxReport.sellEvents,
            `${outputDir}/sell_events_${period}.csv`,
            transactions
        );

        // Export detailed allocations
        await exportSellEventAllocationsToCSV(
            taxReport.sellEvents,
            `${outputDir}/sell_event_allocations_${period}.csv`,
            transactions
        );
    }

    // Export portfolio
    if (taxReport.portfolio) {
        await exportPortfolioToCSV(
            taxReport,
            `${outputDir}/portfolio_${period}.csv`
        );
    }

    // Export all transactions involved in the tax calculation
    if (transactions) {
        await exportTransactionListToCSV(
            transactions,
            taxReport,
            `${outputDir}/transactions_${period}.csv`
        );
    }

    logger.info(`\n✅ Complete tax report exported to ${outputDir}/`);
}
