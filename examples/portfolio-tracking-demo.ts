/**
 * Portfolio tracking demonstration
 * 
 * Shows how the portfolio tracks:
 * - Current holdings for each asset
 * - Realized gains/losses from sells
 * - Unrealized gains/losses (if current prices provided)
 * - Complete activity summary per asset
 */

import { Transaction } from '../src/models/transaction';
import { generateTaxReport } from '../src/services/profitReporter';
import { CurrencyRateMemoryRepository } from '../src/repositories/currencyRateMemory';

async function demonstratePortfolioTracking() {
    console.log('=== Portfolio Tracking Demo ===\n');

    const currencyRateRepo = new CurrencyRateMemoryRepository();

    const transactions: Transaction[] = [
        // BTC purchases
        new Transaction('btc-buy-1', 'BTC', 'NOK', 'Exchange', 'BUY', 0.5, 200000, 400000, 500, new Date('2024-01-15'), 'TRADE'),
        new Transaction('btc-buy-2', 'BTC', 'NOK', 'Exchange', 'BUY', 0.3, 150000, 500000, 300, new Date('2024-03-15'), 'TRADE'),
        
        // ETH purchases
        new Transaction('eth-buy-1', 'ETH', 'NOK', 'Exchange', 'BUY', 2.0, 80000, 40000, 400, new Date('2024-02-01'), 'TRADE'),
        new Transaction('eth-buy-2', 'ETH', 'NOK', 'Exchange', 'BUY', 1.5, 75000, 50000, 300, new Date('2024-04-01'), 'TRADE'),
        
        // ADA purchases
        new Transaction('ada-buy-1', 'ADA', 'NOK', 'Exchange', 'BUY', 1000, 10000, 10, 50, new Date('2024-01-10'), 'TRADE'),
        
        // BTC sells - partial position
        new Transaction('btc-sell-1', 'BTC', 'NOK', 'Exchange', 'SELL', 0.4, 240000, 600000, 600, new Date('2024-06-15'), 'TRADE'),
        
        // ETH sells - close entire position
        new Transaction('eth-sell-1', 'ETH', 'NOK', 'Exchange', 'SELL', 3.5, 210000, 60000, 700, new Date('2024-08-01'), 'TRADE'),
        
        // ADA - no sells, position remains open
    ];

    // Set tax conversions
    transactions.forEach(t => t.setTaxConversion('NOK', 1.0, t.dateTime));

    console.log('=== Transaction Timeline ===\n');
    
    const buys = transactions.filter(t => t.side === 'BUY');
    const sells = transactions.filter(t => t.side === 'SELL');
    
    console.log('BUYS:');
    buys.forEach(t => {
        console.log(`  ${t.dateTime.toISOString().split('T')[0]} - ${t.baseSize.toString().padStart(8)} ${t.baseCurrency} @ ${t.price.toLocaleString().padStart(10)} NOK (fee: ${t.fee} NOK)`);
    });
    
    console.log('\nSELLS:');
    sells.forEach(t => {
        console.log(`  ${t.dateTime.toISOString().split('T')[0]} - ${t.baseSize.toString().padStart(8)} ${t.baseCurrency} @ ${t.price.toLocaleString().padStart(10)} NOK (fee: ${t.fee} NOK)`);
    });

    // Generate tax report
    const taxReport = await generateTaxReport(
        transactions,
        'NOK',
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        'FIFO',
        currencyRateRepo
    );

    console.log('\n=== Tax Report Summary ===');
    console.log(`Period: ${taxReport.startDate.toISOString().split('T')[0]} to ${taxReport.endDate.toISOString().split('T')[0]}`);
    console.log(`Buys: ${taxReport.buys}, Sells: ${taxReport.sells}`);
    console.log(`Total Profit/Loss: ${taxReport.profit?.toFixed(2)} NOK`);
    console.log(`Total Fees: ${taxReport.fees?.toFixed(2)} NOK`);

    console.log('\n=== Portfolio Overview ===');
    const portfolio = taxReport.portfolio!;
    console.log(`Currency: ${portfolio.currency}`);
    console.log(`Total Cost Basis of Holdings: ${portfolio.getTotalCostBasis().toFixed(2)} NOK`);
    console.log(`Total Realized Gain/Loss: ${portfolio.getTotalRealizedGainLoss().toFixed(2)} NOK`);
    console.log(`Number of Open Positions: ${portfolio.getAllPositions(false).length}`);
    console.log(`Number of Closed Positions: ${portfolio.getAllPositions(true).length - portfolio.getAllPositions(false).length}`);

    console.log('\n=== Detailed Asset Breakdown ===');
    
    const allPositions = portfolio.getAllPositions(true).sort((a, b) => a.asset.localeCompare(b.asset));
    
    allPositions.forEach(position => {
        console.log(`\n┌─ ${position.asset} ${'─'.repeat(50)}`);
        
        if (position.isClosed()) {
            console.log('│ Status: ✓ POSITION CLOSED');
        } else {
            console.log(`│ Status: ○ POSITION OPEN`);
            console.log('│');
            console.log('│ Current Holdings:');
            console.log(`│   Quantity: ${position.totalQuantity.toFixed(8)} ${position.asset}`);
            console.log(`│   Average Cost Basis: ${position.averageCostBasis.toFixed(2)} NOK per unit`);
            console.log(`│   Total Invested: ${position.totalCostBasis.toFixed(2)} NOK`);
        }
        
        console.log('│');
        console.log('│ Period Activity:');
        console.log(`│   Bought: ${position.quantityBought.toFixed(8)} ${position.asset}`);
        console.log(`│   Sold: ${position.quantitySold.toFixed(8)} ${position.asset}`);
        
        console.log('│');
        console.log('│ Financial Summary:');
        console.log(`│   Realized Gain/Loss: ${position.realizedGainLoss >= 0 ? '+' : ''}${position.realizedGainLoss.toFixed(2)} NOK`);
        console.log(`│   Buy Fees Paid: ${position.totalBuyFees.toFixed(2)} NOK`);
        console.log(`│   Sell Fees Paid: ${position.totalSellFees.toFixed(2)} NOK`);
        console.log(`│   Total Fees: ${(position.totalBuyFees + position.totalSellFees).toFixed(2)} NOK`);
        
        console.log('└' + '─'.repeat(58));
    });

    console.log('\n=== Summary by Asset Type ===');
    console.log('\nOpen Positions (Still Holding):');
    portfolio.getAllPositions(false).forEach(pos => {
        console.log(`  ${pos.asset.padEnd(6)} - ${pos.totalQuantity.toFixed(8)} units @ ${pos.averageCostBasis.toFixed(2)} NOK avg cost`);
    });
    
    console.log('\nClosed Positions (Fully Sold):');
    const closedPositions = portfolio.getAllPositions(true).filter(p => p.isClosed());
    if (closedPositions.length > 0) {
        closedPositions.forEach(pos => {
            const profitStatus = pos.realizedGainLoss >= 0 ? 'profit' : 'loss';
            console.log(`  ${pos.asset.padEnd(6)} - ${profitStatus}: ${Math.abs(pos.realizedGainLoss).toFixed(2)} NOK`);
        });
    } else {
        console.log('  (none)');
    }

    console.log('\n=== Key Metrics ===');
    console.log(`Total Capital Gains (Realized): ${portfolio.getTotalRealizedGainLoss().toFixed(2)} NOK`);
    console.log(`Total Still Invested: ${portfolio.getTotalCostBasis().toFixed(2)} NOK`);
    console.log(`Total Assets Traded: ${portfolio.getAllPositions(true).length}`);
    console.log(`Total Transactions: ${transactions.length} (${buys.length} buys, ${sells.length} sells)`);
}

demonstratePortfolioTracking().catch(console.error);
