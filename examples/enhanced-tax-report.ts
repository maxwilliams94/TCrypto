/**
 * Example script demonstrating the enhanced tax reporting with detailed sell event tracking
 * 
 * This example shows:
 * 1. How fees from buys are included when calculating profit/loss on sells
 * 2. How FIFO matching works to associate sells with their original buys
 * 3. How to generate a detailed tax report with sell events
 */

import { Transaction } from '../src/models/transaction';
import { generateTaxReport } from '../src/services/profitReporter';
import { CurrencyRateMemoryRepository } from '../src/repositories/currencyRateMemory';

async function demonstrateEnhancedTaxReport() {
    console.log('=== Enhanced Tax Report Example ===\n');

    // Create a mock currency rate repository
    const currencyRateRepo = new CurrencyRateMemoryRepository();

    // Create sample transactions
    const transactions: Transaction[] = [
        // Buy 1 BTC at 400,000 NOK with 1,000 NOK fee
        new Transaction(
            'buy-1',
            'BTC',
            'NOK',
            'Firi',
            'BUY',
            1.0,      // baseSize: 1 BTC
            400000,   // quoteSize: 400,000 NOK
            400000,   // price: 400,000 NOK per BTC
            1000,     // fee: 1,000 NOK
            new Date('2024-01-15T10:00:00Z'),
            'TRADE'
        ),
        
        // Buy 0.5 BTC at 450,000 NOK with 500 NOK fee
        new Transaction(
            'buy-2',
            'BTC',
            'NOK',
            'Firi',
            'BUY',
            0.5,      // baseSize: 0.5 BTC
            225000,   // quoteSize: 225,000 NOK
            450000,   // price: 450,000 NOK per BTC
            500,      // fee: 500 NOK
            new Date('2024-06-15T10:00:00Z'),
            'TRADE'
        ),
        
        // Sell 0.8 BTC at 500,000 NOK with 800 NOK fee
        // This should match:
        // - 0.8 BTC from buy-1 (using 80% of that buy, so 80% of the 1,000 NOK fee = 800 NOK)
        new Transaction(
            'sell-1',
            'BTC',
            'NOK',
            'Firi',
            'SELL',
            0.8,      // baseSize: 0.8 BTC
            400000,   // quoteSize: 400,000 NOK
            500000,   // price: 500,000 NOK per BTC
            800,      // fee: 800 NOK
            new Date('2024-09-15T10:00:00Z'),
            'TRADE'
        ),
        
        // Sell 0.5 BTC at 480,000 NOK with 600 NOK fee
        // This should match:
        // - 0.2 BTC from buy-1 (remaining 20%, so 20% of the 1,000 NOK fee = 200 NOK)
        // - 0.3 BTC from buy-2 (using 60% of that buy, so 60% of the 500 NOK fee = 300 NOK)
        new Transaction(
            'sell-2',
            'BTC',
            'NOK',
            'Firi',
            'SELL',
            0.5,      // baseSize: 0.5 BTC
            240000,   // quoteSize: 240,000 NOK
            480000,   // price: 480,000 NOK per BTC
            600,      // fee: 600 NOK
            new Date('2024-11-15T10:00:00Z'),
            'TRADE'
        )
    ];

    // Set tax conversions (already in NOK, so rate is 1.0)
    transactions.forEach(t => {
        t.setTaxConversion('NOK', 1.0, t.dateTime);
    });

    console.log('Transaction History:');
    transactions.forEach(t => {
        console.log(`  ${t.dateTime.toISOString().split('T')[0]} - ${t.side} ${t.baseSize} ${t.baseCurrency} @ ${t.price} NOK (fee: ${t.fee} NOK)`);
    });
    console.log();

    // Generate tax report for 2024
    const taxReport = await generateTaxReport(
        transactions,
        'NOK',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-12-31T23:59:59Z'),
        'FIFO',
        currencyRateRepo
    );

    console.log('=== Tax Report Summary ===');
    console.log(`Period: ${taxReport.startDate.toISOString().split('T')[0]} to ${taxReport.endDate.toISOString().split('T')[0]}`);
    console.log(`Currency: ${taxReport.baseCurrency}`);
    console.log(`Buys: ${taxReport.buys}`);
    console.log(`Sells: ${taxReport.sells}`);
    console.log(`Total Profit/Loss: ${taxReport.profit?.toFixed(2)} ${taxReport.baseCurrency}`);
    console.log(`Total Fees (Buy + Sell): ${taxReport.fees?.toFixed(2)} ${taxReport.baseCurrency}`);
    console.log(`  - Buy Fees Included: ${taxReport.totalBuyFeesIncluded?.toFixed(2)} ${taxReport.baseCurrency}`);
    console.log(`  - Sell Fees: ${taxReport.totalSellFees?.toFixed(2)} ${taxReport.baseCurrency}`);
    console.log();

    console.log('=== Detailed Sell Events ===');
    taxReport.sellEvents?.forEach((sellEvent, index) => {
        console.log(`\nSell Event #${index + 1} (${sellEvent.sellDate.toISOString().split('T')[0]})`);
        console.log(`  Transaction: ${sellEvent.sellTransactionId}`);
        console.log(`  Asset: ${sellEvent.asset}`);
        console.log(`  Quantity: ${sellEvent.totalQuantity} ${sellEvent.asset}`);
        console.log(`  Sell Price: ${sellEvent.sellPrice.toFixed(2)} ${sellEvent.currency} per unit`);
        console.log(`  Proceeds: ${sellEvent.proceeds.toFixed(2)} ${sellEvent.currency}`);
        console.log(`  Sell Fee: ${sellEvent.sellFee.toFixed(2)} ${sellEvent.currency}`);
        console.log();
        
        console.log('  FIFO Matching (Associated Buy Transaction IDs):');
        sellEvent.buyAllocations.forEach((alloc, i) => {
            console.log(`    Buy #${i + 1}: ${alloc.buyTransactionId}`);
            console.log(`      Quantity: ${alloc.quantity} ${sellEvent.asset}`);
            console.log(`      Cost Basis: ${alloc.costBasis.toFixed(2)} ${sellEvent.currency}`);
        });
        
        console.log();
        console.log('  Calculation:');
        console.log(`    Proceeds: ${sellEvent.proceeds.toFixed(2)} ${sellEvent.currency}`);
        console.log(`    Cost Basis: ${sellEvent.totalCostBasis.toFixed(2)} ${sellEvent.currency} (includes ${sellEvent.totalBuyFees.toFixed(2)} ${sellEvent.currency} in buy fees)`);
        console.log(`    Sell Fee: ${sellEvent.sellFee.toFixed(2)} ${sellEvent.currency}`);
        console.log(`    Profit/Loss: ${sellEvent.profitLoss.toFixed(2)} ${sellEvent.currency}`);
        console.log(`    Formula: ${sellEvent.proceeds.toFixed(2)} - ${sellEvent.totalCostBasis.toFixed(2)} - ${sellEvent.sellFee.toFixed(2)} = ${sellEvent.profitLoss.toFixed(2)}`);
    });

    console.log('\n=== Manual Verification ===');
    console.log('\nSell Event #1 (0.8 BTC @ 500,000 NOK):');
    console.log('  Proceeds: 0.8 × 500,000 = 400,000 NOK');
    console.log('  Cost basis: (0.8 × 400,000) + (0.8 × 1,000 fee) = 320,000 + 800 = 320,800 NOK');
    console.log('  Sell fee: 800 NOK');
    console.log('  Profit: 400,000 - 320,800 - 800 = 78,400 NOK');
    
    console.log('\nSell Event #2 (0.5 BTC @ 480,000 NOK):');
    console.log('  Proceeds: 0.5 × 480,000 = 240,000 NOK');
    console.log('  Cost basis from buy-1: (0.2 × 400,000) + (0.2 × 1,000 fee) = 80,000 + 200 = 80,200 NOK');
    console.log('  Cost basis from buy-2: (0.3 × 450,000) + (0.3 × 500 fee) = 135,000 + 300 = 135,300 NOK');
    console.log('  Total cost basis: 80,200 + 135,300 = 215,500 NOK');
    console.log('  Sell fee: 600 NOK');
    console.log('  Profit: 240,000 - 215,500 - 600 = 23,900 NOK');
    
    console.log('\nTotal Profit: 78,400 + 23,900 = 102,300 NOK');
    console.log('Total Fees: (800 + 200 + 300 + 300) + (800 + 600) = 1,600 + 1,400 = 3,000 NOK');
    
    console.log('\n=== Portfolio Summary ===');
    console.log(`Currency: ${taxReport.portfolio?.currency}`);
    console.log(`Total Realized Gain/Loss: ${taxReport.portfolio?.getTotalRealizedGainLoss().toFixed(2)} NOK`);
    console.log(`Number of Positions: ${taxReport.portfolio?.getAllPositions(false).length}`);
    console.log();
    
    console.log('=== Asset Positions ===');
    taxReport.portfolio?.getAllPositions(true).forEach(position => {
        console.log(`\n${position.asset}:`);
        console.log(`  Holdings:`);
        console.log(`    Quantity: ${position.totalQuantity.toFixed(8)}`);
        console.log(`    Average Cost Basis: ${position.averageCostBasis.toFixed(2)} NOK per unit`);
        console.log(`    Total Cost Basis: ${position.totalCostBasis.toFixed(2)} NOK`);
        
        console.log(`  Period Activity:`);
        console.log(`    Bought: ${position.quantityBought} ${position.asset}`);
        console.log(`    Sold: ${position.quantitySold} ${position.asset}`);
        console.log(`    Realized Gain/Loss: ${position.realizedGainLoss.toFixed(2)} NOK`);
        console.log(`    Buy Fees: ${position.totalBuyFees.toFixed(2)} NOK`);
        console.log(`    Sell Fees: ${position.totalSellFees.toFixed(2)} NOK`);
        console.log(`    Total Fees: ${(position.totalBuyFees + position.totalSellFees).toFixed(2)} NOK`);
        
        if (position.isClosed()) {
            console.log(`    Status: ✓ Position Closed`);
        } else {
            console.log(`    Status: ○ Position Open (${position.totalQuantity.toFixed(8)} ${position.asset} remaining)`);
        }
    });
}

// Run the example
demonstrateEnhancedTaxReport().catch(console.error);
