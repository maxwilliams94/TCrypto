/**
 * Test to verify that NOK (native currency) is not tracked in the portfolio
 */

import { Transaction } from '../src/models/transaction';
import { generateTaxReport } from '../src/services/profitReporter';
import { CurrencyRateMemoryRepository } from '../src/repositories/currencyRateMemory';

async function testNoNOKInPortfolio() {
    console.log('=== Testing that NOK is excluded from portfolio ===\n');

    const currencyRateRepo = new CurrencyRateMemoryRepository();

    const transactions: Transaction[] = [
        // BUY BTC with NOK (BTC should be in portfolio, NOK should not)
        new Transaction(
            'buy-btc-1',
            'BTC',
            'NOK',
            'Exchange',
            'BUY',
            1.0,
            800000,
            800000,
            2000,
            new Date('2025-01-15T10:00:00Z'),
            'TRADE'
        ),
        // SELL BTC for NOK (BTC portfolio should update, NOK should not be tracked)
        new Transaction(
            'sell-btc-1',
            'BTC',
            'NOK',
            'Exchange',
            'SELL',
            0.5,
            600000,
            1200000,
            1200,
            new Date('2025-06-15T10:00:00Z'),
            'TRADE'
        ),
    ];

    // Set tax conversions
    transactions.forEach(t => t.setTaxConversion('NOK', 1.0, t.dateTime));

    // Generate 2025 tax report
    const taxReport = await generateTaxReport(
        transactions,
        'NOK',
        new Date('2025-01-01T00:00:00Z'),
        new Date('2025-12-31T23:59:59Z'),
        'FIFO',
        currencyRateRepo
    );

    console.log('Portfolio Assets:');
    const assetNames = Array.from(taxReport.portfolio?.positions.keys() || []);
    console.log(`  Assets tracked: ${assetNames.join(', ')}`);
    console.log(`  Total assets: ${assetNames.length}`);

    console.log('\nChecking for NOK:');
    const hasNOK = assetNames.includes('NOK');
    console.log(`  NOK in portfolio: ${hasNOK ? '❌ FOUND (should not be there!)' : '✅ NOT FOUND (correct!)'}`);

    console.log('\nBTC Position:');
    const btcPosition = taxReport.portfolio?.getPosition('BTC');
    if (btcPosition) {
        console.log(`  Current Holdings: ${btcPosition.totalQuantity} BTC`);
        console.log(`  Average Cost: ${btcPosition.averageCostBasis.toFixed(2)} NOK per BTC`);
        console.log(`  Total Invested: ${btcPosition.totalCostBasis.toFixed(2)} NOK`);
    }

    console.log('\n=== Summary ===');
    if (!hasNOK && assetNames.includes('BTC')) {
        console.log('✅ SUCCESS: Portfolio correctly excludes NOK and includes BTC');
    } else {
        console.log('❌ FAILURE: Portfolio structure is incorrect');
        if (hasNOK) console.log('  - NOK should not be in portfolio');
        if (!assetNames.includes('BTC')) console.log('  - BTC should be in portfolio');
    }
}

testNoNOKInPortfolio().catch(console.error);
