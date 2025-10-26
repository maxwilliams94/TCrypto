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
- `TRANSACTION_DIR` — directory containing CSV files to import (default: current directory)
- `PORT` — server port (default: 3000)

## API Endpoints

- `GET /` — Transaction count
- `GET /transactions` — List all transactions
- `GET /transactions/:id` — Get transaction by index
- `GET /transactions/export/csv` — Export to CSV (file storage only)
- `GET /tax?start=YYYY-MM-DD&end=YYYY-MM-DD` — Generate tax report for date range

## CSV Import

Place CSV files in a directory and set `TRANSACTION_DIR` env var. Files must have headers:
`Id`, `Status`, `Market`, `FilledQuantity`, `FilledQuote`, `FilledPrice`, `Filled At`

Example:
```bash
TRANSACTION_DIR=./assets npm run dev
```

