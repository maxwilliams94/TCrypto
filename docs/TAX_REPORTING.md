# Enhanced Tax Reporting

## Overview

The enhanced tax reporting system provides detailed tracking of sell events with proper fee handling and FIFO (First-In-First-Out) cost basis matching. This ensures accurate profit/loss calculations for tax purposes.

## Key Features

### 1. Proper Fee Handling

**Buy Fees**: Fees paid when buying crypto are included in the cost basis when you sell.
- If you buy 1 BTC with a 1,000 NOK fee, the cost basis is increased by that fee
- When selling a portion (e.g., 0.8 BTC), the fee is proportionally allocated (800 NOK)
- This increases your cost basis and reduces your taxable profit

**Sell Fees**: Fees paid when selling are deducted from proceeds.
- Sell fees directly reduce your profit/loss for the tax year
- They are tracked separately in the tax report

### 2. FIFO Cost Basis Matching

Sell events are matched against buy transactions using FIFO (First-In-First-Out):
- The oldest buys are used first when calculating cost basis
- Each sell event tracks which specific buy transactions it matched against
- Provides a complete audit trail for tax authorities

### 3. Detailed Sell Event Tracking

Each sell event includes:
- **Sell details**: transaction ID, date, asset, quantity, price, fee
- **Buy allocations**: list of buy transactions matched (FIFO)
- **Cost basis**: total cost including proportional buy fees
- **Profit/Loss**: calculated as `proceeds - cost basis - sell fee`
- **Tax year**: year the sell occurred for tax reporting

## Data Models

### SellEvent

Represents a single sell transaction with complete tax details:

```typescript
class SellEvent {
  sellTransactionId: string;
  sellDate: Date;
  asset: string;
  exchange: string;
  currency: string;              // Currency for all monetary amounts (e.g., 'NOK')
  totalQuantity: number;
  sellPrice: number;             // In currency
  sellFee: number;               // In currency
  proceeds: number;              // In currency
  
  buyAllocations: BuyAllocation[];  // FIFO-matched buys
  
  totalCostBasis: number;        // Includes proportional buy fees, in currency
  totalBuyFees: number;          // Sum of buy fees, in currency
  profitLoss: number;            // proceeds - costBasis - sellFee, in currency
  
  taxYear: number;
}
```

### BuyAllocation

Links a sell event to its FIFO-matched buy transactions (references by ID):

```typescript
interface BuyAllocation {
  buyTransactionId: string;    // Reference to the buy transaction
  quantity: number;            // How much of this buy was used
  costBasis: number;          // Total cost for this allocation (includes proportional fee)
}
```

**Note**: Buy allocations only store the transaction ID and cost basis. To get full buy transaction details (date, price, etc.), look up the transaction by its ID.

### TaxReport

Enhanced with sell event tracking:

```typescript
class TaxReport {
  // ... existing fields ...
  
  sellEvents: SellEvent[];           // Detailed sell events
  totalBuyFeesIncluded: number;      // Buy fees included in cost basis
  totalSellFees: number;             // Sell fees deducted from profits
}
```

## Calculation Example

### Scenario

1. **Buy #1**: 1.0 BTC @ 400,000 NOK with 1,000 NOK fee
2. **Buy #2**: 0.5 BTC @ 450,000 NOK with 500 NOK fee
3. **Sell #1**: 0.8 BTC @ 500,000 NOK with 800 NOK fee
4. **Sell #2**: 0.5 BTC @ 480,000 NOK with 600 NOK fee

### Sell Event #1 (0.8 BTC)

**FIFO Matching**: Uses 0.8 BTC from Buy #1

**Calculation**:
```
Proceeds: 0.8 × 500,000 = 400,000 NOK

Cost Basis:
  - Purchase cost: 0.8 × 400,000 = 320,000 NOK
  - Buy fee (proportional): 0.8 × 1,000 = 800 NOK
  - Total cost basis: 320,800 NOK

Sell Fee: 800 NOK

Profit/Loss: 400,000 - 320,800 - 800 = 78,400 NOK
```

