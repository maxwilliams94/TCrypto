## Project overview

TCrypto is a small TypeScript/Node service for importing, normalising and reporting on crypto transactions (CSV import -> in-memory repository -> tax/profit reporting endpoints).

Key directories/files to read first:
- `src/services/transactionImporter.ts` — CSV parsing, strict header validation, and the import flow that may split crypto/crypto trades into two native-currency transactions.
- `src/services/exchangeRateService.ts` — fetches FX rates from Norges Bank and caches results.
- `src/repositories/storage.ts` — `TransactionStorage` interface; implement this to add persistent storage.
- `src/repositories/memory.ts` — in-memory singleton repository (default).
- `src/repositories/file.ts` — file-based JSON persistence (enable with `USE_FILE_STORAGE=true`).
- `src/models/transaction.ts` — canonical Transaction shape and helper `isCryptoCryptoTransaction()`.
- `src/services/profitReporter.ts` — tax/profit calculation (FIFO style by default).

## Big-picture architecture and dataflow
- CSV files are read by `importInitialTransactions()` in `transactionImporter.ts` (env var `TRANSACTION_DIR` or cwd). Each CSV row becomes a `Transaction`.
- **Import process**: loads existing transactions from storage first, then processes CSVs and skips duplicates by transaction ID.
- Crypto/crypto trades are transformed by `splitCryptoCryptoTransaction()` into two transactions: a SELL for the quote currency into the native currency (default NOK) and a BUY of the base currency priced in the native currency.
- Exchange rates are resolved via `ExchangeRateService.getCcyNokRate(currency, date)` which calls an external API and caches values keyed by `${currency}-${date}`.
- Transactions are stored via the `TransactionStorage` interface; the repo ships with an in-memory implementation (`createTransactionRespository()`). The server serves endpoints in `src/routes/*`.

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

Example: to run dev with CSVs in `assets/` and file-based storage:
```
TRANSACTION_DIR=assets USE_FILE_STORAGE=true npm run dev
```

## Codebase conventions and notable patterns
- CSV parsing in `loadTransactionData()` expects headers exactly: `Id`, `Status`, `Market`, `FilledQuantity`, `FilledQuote`, `FilledPrice`, `Filled At`. If a header is missing the importer rejects the file.
- Markets are parsed via `row.Market.split('-')` and trimmed; the file must use `BASE-QUOTE` format.
- When a transaction is crypto/crypto (neither side is considered fiat by `isFiat()`), it's split into two transactions. The split uses `ExchangeRateService` to convert the quote to `NOK` (native currency by default).
- The `TransactionStorage` interface is used everywhere; the app ships with two implementations:
  - `MemoryRepository` (default) — singleton, data lost on restart.
  - `FileRepository` (opt-in via `USE_FILE_STORAGE=true`) — persists to JSON, auto-loads on startup, includes CSV export at `GET /transactions/export/csv`.
- Storage selection happens in `src/index.ts` at startup; the chosen repository is exported and imported by routes.

## Integration points & external dependencies
- External HTTP calls:
  - `src/services/exchangeRateService.ts` calls Norges Bank API (`data.norges-bank.no`). The service caches responses in-memory.
- CSV input files: any change to header names or date formats requires updates to `loadTransactionData()`.

## Practical examples for an AI agent
- To add persistent storage: implement `TransactionStorage` and return your implementation from a factory in place of `createTransactionRespository()` (see `src/repositories/memory.ts`).
- To change native currency handling: update `importInitialTransactions()` call in `src/index.ts` and the `splitCryptoCryptoTransaction()` usage; note the importer currently calls `loadTransactionData(filePath, 'NOK')`.
- To debug FX caching issues: inspect `ExchangeRateService.getCcyNokRate()` — cache keys are `${currency}-${date}` (the `date` object is stringified), and `getLatestWorkingDay(date)` mutates the passed Date object.

## Quick gotchas worth knowing
- `package.json` scripts:
  - `dev` uses `ts-node` (runtime TS) — faster for iterative debugging.
  - `build` uses `npx tsc` and `start` expects compiled `dist/index.js`.
- Date handling: CSV `Filled At` is parsed with `new Date(...)`. Timezone differences may affect lookup of exchange rates.
- Exchange rate cache key uses the Date object stringification; expect cache misses if dates are mutated or not normalised to YYYY-MM-DD.
- There are no unit tests in the repo. Adding unit tests should target `loadTransactionData`, `splitCryptoCryptoTransaction`, `ExchangeRateService` (mock HTTP) and `generateTaxReport` logic.

## If you change code, prefer small, focused edits
- Small PRs that add unit tests for importer and reporter are highly valuable.
- When changing CSV parsing, include a sample CSV in `assets/` and update `README.md` with header expectations.

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
