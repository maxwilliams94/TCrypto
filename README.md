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

### Export Endpoints

Export tax reports and portfolio data to CSV for easy analysis:

- `GET /export/transactions/csv` — Export all transactions (requires USE_FILE_STORAGE=true)
- `GET /export/tax-report/complete?start=YYYY-MM-DD&end=YYYY-MM-DD&currency=NOK` — Export complete tax report (4 CSV files)
- `GET /export/tax-report/sell-events?start=YYYY-MM-DD&end=YYYY-MM-DD` — Export sell events summary
- `GET /export/tax-report/portfolio?start=YYYY-MM-DD&end=YYYY-MM-DD` — Export portfolio positions

Example:
```bash
# Export complete 2024 tax report to CSV files
curl "http://localhost:3000/export/tax-report/complete?start=2024-01-01&end=2024-12-31"

# Export just sell events for Q1 2024
curl "http://localhost:3000/export/tax-report/sell-events?start=2024-01-01&end=2024-03-31" --output sell_events_q1.csv

# Export portfolio as of year-end
curl "http://localhost:3000/export/tax-report/portfolio?start=2024-01-01&end=2024-12-31" --output portfolio_2024.csv
```

#### CSV Export Files

When using `/export/tax-report/complete`, four CSV files are generated:

1. **tax_report_summary_{dates}.csv** — Overall metrics (profit/loss, fees, transaction counts)
2. **sell_events_{dates}.csv** — Summary of all sell events with 17 columns including:
   - Date, Asset, Quantity, Proceeds, Cost Basis
   - Sell Fee, Buy Fees, Net Profit/Loss
   - FIFO Matching: Buy Count, Buy IDs, Buy Dates
   - Currency information
3. **sell_event_allocations_{dates}.csv** — Detailed FIFO matching (one row per buy allocation)
   - Shows which specific buy lots matched each sell
   - Includes quantity used from each lot
   - Proportional cost basis and fees
4. **portfolio_{dates}.csv** — Current holdings per asset with 12 columns:
   - Quantity held, Cost basis, Average price
   - Realized and unrealized gains/losses
   - Period-specific activity (bought/sold)
   - Total fees, Open vs Closed positions

**Use cases:**
- Import into Excel/Google Sheets for analysis
- Sort by date, asset, profit/loss for insights
- Verify FIFO matching with allocation details
- Check portfolio positions and cost basis
- Share with accountant for tax filing

### Tax Report Features

The tax report endpoint provides detailed information for tax filing:

- **Proper fee handling**: Buy fees are included in cost basis, sell fees reduce profits
- **FIFO cost basis**: Sells are matched against oldest buys first
- **Detailed sell events**: Each sell includes complete audit trail of matched buys
- **Comprehensive summary**: Total profit/loss, fees breakdown, number of transactions

See [Tax Reporting Documentation](docs/TAX_REPORTING.md) for detailed examples and usage.

## CSV Import

Place CSV files in a directory and set `TRANSACTION_DIR` env var. 

### Required CSV Headers
Basic transaction headers:
`Id`, `Status`, `Market`, `FilledQuantity`, `FilledQuote`, `FilledPrice`, `Filled At`

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
Id,Status,Market,FilledQuantity,FilledQuote,FilledPrice,Filled At,Type,Validator,Epoch,RewardSource
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