/**
 * Test script to verify proportional fee allocation when partially selling a lot
 * 
 * Scenario:
 * - Buy 1.0 BTC with 1,000 NOK fee
 * - Sell 0.3 BTC (30% of the lot) → should use 30% of fee = 300 NOK
 * - Sell 0.5 BTC (50% of the lot) → should use 50% of fee = 500 NOK  
 * - Sell 0.2 BTC (20% of the lot) → should use 20% of fee = 200 NOK
 * 
 * Total fees allocated: 300 + 500 + 200 = 1,000 NOK ✓
 */

import { Transaction } from '../src/models/transaction';
import { generateTaxReport } from '../src/services/profitReporter';
import { CurrencyRateMemoryRepository } from '../src/repositories/currencyRateMemory';

async function testProportionalFeeAllocation() {
    console.log('=== Proportional Fee Allocation Test ===\n');

    const currencyRateRepo = new CurrencyRateMemoryRepository();

    const transactions: Transaction[] = [
        // Buy 1.0 BTC at 400,000 NOK with 1,000 NOK fee
        new Transaction(
            'buy-1',
            'BTC',
            'NOK',
            'Exchange',
            'BUY',
            1.0,      // baseSize: 1.0 BTC
            400000,   // quoteSize: 400,000 NOK
            400000,   // price: 400,000 NOK per BTC
            1000,     // fee: 1,000 NOK
            new Date('2024-01-01T10:00:00Z'),
            'TRADE'
        ),
        
        // Sell 30% of the lot (0.3 BTC)
        // Should use 30% of the fee = 300 NOK
        new Transaction(
            'sell-1',
            'BTC',
            'NOK',
            'Exchange',
            'SELL',
            0.3,      // 30% of 1.0 BTC
            150000,
            500000,
            100,
            new Date('2024-06-01T10:00:00Z'),
            'TRADE'
        ),
        
        // Sell 50% of the lot (0.5 BTC)
        // Should use 50% of the fee = 500 NOK
        new Transaction(
            'sell-2',
            'BTC',
            'NOK',
            'Exchange',
            'SELL',
            0.5,      // 50% of 1.0 BTC
            250000,
            500000,
            150,
            new Date('2024-09-01T10:00:00Z'),
            'TRADE'
        ),
        
        // Sell remaining 20% of the lot (0.2 BTC)
        // Should use 20% of the fee = 200 NOK
        new Transaction(
            'sell-3',
            'BTC',
            'NOK',
            'Exchange',
            'SELL',
            0.2,      // 20% of 1.0 BTC
            100000,
            500000,
            50,
            new Date('2024-12-01T10:00:00Z'),
            'TRADE'
        )
    ];

    // Set tax conversions (already in NOK, so rate is 1.0)
    transactions.forEach(t => {
        t.setTaxConversion('NOK', 1.0, t.dateTime);
    });

    console.log('Scenario: Buy 1.0 BTC with 1,000 NOK fee, then sell in 3 parts\n');
    console.log('Transaction History:');
    transactions.forEach(t => {
        if (t.side === 'BUY') {
            console.log(`  ${t.dateTime.toISOString().split('T')[0]} - BUY ${t.baseSize} BTC @ ${t.price} NOK (fee: ${t.fee} NOK)`);
        } else {
            const percentage = (t.baseSize / 1.0) * 100;
            console.log(`  ${t.dateTime.toISOString().split('T')[0]} - SELL ${t.baseSize} BTC (${percentage}% of lot) @ ${t.price} NOK (fee: ${t.fee} NOK)`);
        }
    });
    console.log();

    // Generate tax report
    const taxReport = await generateTaxReport(
        transactions,
        'NOK',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-12-31T23:59:59Z'),
        'FIFO',
        currencyRateRepo
    );

    console.log('=== Sell Events with Fee Allocation ===\n');
    
    let totalBuyFeesAllocated = 0;
    
    taxReport.sellEvents?.forEach((sellEvent, index) => {
        const percentage = (sellEvent.totalQuantity / 1.0) * 100;
        console.log(`Sell Event #${index + 1} - ${sellEvent.totalQuantity} BTC (${percentage}% of lot)`);
        console.log(`  Date: ${sellEvent.sellDate.toISOString().split('T')[0]}`);
        console.log(`  Proceeds: ${sellEvent.proceeds.toFixed(2)} NOK`);
        console.log(`  Sell Fee: ${sellEvent.sellFee.toFixed(2)} NOK`);
        
        sellEvent.buyAllocations.forEach((alloc, i) => {
            const buyFeeForThisAlloc = sellEvent.totalBuyFees; // Since we only have one buy, this is the total
            console.log(`  Matched with Buy: ${alloc.buyTransactionId}`);
            console.log(`    Quantity from buy: ${alloc.quantity} BTC`);
            console.log(`    Buy fee allocated: ${buyFeeForThisAlloc.toFixed(2)} NOK (${percentage}% of 1,000 NOK)`);
            console.log(`    Cost basis: ${alloc.costBasis.toFixed(2)} NOK`);
        });
        
        console.log(`  Profit/Loss: ${sellEvent.profitLoss.toFixed(2)} NOK\n`);
        
        totalBuyFeesAllocated += sellEvent.totalBuyFees;
    });

    console.log('=== Fee Allocation Summary ===');
    console.log(`Original buy fee: 1,000.00 NOK`);
    console.log(`Total buy fees allocated across all sells: ${totalBuyFeesAllocated.toFixed(2)} NOK`);
    console.log(`Difference: ${(1000 - totalBuyFeesAllocated).toFixed(2)} NOK`);
    
    if (Math.abs(1000 - totalBuyFeesAllocated) < 0.01) {
        console.log(`\n✅ SUCCESS: Fee allocation is correct! All 1,000 NOK of buy fees were proportionally allocated.`);
    } else {
        console.log(`\n❌ ERROR: Fee allocation mismatch!`);
    }
    
    console.log('\n=== Breakdown ===');
    console.log('Sell 1 (30%): Should allocate 300 NOK of buy fee');
    console.log('Sell 2 (50%): Should allocate 500 NOK of buy fee');
    console.log('Sell 3 (20%): Should allocate 200 NOK of buy fee');
    console.log('Total: 300 + 500 + 200 = 1,000 NOK ✓');
}

// Run the test
testProportionalFeeAllocation().catch(console.error);
