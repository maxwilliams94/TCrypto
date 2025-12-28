## Project overview

TCrypto is a TypeScript/Node service for importing, normalising and reporting on crypto transactions with comprehensive support for different transaction types including staking rewards (CSV import -> repository -> tax/profit reporting endpoints).

Key directories/files to read first:
- `src/models/transaction.ts` — Enhanced Transaction model with TransactionType enum supporting 'TRADE', 'STAKING_REWARD', 'LENDING_REWARD', 'AIRDROP', 'MINING_REWARD', 'FORK', 'INTERNAL_TRANSFER', 'WITHDRAW', 'DEPOSIT'. Contains reward-specific fields (validator, epoch, rewardSource).
- `src/services/transactionImporter.ts` — CSV parsing, strict header validation, and the import flow that may split crypto/crypto trades into two native-currency transactions. Now imports WITHDRAW/DEPOSIT transactions for fee tracking.
- `src/services/exchangeRateService.ts` — Enhanced with CoinGecko API integration for crypto price fetching alongside Norges Bank FX rates. Supports historical crypto prices and batch operations.
- `src/repositories/storage.ts` — `TransactionStorage` interface; implement this to add persistent storage.
- `src/repositories/file.ts` — file-based JSON persistence (enable with `USE_FILE_STORAGE=true`).
- `src/services/profitReporter.ts` — tax/profit calculation (FIFO style) that correctly handles reward transactions as BUY transactions and tracks withdrawal fees as deductible expenses.

## Big-picture architecture and dataflow
- **Transaction-centric design**: All crypto activities (trades, staking rewards, airdrops, withdrawals, deposits) are unified as `Transaction` objects with different `type` values.
- CSV files are read by `importInitialTransactions()` in `transactionImporter.ts` (env var `TRANSACTION_DIR` or cwd). Each CSV row becomes a `Transaction` with appropriate type.
- **Import process**: loads existing transactions from storage first, then processes CSVs and skips duplicates by transaction ID.
- Crypto/crypto trades are transformed by `splitCryptoCryptoTransaction()` into two transactions: a SELL for the quote currency into the native currency (default NOK) and a BUY of the base currency priced in the native currency.
- **Dual exchange rate system**: 
  - Norges Bank API for fiat currencies via `ExchangeRateService.getCcyNokRate(currency, date)`
  - CoinGecko API for crypto prices via `ExchangeRateService.getCryptoPriceInCurrency(crypto, currency, date)`
  - Both systems cache values with persistent storage support
- **Reward transactions**: Created as BUY transactions with reward-specific metadata (validator, epoch, rewardSource). Tax reporting treats rewards as taxable income events.
- **Withdrawal/Deposit transactions**: WITHDRAW and DEPOSIT transactions are imported but don't affect FIFO buy/sell matching. Withdrawal fees are tracked as tax-deductible expenses that reduce net taxable profit.
- Transactions are stored via the `TransactionStorage` interface with repository pattern. Server exposes unified `/transactions` endpoint with filtering by type, asset, date range.

## Developer workflows (how to run/build/debug)
- Install deps: `npm install` (standard).
- Development server (fast iteration): `npm run dev` — uses `nodemon` + `ts-node` and watches `src/**/*.ts`.
- Build: `npm run build` (runs `npx tsc` and outputs to `dist/`).
- Run production bundle: `npm run start` (runs `node dist/index.js`).
- Environment variables used:
  - `PORT` — server port (default 3000).
  - `TRANSACTION_DIR` — folder containing CSV files to import (defaults to process.cwd()).
  - `USE_FILE_STORAGE` — set to `'true'` to use file-based persistence instead of in-memory (default: false).
  - `DATA_FILE_PATH` — path to JSON storage file (default: `./data/transactions.json`).
  - `CURRENCY_RATES_FILE_PATH` — path to currency rates cache file (default: `./data/currency-rates.json`).

Example: to run dev with CSVs in `assets/` and file-based storage:
```
TRANSACTION_DIR=assets USE_FILE_STORAGE=true npm run dev
```

## Codebase conventions and notable patterns
- CSV parsing in `loadTransactionData()` expects headers exactly: `Id`, `Status`, `Market`, `FilledQuantity`, `FilledQuote`, `FilledPrice`, `Timestamp`. If a header is missing the importer rejects the file.
- Markets are parsed via `row.Market.split('-')` and trimmed; the file must use `BASE-QUOTE` format.
- When a transaction is crypto/crypto (neither side is considered fiat by `isFiat()`), it's split into two transactions. The split uses `ExchangeRateService` to convert the quote to `NOK` (native currency by default).
- The `TransactionStorage` interface is used everywhere; the app ships with two implementations:
  - `MemoryRepository` (default) — singleton, data lost on restart.
  - `FileRepository` (opt-in via `USE_FILE_STORAGE=true`) — persists to JSON, auto-loads on startup, includes CSV export at `GET /transactions/export/csv`.
- Storage selection happens in `src/index.ts` at startup; the chosen repository is exported and imported by routes.
- **Transaction filtering**: Use query params on `/transactions` endpoint: `?type=STAKING_REWARD&asset=ETH&startDate=2024-01-01&endDate=2024-12-31`.

