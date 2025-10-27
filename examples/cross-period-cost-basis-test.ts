/**
 * Test to verify cost basis is correctly calculated when:
 * - Buys happen in 2024 (before the reporting period)
 * - Sells happen in 2025 (within the reporting period)
 * 
 * This tests that the portfolio correctly tracks ALL transactions
 * to maintain accurate holdings, while only counting period activity
 * for the reporting period.
 */

import { Transaction } from '../src/models/transaction';
import { generateTaxReport } from '../src/services/profitReporter';
import { CurrencyRateMemoryRepository } from '../src/repositories/currencyRateMemory';

async function testCrossPeriodCostBasis() {
    console.log('=== Cross-Period Cost Basis Test ===\n');
    console.log('Scenario: Buy BTC in 2024, sell some in 2025');
    console.log('Expected: Portfolio should track full cost basis from 2024 buys\n');

    const currencyRateRepo = new CurrencyRateMemoryRepository();

    const transactions: Transaction[] = [
        // 2024 Buys (out of 2025 reporting period)
        new Transaction(
            'btc-buy-2024-1',
            'BTC',
            'NOK',
            'Exchange',
            'BUY',
            1.0,
            800000,
            800000,
            2000,
            new Date('2024-03-15T10:00:00Z'),
            'TRADE'
        ),
        new Transaction(
            'btc-buy-2024-2',
            'BTC',
            'NOK',
            'Exchange',
            'BUY',
            0.5,
            450000,
            900000,
            1000,
            new Date('2024-09-20T10:00:00Z'),
            'TRADE'
        ),
        
        // 2025 Buy (within reporting period)
        new Transaction(
            'btc-buy-2025-1',
            'BTC',
            'NOK',
            'Exchange',
            'BUY',
            0.3,
            300000,
            1000000,
            500,
            new Date('2025-02-10T10:00:00Z'),
            'TRADE'
        ),
        
        // 2025 Sell (within reporting period)
        // Should use FIFO: 0.6 BTC from 2024 buys
        new Transaction(
            'btc-sell-2025-1',
            'BTC',
            'NOK',
            'Exchange',
            'SELL',
            0.6,
            720000,
            1200000,
            1200,
            new Date('2025-05-15T10:00:00Z'),
            'TRADE'
        ),
    ];

    // Set tax conversions
    transactions.forEach(t => t.setTaxConversion('NOK', 1.0, t.dateTime));

    console.log('Transaction History:');
    console.log('\n2024 Transactions (before reporting period):');
    transactions.filter(t => t.dateTime.getFullYear() === 2024).forEach(t => {
        console.log(`  ${t.dateTime.toISOString().split('T')[0]} - ${t.side} ${t.baseSize} BTC @ ${t.price.toLocaleString()} NOK (fee: ${t.fee} NOK)`);
    });
    
    console.log('\n2025 Transactions (within reporting period):');
    transactions.filter(t => t.dateTime.getFullYear() === 2025).forEach(t => {
        console.log(`  ${t.dateTime.toISOString().split('T')[0]} - ${t.side} ${t.baseSize} BTC @ ${t.price.toLocaleString()} NOK (fee: ${t.fee} NOK)`);
    });

    // Generate 2025 tax report
    const taxReport = await generateTaxReport(
        transactions,
        'NOK',
        new Date('2025-01-01T00:00:00Z'),
        new Date('2025-12-31T23:59:59Z'),
        'FIFO',
        currencyRateRepo
    );

    console.log('\n=== 2025 Tax Report ===');
    console.log(`Period: ${taxReport.startDate.toISOString().split('T')[0]} to ${taxReport.endDate.toISOString().split('T')[0]}`);
    console.log(`Buys in period: ${taxReport.buys}`);
    console.log(`Sells in period: ${taxReport.sells}`);
    console.log(`Realized Gain/Loss: ${taxReport.profit?.toFixed(2)} NOK`);

    console.log('\n=== Portfolio State at End of 2025 ===');
    const btcPosition = taxReport.portfolio?.getPosition('BTC');
    
    if (!btcPosition) {
        console.log('ERROR: No BTC position found!');
        return;
    }

    console.log(`\nBTC Holdings:`);
    console.log(`  Quantity: ${btcPosition.totalQuantity.toFixed(8)} BTC`);
    console.log(`  Average Cost Basis: ${btcPosition.averageCostBasis.toFixed(2)} NOK per BTC`);
    console.log(`  Total Cost Basis: ${btcPosition.totalCostBasis.toFixed(2)} NOK`);

    console.log(`\n2025 Period Activity:`);
    console.log(`  Bought in 2025: ${btcPosition.quantityBought} BTC`);
    console.log(`  Sold in 2025: ${btcPosition.quantitySold} BTC`);
    console.log(`  Realized Gain/Loss in 2025: ${btcPosition.realizedGainLoss.toFixed(2)} NOK`);
    console.log(`  Buy Fees in 2025: ${btcPosition.totalBuyFees.toFixed(2)} NOK`);
    console.log(`  Sell Fees in 2025: ${btcPosition.totalSellFees.toFixed(2)} NOK`);

    console.log('\n=== Expected Calculations ===');
    console.log('\nStarting position (from 2024 buys):');
    console.log('  1.0 BTC @ 800,000 NOK + 2,000 fee = 802,000 NOK cost basis');
    console.log('  0.5 BTC @ 900,000 NOK + 1,000 fee = 451,000 NOK cost basis');
    console.log('  Total: 1.5 BTC with 1,253,000 NOK total cost basis');
    console.log('  Average: 835,333.33 NOK per BTC');
    
    console.log('\n2025 Buy:');
    console.log('  0.3 BTC @ 1,000,000 NOK + 500 fee = 300,500 NOK cost basis');
    console.log('  New total: 1.8 BTC with 1,553,500 NOK total cost basis');
    console.log('  New average: 863,055.56 NOK per BTC');
    
    console.log('\n2025 Sell (FIFO matching):');
    console.log('  Selling 0.6 BTC');
    console.log('  Uses: 0.6 BTC from first 2024 buy');
    console.log('  Cost basis: 0.6 × 800,000 + (0.6 × 2,000 fee) = 480,000 + 1,200 = 481,200 NOK');
    console.log('  Proceeds: 0.6 × 1,200,000 = 720,000 NOK');
    console.log('  Sell fee: 1,200 NOK');
    console.log('  Gain: 720,000 - 481,200 - 1,200 = 237,600 NOK');
    
    console.log('\nRemaining position:');
    console.log('  Started with: 1,553,500 NOK for 1.8 BTC');
    console.log('  Sold cost basis: 481,200 NOK for 0.6 BTC');
    console.log('  Remaining: 1,072,300 NOK for 1.2 BTC');
    console.log('  Average: 893,583.33 NOK per BTC');

    console.log('\n=== Verification ===');
    const expectedQuantity = 1.2;
    const expectedCostBasis = 1072300;
    const expectedAvgCost = expectedCostBasis / expectedQuantity;
    const expectedGain = 237600;

    console.log(`\nExpected quantity: ${expectedQuantity} BTC`);
    console.log(`Actual quantity:   ${btcPosition.totalQuantity.toFixed(8)} BTC`);
    console.log(`Match: ${Math.abs(btcPosition.totalQuantity - expectedQuantity) < 0.00001 ? '✅' : '❌'}`);

    console.log(`\nExpected total cost basis: ${expectedCostBasis.toFixed(2)} NOK`);
    console.log(`Actual total cost basis:   ${btcPosition.totalCostBasis.toFixed(2)} NOK`);
    console.log(`Match: ${Math.abs(btcPosition.totalCostBasis - expectedCostBasis) < 1 ? '✅' : '❌'}`);

    console.log(`\nExpected average cost: ${expectedAvgCost.toFixed(2)} NOK per BTC`);
    console.log(`Actual average cost:   ${btcPosition.averageCostBasis.toFixed(2)} NOK per BTC`);
    console.log(`Match: ${Math.abs(btcPosition.averageCostBasis - expectedAvgCost) < 1 ? '✅' : '❌'}`);

    console.log(`\nExpected 2025 realized gain: ${expectedGain.toFixed(2)} NOK`);
    console.log(`Actual 2025 realized gain:   ${btcPosition.realizedGainLoss.toFixed(2)} NOK`);
    console.log(`Match: ${Math.abs(btcPosition.realizedGainLoss - expectedGain) < 1 ? '✅' : '❌'}`);

    console.log(`\nExpected 2025 buy activity: 0.3 BTC (only 2025 buys count)`);
    console.log(`Actual 2025 buy activity:   ${btcPosition.quantityBought} BTC`);
    console.log(`Match: ${btcPosition.quantityBought === 0.3 ? '✅' : '❌'}`);

    const allMatch = 
        Math.abs(btcPosition.totalQuantity - expectedQuantity) < 0.00001 &&
        Math.abs(btcPosition.totalCostBasis - expectedCostBasis) < 1 &&
        Math.abs(btcPosition.averageCostBasis - expectedAvgCost) < 1 &&
        Math.abs(btcPosition.realizedGainLoss - expectedGain) < 1 &&
        btcPosition.quantityBought === 0.3;

    if (allMatch) {
        console.log('\n✅ SUCCESS: All calculations are correct!');
        console.log('Cost basis properly includes 2024 buys even though they are out of period.');
    } else {
        console.log('\n❌ FAILURE: Some calculations are incorrect.');
    }
}

testCrossPeriodCostBasis().catch(console.error);