### Sell Event #2 (0.5 BTC)

**FIFO Matching**: 
- 0.2 BTC from Buy #1 (remaining)
- 0.3 BTC from Buy #2

**Calculation**:
```
Proceeds: 0.5 × 480,000 = 240,000 NOK

Cost Basis from Buy #1:
  - Purchase cost: 0.2 × 400,000 = 80,000 NOK
  - Buy fee (proportional): 0.2 × 1,000 = 200 NOK
  - Subtotal: 80,200 NOK

Cost Basis from Buy #2:
  - Purchase cost: 0.3 × 450,000 = 135,000 NOK
  - Buy fee (proportional): 0.3 × 500 = 300 NOK
  - Subtotal: 135,300 NOK

Total Cost Basis: 80,200 + 135,300 = 215,500 NOK

Sell Fee: 600 NOK

Profit/Loss: 240,000 - 215,500 - 600 = 23,900 NOK
```

### Total for Tax Year

```
Total Profit/Loss: 78,400 + 23,900 = 102,300 NOK
Total Buy Fees: 800 + 200 + 300 = 1,300 NOK (included in cost basis)
Total Sell Fees: 800 + 600 = 1,400 NOK (deducted from profits)
Total Fees: 1,300 + 1,400 = 2,700 NOK
```

## API Usage

### Generate Tax Report

```typescript
import { generateTaxReport } from './services/profitReporter';

const taxReport = await generateTaxReport(
  transactions,
  'NOK',                                    // Native currency
  new Date('2024-01-01'),                  // Period start
  new Date('2024-12-31'),                  // Period end
  'FIFO',                                   // Accounting method
  currencyRateStorage
);
```

### Access Sell Events

```typescript
// All sell events in the report
const sellEvents = taxReport.sellEvents;

// Filter by asset
const btcSells = taxReport.getSellEventsByAsset('BTC');

// Filter by year
const sells2024 = taxReport.getSellEventsByYear(2024);

// Access individual sell event details
sellEvents.forEach(sellEvent => {
  console.log(`Sold ${sellEvent.totalQuantity} ${sellEvent.asset}`);
  console.log(`Profit/Loss: ${sellEvent.profitLoss} ${sellEvent.currency}`);
  console.log(`Buy allocations: ${sellEvent.buyAllocations.length}`);
  
  // Audit trail: which buys were used (references by ID)
  sellEvent.buyAllocations.forEach(alloc => {
    console.log(`  - ${alloc.quantity} ${sellEvent.asset} from transaction ${alloc.buyTransactionId}`);
    console.log(`    Cost: ${alloc.costBasis} ${sellEvent.currency}`);
  });
});
```

### Get Tax Report JSON

The tax report includes a comprehensive summary:

```typescript
const reportJson = taxReport.toJSON();

// Returns:
{
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-12-31T23:59:59.999Z",
  "baseCurrency": "NOK",
  "accountingMethod": "FIFO",
  "buys": 2,
  "sells": 2,
  "profit": 102300,
  "fees": 2700,
  "totalBuyFeesIncluded": 1300,
  "totalSellFees": 1400,
  "sellEvents": [
    {
      "sellTransactionId": "sell-1",
      "sellDate": "2024-09-15T10:00:00.000Z",
      "asset": "BTC",
      "exchange": "Firi",
      "currency": "NOK",
      "totalQuantity": 0.8,
      "sellPrice": 500000,
      "sellFee": 800,
      "proceeds": 400000,
      "totalCostBasis": 320800,
      "totalBuyFees": 800,
      "profitLoss": 78400,
      "taxYear": 2024,
      "buyAllocations": [
        {
          "buyTransactionId": "buy-1",
          "quantity": 0.8,
          "costBasis": 320800
        }
      ]
    },
    // ... more sell events
  ],
  "summary": {
    "totalProfit": 102300,
    "totalFees": 2700,
    "totalBuyFees": 1300,
    "totalSellFees": 1400,
    "numberOfSells": 2
  }
}
```