## Integration points & external dependencies
- External HTTP calls:
  - `src/services/exchangeRateService.ts` calls Norges Bank API (`data.norges-bank.no`). The service caches responses in-memory.
  - CoinGecko API (`api.coingecko.com/api/v3`) for crypto price data with comprehensive symbol mapping and rate limiting.
- CSV input files: any change to header names or date formats requires updates to `loadTransactionData()`.

## Practical examples for an AI agent
- To add persistent storage: implement `TransactionStorage` and return your implementation from a factory in place of `createTransactionRespository()` (see `src/repositories/memory.ts`).
- To change native currency handling: update `importInitialTransactions()` call in `src/index.ts` and the `splitCryptoCryptoTransaction()` usage; note the importer currently calls `loadTransactionData(filePath, 'NOK')`.
- To debug FX caching issues: inspect `ExchangeRateService.getCcyNokRate()` — cache keys are `${currency}-${date}` (the `date` object is stringified), and `getLatestWorkingDay(date)` mutates the passed Date object.
- **Adding staking rewards**: Use `POST /transactions` with `type: 'STAKING_REWARD'`, `side: 'BUY'`, and include optional `validator`, `epoch`, `rewardSource` fields.
- **Querying rewards**: Use `GET /transactions?type=STAKING_REWARD` to filter for reward transactions only.

## Quick gotchas worth knowing
- `package.json` scripts:
  - `dev` uses `ts-node` (runtime TS) — faster for iterative debugging.
  - `build` uses `npx tsc` and `start` expects compiled `dist/index.js`.
- Date handling: CSV `Timestamp` is parsed with `new Date(...)`. Timezone differences may affect lookup of exchange rates.
- Exchange rate cache key uses the Date object stringification; expect cache misses if dates are mutated or not normalised to YYYY-MM-DD.
- There are no unit tests in the repo. Adding unit tests should target `loadTransactionData`, `splitCryptoCryptoTransaction`, `ExchangeRateService` (mock HTTP) and `generateTaxReport` logic.

## Recent architectural decisions (important context)
**Why transaction-based rewards over separate staking entities:**
- Initial implementation had separate `StakingReward` models and dedicated `/staking-rewards` endpoints, but this created architectural complexity.
- **Current approach**: Staking rewards are simply `Transaction` objects with `type: 'STAKING_REWARD'`. This ensures unified tax reporting, consistent storage patterns, and simpler API surface.
- **Result**: All crypto activities (trades, rewards, airdrops) flow through the same transaction processing pipeline. Use `/transactions?type=STAKING_REWARD` instead of separate reward endpoints.
- **Tax implications**: Reward transactions are treated as BUY transactions by `profitReporter.ts`, making them taxable income events at market value when received.

## Future architecture: backend + front-end design
The current architecture is designed for backend expansion with a future front-end. Key considerations:

**Current state:**
- Routes (`src/routes/*`) expose JSON APIs but lack CORS, input validation, and comprehensive error handling.
- Repository pattern (`TransactionStorage`) is front-end ready but uses a singleton in-memory store — multiple users would share state.
- No authentication/authorization layer exists.

**To prepare for front-end integration:**
1. **Add CORS middleware** — `npm install cors @types/cors`, then add `app.use(cors())` in `src/index.ts` before routes.
2. **Input validation** — use `express-validator` or `zod` to validate query params (`start`, `end` in `/tax`, `id` in `/transactions/:id`).
3. **Error handling middleware** — add a global error handler after routes to return consistent JSON error shapes.
4. **Pagination** — `/transactions` currently returns all transactions; add `?limit=100&offset=0` support before the dataset grows.
5. **Persistent storage** — swap `MemoryRepository` for a DB implementation (PostgreSQL, SQLite) by implementing `TransactionStorage`. Update `src/index.ts` to inject the new repository.
6. **Authentication** — add JWT or session-based auth before exposing to a front-end; protect routes with middleware.
7. **OpenAPI/Swagger docs** — use `swagger-jsdoc` + `swagger-ui-express` to auto-generate API docs for front-end devs.

**API design patterns to adopt:**
- Use proper HTTP status codes (201 for created, 400 for bad input, 401/403 for auth, 500 for server errors).
- Return consistent error shapes: `{ error: string, code: string, details?: any }`.
- Support `Accept: application/json` and `Content-Type: application/json` headers explicitly.
- Add `GET /health` and `GET /version` endpoints for monitoring.

**Separation of concerns:**
- Move business logic out of route handlers into service classes (similar to `profitReporter.ts`).
- Keep routes thin — they should only handle HTTP concerns (parsing, validation, response formatting).
- Create a `src/controllers/` layer if routes grow complex.

**Example refactor for `/tax` route:**
```typescript
// Before: business logic in route handler
taxRouter.get('/', (req, res) => {
  const { start, end } = req.query;
  // ... validation + business logic mixed in handler
});

// After: thin controller + service layer
taxRouter.get('/', asyncHandler(async (req, res) => {
  const { startDate, endDate } = validateDateRange(req.query); // validation layer
  const report = await taxService.generateReport(startDate, endDate); // service layer
  res.json(report); // response formatting
}));
```

---
If anything above is unclear or you'd like me to include concrete TODOs, tests or a starter persistent storage implementation, tell me where to focus next.
