/**
 * Test script to analyze actual BTC transactions and verify cost basis
 */

import { Transaction } from '../src/models/transaction';
import { generateTaxReport } from '../src/services/profitReporter';
import { CurrencyRateMemoryRepository } from '../src/repositories/currencyRateMemory';
import { MemoryRepository } from '../src/repositories/memory';
import { importInitialTransactions } from '../src/services/transactionImporter';

async function testActualBTCData() {
    console.log('=== Loading Actual Transaction Data ===\n');
    
    const currencyRateRepo = new CurrencyRateMemoryRepository();
    const transactionStorage = new MemoryRepository();
    
    // Import transactions
    await importInitialTransactions(transactionStorage, currencyRateRepo, 'NOK');
    
    const transactions = await transactionStorage.getAll();
    console.log(`Loaded ${transactions.length} total transactions\n`);
    
    // Filter BTC transactions
    const btcTransactions = transactions
        .filter(t => t.baseCurrency === 'BTC')
        .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
    
    console.log(`Found ${btcTransactions.length} BTC transactions:\n`);
    
    // Show all BTC transactions
    btcTransactions.forEach((t, i) => {
        console.log(`${i + 1}. ${t.dateTime.toISOString().split('T')[0]} - ${t.side} ${t.baseSize} BTC @ ${t.price.toLocaleString()} ${t.quoteCurrency} (fee: ${t.fee} ${t.quoteCurrency})`);
    });
    
    // Generate 2025 tax report
    console.log('\n=== Generating 2025 Tax Report ===\n');
    
    const taxReport = await generateTaxReport(
        transactions,
        'NOK',
        new Date('2025-01-01T00:00:00Z'),
        new Date('2025-12-31T23:59:59Z'),
        'FIFO',
        currencyRateRepo
    );
    
    const btcPosition = taxReport.portfolio?.getPosition('BTC');
    
    if (!btcPosition) {
        console.log('No BTC position found in portfolio');
        return;
    }
    
    console.log('BTC Portfolio Summary:');
    console.log(`  Current Holdings: ${btcPosition.totalQuantity.toFixed(8)} BTC`);
    console.log(`  Total Cost Basis: ${btcPosition.totalCostBasis.toFixed(2)} NOK`);
    console.log(`  Average Cost per BTC: ${btcPosition.averageCostBasis.toFixed(2)} NOK`);
    console.log();
    console.log('2025 Activity:');
    console.log(`  Bought in 2025: ${btcPosition.quantityBought} BTC`);
    console.log(`  Sold in 2025: ${btcPosition.quantitySold} BTC`);
    console.log(`  Realized Gain/Loss: ${btcPosition.realizedGainLoss.toFixed(2)} NOK`);
    console.log(`  Buy Fees in 2025: ${btcPosition.totalBuyFees.toFixed(2)} NOK`);
    console.log(`  Sell Fees in 2025: ${btcPosition.totalSellFees.toFixed(2)} NOK`);
    
    // Show BTC sell events
    const btcSellEvents = taxReport.sellEvents?.filter(e => e.asset === 'BTC') || [];
    
    if (btcSellEvents.length > 0) {
        console.log(`\n=== BTC Sell Events in 2025 (${btcSellEvents.length}) ===\n`);
        
        btcSellEvents.forEach((event, i) => {
            console.log(`${i + 1}. Date: ${event.sellDate.toISOString().split('T')[0]}`);
            console.log(`   Sold: ${event.totalQuantity} BTC`);
            console.log(`   Proceeds: ${event.proceeds.toFixed(2)} ${event.currency}`);
            console.log(`   Cost Basis: ${event.totalCostBasis.toFixed(2)} ${event.currency}`);
            console.log(`   Buy Fees Allocated: ${event.totalBuyFees.toFixed(2)} ${event.currency}`);
            console.log(`   Sell Fee: ${event.sellFee.toFixed(2)} ${event.currency}`);
            console.log(`   Profit/Loss: ${event.profitLoss.toFixed(2)} ${event.currency}`);
            console.log(`   Matched against ${event.buyAllocations.length} buy(s):`);
            
            event.buyAllocations.forEach((alloc, j) => {
                const buyTx = transactions.find((t: Transaction) => t.id === alloc.buyTransactionId);
                if (buyTx) {
                    console.log(`     ${j + 1}) ${buyTx.dateTime.toISOString().split('T')[0]}: ${alloc.quantity} BTC (cost: ${alloc.costBasis.toFixed(2)} NOK)`);
                }
            });
            console.log();
        });
    }
    
    // Verify cost basis is reasonable
    console.log('\n=== Verification ===\n');
    
    const btcBuys = btcTransactions.filter(t => t.side === 'BUY');
    if (btcBuys.length > 0) {
        const minBuyPrice = Math.min(...btcBuys.map(t => t.getTaxPrice()));
        const maxBuyPrice = Math.max(...btcBuys.map(t => t.getTaxPrice()));
        
        console.log(`BTC buy price range: ${minBuyPrice.toLocaleString()} - ${maxBuyPrice.toLocaleString()} NOK`);
        console.log(`Average cost basis: ${btcPosition.averageCostBasis.toFixed(2)} NOK`);
        
        if (btcPosition.averageCostBasis >= minBuyPrice && btcPosition.averageCostBasis <= maxBuyPrice * 1.1) {
            console.log('✅ Cost basis is within reasonable range!');
        } else if (btcPosition.averageCostBasis < minBuyPrice) {
            console.log('❌ WARNING: Cost basis is below minimum buy price!');
        } else {
            console.log('⚠️  Cost basis is above maximum buy price (may include fees)');
        }
    }
}

testActualBTCData().catch(console.error);
