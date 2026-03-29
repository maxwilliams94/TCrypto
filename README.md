# TCrypto
Accounting for crypto transactions

## Quick Start

```bash
# Install dependencies
npm install

# Development with in-memory storage (default)
npm run dev

# Development with file-based persistence
USE_FILE_STORAGE=true npm run dev

# Build for production
npm run build

# Run production server
npm start
```

## Storage Options

TCrypto supports two storage backends:

### In-Memory (Default)
Fast, volatile storage — data is lost on restart. Good for development and testing.

```bash
npm run dev
```

### File-Based Persistence
Persists transactions to JSON on disk. Data survives restarts.

```bash
USE_FILE_STORAGE=true npm run dev
```

**Environment Variables:**
- `USE_FILE_STORAGE=true` — enable file-based storage
- `DATA_FILE_PATH` — path to JSON file (default: `./data/transactions.json`)
- `CURRENCY_RATES_FILE_PATH` — path to currency rates cache file (default: `./data/currency-rates.json`)
- `TAX_HISTORY_FILE_PATH` — path to finalized tax report history (default: `./data/tax_history.json`)
- `TRANSACTION_DIR` — directory containing CSV files to import (default: current directory)
- `PORT` — server port (default: 3000)
- `COINGECKO_API_KEY` — CoinGecko API key (required for crypto price fetching - get free Demo key at https://www.coingecko.com/en/api/pricing)

## CoinGecko API Integration

TCrypto fetches historical cryptocurrency prices from CoinGecko for accurate tax reporting. 

### API Key Setup (Required)
**CoinGecko now requires API keys for all requests.** Get a free Demo account at [CoinGecko API Pricing](https://www.coingecko.com/en/api/pricing):

**Free Demo Plan includes:**
- 10,000 API calls per month (≈333 calls/day)
- 30 calls per minute rate limit  
- 1 year of historical data
- 50+ market data endpoints

```bash
# Set your API key (required)
COINGECKO_API_KEY=your_demo_api_key_here npm run dev
```

**Without an API key, cryptocurrency price fetching will fail.**

### CoinGecko Plan Comparison
| Plan | Price | Calls/Month | Rate Limit | Historical Data |
|------|-------|-------------|-------------|----------------|
| **Demo** | Free | 10,000 | 30/min | 1 year |
| **Analyst** | $129/mo | 500,000 | 500/min | 10+ years |
| **Lite** | $499/mo | 2,000,000 | 500/min | 10+ years |

*Demo plan is sufficient for small-scale personal crypto accounting.*

## API Endpoints

- `GET /` — Transaction count
- `GET /transactions` — List all transactions with optional filtering
  - `?type=STAKING_REWARD` — filter by transaction type
  - `?asset=ETH` — filter by asset
  - `?startDate=2024-01-01&endDate=2024-12-31` — filter by date range
- `POST /transactions` — Add new transaction (including staking rewards)
- `GET /transactions/:id` — Get transaction by index
- `GET /transactions/export/csv` — Export to CSV (file storage only)
- `GET /tax?start=YYYY-MM-DD&end=YYYY-MM-DD` — Generate tax report for date range
- `GET /tax/history` — List finalized tax periods and accounting methods from `tax_history.json`
- `GET /tax/lot-allocations` — Inspect persisted lot allocations by tax year and detect mixed-method conflicts
- `DELETE /tax/lot-allocations?taxYear=YYYY&dryRun=true` — Preview cleanup of persisted lot allocations for a tax year
- `DELETE /tax/lot-allocations?taxYear=YYYY&dryRun=false&confirm=true` — Remove persisted lot allocations and tax history for a tax year

### Export Endpoints

Export transactions, tax reports, and portfolio data to CSV for easy analysis:

#### Transaction Exports
- `GET /export/transactions/csv` — Export all transactions to CSV (requires USE_FILE_STORAGE=true)

#### Tax Report Exports
- `GET /export/tax-report/complete?start=YYYY-MM-DD&end=YYYY-MM-DD&currency=NOK` — Export complete tax report (5 CSV files)
- `GET /export/tax-report/sell-events?start=YYYY-MM-DD&end=YYYY-MM-DD` — Export sell events summary
- `GET /export/tax-report/portfolio?start=YYYY-MM-DD&end=YYYY-MM-DD` — Export portfolio for tax period

#### Portfolio Snapshot Exports
- `GET /export/portfolio/csv?date=YYYY-MM-DD&currency=NOK` — Export portfolio snapshot as of specific date
- `GET /portfolio?date=YYYY-MM-DD` — Get portfolio snapshot (JSON response)

**Examples:**
```bash
# Export all transactions
curl "http://localhost:3000/export/transactions/csv" --output transactions.csv

# Export complete 2024 tax report to CSV files
curl "http://localhost:3000/export/tax-report/complete?start=2024-01-01&end=2024-12-31"

# Export just sell events for Q1 2024
curl "http://localhost:3000/export/tax-report/sell-events?start=2024-01-01&end=2024-03-31" --output sell_events_q1.csv

# Export portfolio as of year-end (CSV)
curl "http://localhost:3000/export/portfolio/csv?date=2024-12-31" --output portfolio_2024.csv

# Get current portfolio snapshot (JSON)
curl "http://localhost:3000/portfolio"

# Get portfolio as of specific date (JSON)
curl "http://localhost:3000/portfolio?date=2024-12-31"
```

#### CSV Export Files

When using `/export/tax-report/complete`, five CSV files are generated:

1. **tax_report_summary_{dates}.csv** — Overall metrics (profit/loss, fees, transaction counts)
2. **sell_events_{dates}.csv** — Summary of all sell events with 17 columns including:
   - Date, Asset, Quantity, Proceeds, Cost Basis
   - Sell Fee, Buy Fees, Net Profit/Loss
  - Lot matching: Buy Count, Buy IDs, Buy Dates
   - Currency information
3. **sell_event_allocations_{dates}.csv** — Detailed lot allocations (one row per buy allocation)
   - Shows which specific buy lots matched each sell
   - Includes quantity used from each lot
   - Proportional cost basis and fees
4. **transactions_{dates}.csv** — Transactions included in the tax calculation, including derived accounting legs
5. **portfolio_{dates}.csv** — Current holdings per asset with 12 columns:
   - Quantity held, Cost basis, Average price
   - Realized and unrealized gains/losses
   - Period-specific activity (bought/sold)
   - Total fees, Open vs Closed positions

**Use cases:**
- Import into Excel/Google Sheets for analysis
- Sort by date, asset, profit/loss for insights
- Verify lot matching with allocation details
- Check portfolio positions and cost basis
- Share with accountant for tax filing

### Tax Report Features

The tax report endpoint provides detailed information for tax filing:

- **Proper fee handling**: Buy fees are included in cost basis, sell fees reduce profits
- **Withdrawal fee deductions**: Withdrawal fees are tracked as separate deductible expenses
- **Multiple accounting methods**: Choose between FIFO and LIFO cost basis calculations
- **Detailed sell events**: Each sell includes complete audit trail of matched buys
- **Comprehensive summary**: Total profit/loss, fees breakdown, number of transactions
- **Net taxable profit**: Automatically calculates `totalProfit - deductibleFees` for tax reporting

#### Accounting Methods

TCrypto supports multiple tax accounting methods for cost basis calculation. Norwegian tax rules allow you to choose which lots to sell for virtual currencies.

**Available Methods:**

1. **FIFO (First In, First Out)** - Default
   - Sells consume oldest buy lots first
   - Chronological order: first buy matched to first sell
   - Generally results in higher capital gains in inflationary markets
   - Most conservative approach
   
2. **LIFO (Last In, First Out)** - Alternative
   - Sells consume newest buy lots first
   - Reverse chronological order: last buy matched to first sell
   - Can result in lower capital gains in inflationary markets
   - Useful for tax optimization in specific scenarios

**Recommended Workflow**

##### 1. Generate Draft JSON Reports First

Use `GET /tax` to compare methods before you lock anything in:

```bash
# Draft report using the default FIFO method
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31"

# Draft report using FIFO explicitly
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31&method=FIFO"

# Draft report using LIFO
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31&method=LIFO"
```

Draft reports do not persist anything. They are safe to run repeatedly while you compare:
- `profit`
- `deductibleFees`
- `summary.netTaxableProfit`
- `sellEvents`
- `accountingMethod`

Draft responses include `isFinalised: false`.

##### 2. Finalize the Exact Tax Period Once

When you are satisfied with the draft, finalize the exact tax period you want to lock:

```bash
# Finalize the full 2024 tax year with FIFO
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31&method=FIFO&finalise=true"

# Finalize the full 2024 tax year with LIFO
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31&method=LIFO&finalise=true"
```

When `finalise=true`:
- Lot consumption is persisted back to the buy transactions
- A full finalized report snapshot is written to `data/tax_history.json`
- The exact `start`, `end`, `accountingMethod`, and tax currency are recorded
- The response includes `isFinalised: true`

##### 3. Reuse the Finalized Result

After a period has been finalized, the exact same tax period is treated as locked.

For the same `start` and `end` values, these endpoints will reuse the stored computed report instead of recalculating lot matching:
- `GET /tax`
- `GET /export/tax-report/complete`
- `GET /export/tax-report/sell-events`
- `GET /export/tax-report/portfolio`

Safest usage after finalization:

```bash
# Reuse the stored finalized JSON report
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31"

# Reuse the stored finalized full CSV export bundle
curl "http://localhost:3000/export/tax-report/complete?start=2024-01-01&end=2024-12-31&currency=NOK"

# Inspect finalized periods and methods
curl "http://localhost:3000/tax/history"
```

You may also pass the same method explicitly:

```bash
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31&method=LIFO"
```

If you try to use a different method or a different tax currency for an already-finalized period, the API returns an error instead of silently recalculating.

##### 4. Exporting After Finalization

The usual export flow is:

```bash
# Step 1: review the JSON draft
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31&method=LIFO"

# Step 2: finalize once
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31&method=LIFO&finalise=true"

# Step 3: generate CSV exports from the stored finalized report
curl "http://localhost:3000/export/tax-report/complete?start=2024-01-01&end=2024-12-31&currency=NOK"
curl "http://localhost:3000/export/tax-report/sell-events?start=2024-01-01&end=2024-12-31&currency=NOK"
curl "http://localhost:3000/export/tax-report/portfolio?start=2024-01-01&end=2024-12-31&currency=NOK"
```

This avoids inadvertently reapplying a different accounting method for that finalized period.

##### Notes About `tax_history.json`

`data/tax_history.json` is the reference file for finalized tax periods. Each finalized entry records:
- `startDate`
- `endDate`
- `accountingMethod`
- `finalisedAt`
- the stored finalized tax report snapshot

If you already have legacy transaction data with persisted lot allocations from multiple methods and no clean finalized history, the API will reject new finalization attempts for that year until the conflicting stored lot allocations are cleaned up.

##### Inspecting and Cleaning Legacy Lot Allocations

If an older `transactions.json` already contains persisted lot allocations from multiple accounting methods for the same tax year, inspect that first:

```bash
curl "http://localhost:3000/tax/lot-allocations"
```

The response groups persisted allocations by `taxYear` and shows:
- `strategies`
- `allocationCount`
- `affectedTransactionCount`
- `conflict`
- `finalisedHistory`

To preview the cleanup impact for a single tax year:

```bash
curl -X DELETE "http://localhost:3000/tax/lot-allocations?taxYear=2024&dryRun=true"
```

To apply the cleanup after reviewing the dry run:

```bash
curl -X DELETE "http://localhost:3000/tax/lot-allocations?taxYear=2024&dryRun=false&confirm=true"
```

Applying cleanup will:
- remove persisted lot allocations for that `taxYear` from `transactions.json`
- remove matching finalized entries for that `taxYear` from `tax_history.json`
- let you regenerate a fresh draft report and finalize it again cleanly

Recommended order:

```bash
# 1. Inspect conflicts
curl "http://localhost:3000/tax/lot-allocations"

# 2. Dry run cleanup for the affected year
curl -X DELETE "http://localhost:3000/tax/lot-allocations?taxYear=2024&dryRun=true"

# 3. Apply cleanup
curl -X DELETE "http://localhost:3000/tax/lot-allocations?taxYear=2024&dryRun=false&confirm=true"

# 4. Generate a fresh draft report
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31&method=LIFO"

# 5. Finalize again once satisfied
curl "http://localhost:3000/tax?start=2024-01-01&end=2024-12-31&method=LIFO&finalise=true"
```

#### Withdrawal Fee Tracking

**WITHDRAW and DEPOSIT transactions are now tracked** for complete tax reporting:

- **WITHDRAW transactions**: Don't create taxable events, but fees are captured as **tax-deductible expenses**
- **DEPOSIT transactions**: No taxable event, typically no fees
- **Fee deduction**: Withdrawal fees reduce your net taxable profit
- **Currency conversion**: Fees are converted to your native currency using historical exchange rates

**Tax Report includes:**
```json
{
  "summary": {
    "totalProfit": 50000,        // Capital gains from sales
    "deductibleFees": 1200,      // Withdrawal fees (tax-deductible)
    "netTaxableProfit": 48800,   // totalProfit - deductibleFees
    "totalBuyFees": 500,         // Already in cost basis
    "totalSellFees": 300         // Already deducted from proceeds
  },
  "withdrawalEvents": [
    {
      "transactionId": "abc-123",
      "asset": "BTC",
      "quantity": 0.5,
      "fee": 0.0001,
      "feeInTaxCurrency": 50,
      "withdrawalDate": "2024-06-15T10:30:00Z"
    }
  ]
}
```

**CSV Format for Withdrawals:**
```csv
Id,ExchangeId,Status,Side,Market,TransactionType,Fee,FilledQuantity,FilledQuote,FilledPrice,Timestamp
w-123,w-123,COMPLETED,,BTC-NOK,WITHDRAWAL,0.0001,0.5,0,0,2024-06-15T10:30:00Z
```

For detailed documentation on withdrawal fee tracking, see [Withdrawal Fee Tracking](docs/withdrawal-fee-tracking.md).

See [Tax Reporting Documentation](docs/TAX_REPORTING.md) for detailed examples and usage.

## CSV Import

Place CSV files in a directory and set `TRANSACTION_DIR` env var. 

### Required CSV Headers
Basic transaction headers:
`Id`, `Status`, `Market`, `FilledQuantity`, `FilledQuote`, `FilledPrice`, `Timestamp`

### Optional CSV Headers (for staking rewards)
Additional headers for reward transactions:
`Type`, `Validator`, `Epoch`, `RewardSource`

**Price Lookup**: If `FilledPrice` is missing or zero for **reward transactions** (staking rewards, airdrops, etc.), the system will automatically look up historical prices from CoinGecko. Regular trades should already have prices from exchange data.

Example:
```bash
TRANSACTION_DIR=./assets npm run dev
```

### CSV Example for Staking Rewards
```csv
Id,Status,Market,FilledQuantity,FilledQuote,FilledPrice,Timestamp,Type,Validator,Epoch,RewardSource
reward-1,filled,ADA-NOK,5.5,,0,2024-01-15T10:00:00Z,STAKING_REWARD,ADAVERSE,452,cardano
reward-2,filled,ETH-NOK,0.1,,0,2024-01-16T12:00:00Z,STAKING_REWARD,lido-validator,825432,ethereum
```
*Note: Empty `FilledQuote` and zero `FilledPrice` will trigger automatic price lookup.*

## Staking Rewards

Create staking rewards through the transactions API:

```bash
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "baseCurrency": "ADA",
    "quoteCurrency": "NOK", 
    "exchange": "cardano-staking",
    "side": "BUY",
    "baseSize": "5.5",
    "price": "8.5",
    "fee": "0",
    "dateTime": "2024-01-15T00:00:00.000Z",
    "type": "STAKING_REWARD",
    "validator": "ADAVERSE",
    "epoch": 452,
    "rewardSource": "cardano"
  }'
```

# Norwegian Tax Rules
https://www.skatteetaten.no/en/person/taxes/get-the-taxes-right/shares-and-securities/about-shares-and-securities/digital-currency/selling/