/**
 * CSV Export Demonstration
 * 
 * This script demonstrates how to:
 * 1. Generate a tax report for a specific period
 * 2. Export the tax report to CSV files in various formats
 * 3. Export transactions to CSV
 * 
 * Run with: npx ts-node examples/csv-export-demo.ts
 */

import path from 'path';
import { Transaction } from '../src/models/transaction';
import { generateTaxReport } from '../src/services/profitReporter';
import { CurrencyRateMemoryRepository } from '../src/repositories/currencyRateMemory';
import { 
    exportSellEventsToCSV,
    exportSellEventAllocationsToCSV,
    exportPortfolioToCSV,
    exportTaxReportSummaryToCSV,
    exportTaxReportComplete
} from '../src/services/csvExporter';

async function main() {
    console.log('=== CSV Export Demonstration ===\n');

    // Create sample transactions with realistic data
    const transactions: Transaction[] = [
        // Initial BTC purchase
        new Transaction(
            'buy-btc-1',
            'BTC',
            'NOK',
            'test',
            'BUY',
            0.5,
            250000,
            500000,
            100,
            new Date('2024-01-15T10:00:00Z'),
            'TRADE'
        ),
        // Buy more BTC
        new Transaction(
            'buy-btc-2',
            'BTC',
            'NOK',
            'test',
            'BUY',
            0.3,
            180000,
            600000,
            80,
            new Date('2024-03-01T10:00:00Z'),
            'TRADE'
        ),
        // Staking reward
        new Transaction(
            'reward-eth-1',
            'ETH',
            'NOK',
            'test',
            'BUY',
            0.1,
            3000,
            30000,
            0,
            new Date('2024-04-01T10:00:00Z'),
            'STAKING_REWARD',
            'validator-001',
            12345,
            'Ethereum Beacon Chain'
        ),
        // Partial sell of first BTC lot
        new Transaction(
            'sell-btc-1',
            'BTC',
            'NOK',
            'test',
            'SELL',
            0.3,
            210000,
            700000,
            90,
            new Date('2024-06-15T10:00:00Z'),
            'TRADE'
        ),
        // Sell remaining BTC from first lot and part of second
        new Transaction(
            'sell-btc-2',
            'BTC',
            'NOK',
            'test',
            'SELL',
            0.4,
            320000,
            800000,
            100,
            new Date('2024-09-01T10:00:00Z'),
            'TRADE'
        ),
        // Buy ETH
        new Transaction(
            'buy-eth-1',
            'ETH',
            'NOK',
            'test',
            'BUY',
            2.0,
            60000,
            30000,
            50,
            new Date('2024-10-01T10:00:00Z'),
            'TRADE'
        ),
        // Sell ETH (including staking reward)
        new Transaction(
            'sell-eth-1',
            'ETH',
            'NOK',
            'test',
            'SELL',
            1.5,
            52500,
            35000,
            60,
            new Date('2024-11-15T10:00:00Z'),
            'TRADE'
        )
    ];

    console.log(`Processing ${transactions.length} transactions...\n`);

    // Generate tax report for 2024
    const startDate = new Date('2024-01-01T00:00:00Z');
    const endDate = new Date('2024-12-31T23:59:59Z');
    const currency = 'NOK';

    const currencyRateRepo = new CurrencyRateMemoryRepository();
    const taxReport = await generateTaxReport(
        transactions,
        currency,
        startDate,
        endDate,
        'FIFO',
        currencyRateRepo
    );

    // Display summary
    console.log('Tax Report Summary:');
    console.log(`Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    console.log(`Total Profit/Loss: ${taxReport.profit?.toFixed(2)} ${currency}`);
    console.log(`Sell Events: ${taxReport.sellEvents?.length || 0}`);
    console.log(`Portfolio Assets: ${taxReport.portfolio?.positions.size || 0}\n`);

    // Create exports directory
    const exportDir = path.resolve(process.cwd(), 'exports/demo');

    console.log('=== Export Options ===\n');

    // Option 1: Export everything at once
    console.log('1. Complete Export (all files at once)');
    console.log('   This creates 4 CSV files with all tax report data:\n');
    await exportTaxReportComplete(
        taxReport,
        exportDir,
        taxReport.accountingTransactions ?? transactions
    );
    console.log(`   ✓ Exported to: ${exportDir}/\n`);

    // Option 2: Export individual components
    console.log('2. Individual Exports (for custom workflows)\n');

    // 2a. Export sell events summary
    const sellEventsPath = path.join(exportDir, 'custom_sell_events.csv');
    if (taxReport.sellEvents && taxReport.sellEvents.length > 0) {
        await exportSellEventsToCSV(
            taxReport.sellEvents,
            sellEventsPath,
            taxReport.accountingTransactions ?? transactions
        );
        console.log(`   ✓ Sell Events: ${sellEventsPath}`);
    }

    // 2b. Export detailed FIFO allocations
    const allocationsPath = path.join(exportDir, 'custom_allocations.csv');
    if (taxReport.sellEvents && taxReport.sellEvents.length > 0) {
        await exportSellEventAllocationsToCSV(
            taxReport.sellEvents,
            allocationsPath,
            taxReport.accountingTransactions ?? transactions
        );
        console.log(`   ✓ FIFO Allocations: ${allocationsPath}`);
    }

    // 2c. Export portfolio
    const portfolioPath = path.join(exportDir, 'custom_portfolio.csv');
    await exportPortfolioToCSV(taxReport, portfolioPath);
    console.log(`   ✓ Portfolio: ${portfolioPath}`);

    // 2d. Export summary
    const summaryPath = path.join(exportDir, 'custom_summary.csv');
    await exportTaxReportSummaryToCSV(taxReport, summaryPath);
    console.log(`   ✓ Summary: ${summaryPath}\n`);

    console.log('=== Export Details ===\n');

    // Show what's in each export type
    console.log('Sell Events CSV contains:');
    console.log('  - Date, Asset, Quantity, Proceeds, Cost Basis');
    console.log('  - Sell Fee, Buy Fees, Net Profit/Loss');
    console.log('  - FIFO Matching: Buy Count, Buy IDs, Buy Dates');
    console.log('  - Currency information\n');

    console.log('Sell Event Allocations CSV contains:');
    console.log('  - Detailed FIFO matching (one row per buy allocation)');
    console.log('  - Links sell events to specific buy transactions');
    console.log('  - Shows quantity used from each buy lot');
    console.log('  - Includes proportional cost basis and fees\n');

    console.log('Portfolio CSV contains:');
    console.log('  - Current holdings per asset');
    console.log('  - Cost basis and average price');
    console.log('  - Realized and unrealized gains/losses');
    console.log('  - Period-specific activity (bought/sold)');
    console.log('  - Open vs Closed positions\n');

    console.log('Summary CSV contains:');
    console.log('  - Key-value format with overall metrics');
    console.log('  - Total profit/loss, fees paid');
    console.log('  - Number of transactions and sell events');
    console.log('  - Tax period information\n');

    console.log('=== Using Exports ===\n');
    console.log('You can now:');
    console.log('  1. Open CSV files in Excel/Google Sheets for analysis');
    console.log('  2. Sort by date, asset, profit/loss for insights');
    console.log('  3. Verify FIFO matching with allocation details');
    console.log('  4. Check portfolio positions and cost basis');
    console.log('  5. Share with accountant for tax filing\n');

    console.log('=== API Endpoints ===\n');
    console.log('You can also export via HTTP API:');
    console.log('  GET /export/tax-report/complete?start=2024-01-01&end=2024-12-31&currency=NOK');
    console.log('  GET /export/tax-report/sell-events?start=2024-01-01&end=2024-12-31');
    console.log('  GET /export/tax-report/portfolio?start=2024-01-01&end=2024-12-31');
    console.log('  GET /export/transactions/csv (requires USE_FILE_STORAGE=true)\n');

    console.log('✓ Demo complete!\n');
}

main().catch(console.error);