## Tax Implications

### Cost Basis

Buy fees **increase** your cost basis:
- Higher cost basis = Lower profit = Lower taxes
- Proportionally allocated when selling partial positions
- Tracked per buy allocation for audit purposes

### Deductible Fees

Sell fees **reduce** your profit:
- Directly deducted from proceeds
- Fully deductible in the year of sale
- Separately tracked from buy fees

### FIFO Method

FIFO (First-In-First-Out) is used by default:
- Oldest purchases are sold first
- May result in higher/lower taxes depending on price movements
- Provides clear audit trail for tax authorities
- Required method in many jurisdictions (e.g., Norway)

### Reporting Requirements

The detailed sell events provide all information needed for tax reporting:
- **Date of acquisition** (from buyAllocations)
- **Date of disposal** (sellDate)
- **Purchase price** (from buyAllocations.costBasis)
- **Sale price** (proceeds)
- **Fees** (totalBuyFees + sellFee)
- **Profit/Loss** (profitLoss)

## Example Use Cases

### Generate Year-End Tax Report

```typescript
const report2024 = await generateTaxReport(
  allTransactions,
  'NOK',
  new Date('2024-01-01'),
  new Date('2024-12-31'),
  'FIFO',
  currencyRateStorage
);

console.log(`Tax Year 2024:`);
console.log(`Total Profit: ${report2024.profit} NOK`);
console.log(`Total Fees: ${report2024.fees} NOK`);
console.log(`Sell Events: ${report2024.sellEvents?.length || 0}`);
```

### Export for Tax Software

```typescript
// Create CSV export for tax software
const csvRows = report.sellEvents?.map(se => ({
  Date: se.sellDate.toISOString().split('T')[0],
  Asset: se.asset,
  Quantity: se.totalQuantity,
  Proceeds: se.proceeds,
  CostBasis: se.totalCostBasis,
  SellFee: se.sellFee,
  BuyFees: se.totalBuyFees,
  ProfitLoss: se.profitLoss
}));
```

### Audit Trail

```typescript
// Show complete audit trail for a specific sell
const sellEvent = report.sellEvents?.[0];
console.log(`\nAudit Trail for ${sellEvent.sellTransactionId}:`);
console.log(`Sold on: ${sellEvent.sellDate}`);
console.log(`Asset: ${sellEvent.asset}`);
console.log(`Currency: ${sellEvent.currency}`);
console.log(`\nMatched against the following purchases (FIFO):`);

sellEvent.buyAllocations.forEach((alloc, i) => {
  console.log(`\n${i + 1}. Purchase ${alloc.buyTransactionId}`);
  console.log(`   Quantity: ${alloc.quantity} ${sellEvent.asset}`);
  console.log(`   Total cost: ${alloc.costBasis} ${sellEvent.currency} (includes proportional buy fee)`);
  
  // To get full buy transaction details, look up by ID:
  // const buyTransaction = allTransactions.find(t => t.id === alloc.buyTransactionId);
});
```

## Future Enhancements

Potential improvements to the tax reporting system:

1. **Alternative accounting methods**: Add LIFO, specific identification
2. **Long-term vs short-term gains**: Track holding period
3. **Wash sale rules**: Detect and handle wash sales
4. **Multi-currency support**: Handle sales in different currencies
5. **PDF report generation**: Create printable tax reports
6. **Tax form auto-fill**: Generate pre-filled tax forms

## See Also

- [Transaction Model](../src/models/transaction.ts) - Core transaction structure
- [Profit Reporter](../src/services/profitReporter.ts) - Tax calculation logic
- [Example Script](../examples/enhanced-tax-report.ts) - Working example
