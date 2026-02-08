# Tax Lot Selection Strategy — Implementation Plan

## Background

Norwegian tax rules (Skatteetaten) do **not** require FIFO for virtual currencies:

> *If you have multiple units within the same virtual currency, you have to decide yourself which units are actually sold. There is no requirement that the unit purchased first must be sold first (the FIFO-principle that applies for shares does not apply here).*

This means we can freely choose which buy lots to match against each sell, allowing tax optimisation.

---

## Current State

### What exists today

| Component | File | Role |
|-----------|------|------|
| `generateTaxReport()` | `src/services/profitReporter.ts` | Hardcoded FIFO matching — consumes from front of per-asset `BuyPosition[]` array |
| `BuyPosition` interface | `src/services/profitReporter.ts` (local) | Tracks a buy lot: `transaction`, `remainingQuantity`, `effectiveBaseSize` |
| `SellEvent` / `BuyAllocation` | `src/models/sellEvent.ts` | Records which buy lots were consumed per sell — the output of lot matching |
| `TaxReport` | `src/models/taxReport.ts` | Aggregates sell events, fees, portfolio, income events |
| `accountingMethod` param | `profitReporter.ts` L25 | Accepted as `string`, stored in report — but **no dispatch logic**, always FIFO |
| Tax route | `src/routes/tax.ts` | Hardcodes `'FIFO'` string — no query parameter for method selection |
| Export route | `src/routes/export.ts` | Also hardcodes `'FIFO'` in all `generateTaxReport()` calls |

### Key architectural facts

- Buy positions are **ephemeral** — rebuilt from full transaction history every time `generateTaxReport()` runs. No persistent lot/position state.
- **All** transactions (including out-of-scope) are processed to build correct buy queues, but only in-scope events contribute to report totals.
- The sell-matching loop (L163–L216) and `consumeQuantityFromPositions()` (L329–L357) contain **duplicated** cost-basis logic.
- `SellEvent` is already strategy-agnostic — it receives `BuyAllocation[]` regardless of how they were selected.

---

## Goals

1. **Multiple accounting strategies** — FIFO, MAX_GAIN, MIN_GAIN, NEUTRAL (target ≈ zero tax)
2. **Fee-aware lot selection** — fees reduce taxable profit; strategies should factor this in
3. **Configurable threshold** — NEUTRAL strategy accepts a tolerance window (e.g. ±1000 NOK)
4. **Persist finalised lot assignments** — once the user is satisfied with choices for a tax year, lock them in so future years compute correctly
5. **Preview vs. commit workflow** — run report with different strategies (preview), then commit chosen assignments
6. **Year-over-year continuity** — 2025 lot choices must be respected when computing 2026; you can't re-select lots that were already consumed

---

## Proposed Strategies

### 1. FIFO (existing)
Consume oldest buy lots first. Deterministic, simple, auditable. Current default.

### 2. MAX_GAIN (maximise taxable gain)
Sort available lots by **cost basis per unit ascending** (cheapest lots first). Selling cheapest lots realises maximum gain → pay tax now, preserve expensive lots for future.

**When useful:** You expect future gains to be taxed at a higher rate, or want to "use up" cheap lots while in a low-income year.

### 3. MIN_GAIN (minimise taxable gain)  
Sort available lots by **cost basis per unit descending** (most expensive lots first). Selling expensive lots realises minimum gain (or a loss) → defer tax, preserve cheap lots.

**When useful:** High-income year where you want to minimise additional tax liability.

### 4. NEUTRAL (target near-zero gain)
For each sell, select lots that produce a gain/loss closest to a configurable **target** (default: 0 NOK) within a **threshold** window (default: ±1000 NOK).

**Algorithm:**
1. For each available lot, compute hypothetical gain if that lot were consumed.
2. Greedily select lots that move cumulative gain closest to target.
3. When multiple lots produce equivalent gain proximity, prefer the lot with **higher fees** (since fees are deductible, maximising fee inclusion reduces the overall tax bill even if gain is near zero).
4. If no combination lands within the threshold, fall back to MIN_GAIN behaviour.

**Complexity note:** True optimal selection is a subset-sum variant (NP-hard). Greedy with threshold tolerance is sufficient for real-world portfolios. A bounded DP approach can be added later if needed.

### Fee-awareness (all strategies)

- **Buy fees** are already proportionally included in cost basis (higher buy fee → higher cost basis → lower gain). Strategies operating on cost-basis-per-unit inherently factor this in.
- **Sell fees** reduce proceeds. They're constant per sell event regardless of which lots are chosen.  
- **Withdrawal fees** are separately deductible. NEUTRAL strategy should subtract accumulated `deductibleFees` from the target to avoid over-optimising (the fees already reduce your tax bill).
- **Threshold parameter** for NEUTRAL: if total fees for the period already exceed the threshold, NEUTRAL may safely skip optimisation for small sells (configurable).

---

## Architecture

### Phase 1: Strategy Interface & Refactor

#### New file: `src/services/accountingStrategies.ts`

```typescript
/**
 * A BuyLot is an available buy position that can be selected for matching.
 * Exported so strategies can reference it.
 */
export interface BuyLot {
    transaction: Transaction;
    index: number;
    remainingQuantity: number;
    effectiveBaseSize: number;
    // Pre-computed for strategy use:
    costBasisPerUnit: number;       // (taxQuoteSize + taxFee) / effectiveBaseSize
    totalCostBasis: number;         // Full remaining cost basis
    buyFeePerUnit: number;          // taxFee / effectiveBaseSize
}

/**
 * Context provided to the strategy for each sell event.
 */
export interface LotSelectionContext {
    sellPricePerUnit: number;       // Sell price in tax currency
    sellQuantity: number;           // How much is being sold
    sellFee: number;                // Sell fee in tax currency
    cumulativeGainThisPeriod: number; // Running total gain for in-scope sells so far
    deductibleFeesThisPeriod: number; // Accumulated withdrawal fees
    nativeCurrency: string;
}

/**
 * Result of lot selection — ordered list of lots to consume.
 */
export interface LotSelectionResult {
    /** Lots ordered by consumption priority */
    orderedLots: BuyLot[];
    /** Human-readable explanation of why lots were ordered this way */
    selectionReason: string;
}

export interface AccountingStrategy {
    readonly name: string;
    readonly description: string;
    selectLots(
        availableLots: BuyLot[],
        context: LotSelectionContext
    ): LotSelectionResult;
}
```

#### Strategy implementations (same file or separate files per strategy)

```
src/services/strategies/
  fifo.ts          — FifoStrategy (current behaviour, sort by index)
  maxGain.ts       — MaxGainStrategy (sort by costBasisPerUnit ASC)
  minGain.ts       — MinGainStrategy (sort by costBasisPerUnit DESC)
  neutral.ts       — NeutralGainStrategy (greedy target-seeking)
  index.ts         — Re-exports + factory: resolveStrategy(name: string, options?)
```

#### Refactor `profitReporter.ts`

1. **Export `BuyPosition`** (renamed to `BuyLot` in the interface) — currently local, needs to be importable.
2. **Pre-compute `costBasisPerUnit`** when creating each `BuyLot` during BUY processing.
3. **Replace inline FIFO loop** (L163–L198) with:
   ```typescript
   const result = strategy.selectLots(positions, context);
   // Consume lots in the order returned by the strategy
   for (const lot of result.orderedLots) { ... }
   ```
4. **Unify the duplicated cost-basis calculation** in `consumeQuantityFromPositions()` by extracting a shared `calculateProportionalCostBasis(lot, quantity)` helper.
5. **Pass `AccountingStrategy`** instead of `string` into `generateTaxReport()`.
6. **Track cumulative gain** across sells to pass into `LotSelectionContext` for NEUTRAL strategy.

#### Update call sites

- `src/routes/tax.ts` — accept `?method=FIFO|MAX_GAIN|MIN_GAIN|NEUTRAL&threshold=1000`
- `src/routes/export.ts` — same query params on all tax-report export endpoints

---

### Phase 2: Persistence — Committed Lot Assignments

This is the critical piece for year-over-year correctness.

#### The Problem

Today, lot assignments are **transient** — computed fresh each report run. If you run a 2025 report with MIN_GAIN, those choices vanish. When you later run 2026, the system re-processes all history from scratch and may assign different lots to the 2025 sells (especially if you change strategy).

#### Solution: `LotAssignment` persistence layer

##### New model: `src/models/lotAssignment.ts`

```typescript
export interface LotAssignment {
    /** Unique ID for this assignment */
    id: string;
    /** Tax year this assignment belongs to */
    taxYear: number;
    /** The sell transaction ID */
    sellTransactionId: string;
    /** The buy transaction ID matched against */
    buyTransactionId: string;
    /** Quantity consumed from this buy lot */
    quantity: number;
    /** Cost basis for this allocation (in tax currency) */
    costBasis: number;
    /** Proportional buy fee included */
    buyFee: number;
    /** Strategy that produced this assignment */
    strategy: string;
    /** When this assignment was committed */
    committedAt: Date;
    /** Which asset this is for */
    asset: string;
}
```

##### New storage interface: `src/repositories/lotAssignmentStorage.ts`

```typescript
export interface LotAssignmentStorage {
    /** Save a batch of assignments for a tax year (replaces any existing for that year) */
    commitAssignments(taxYear: number, assignments: LotAssignment[]): Promise<void>;
    /** Get all committed assignments for a tax year */
    getByTaxYear(taxYear: number): Promise<LotAssignment[]>;
    /** Get committed assignments for a specific sell */
    getBySellTransaction(sellTransactionId: string): Promise<LotAssignment[]>;
    /** Check if a tax year has committed assignments */
    isYearCommitted(taxYear: number): Promise<boolean>;
    /** Get all committed tax years */
    getCommittedYears(): Promise<number[]>;
    /** Delete assignments for a year (allow re-selection) */
    deleteYear(taxYear: number): Promise<void>;
}
```

##### File-based implementation: `src/repositories/lotAssignmentFile.ts`

Persists to `./data/lot-assignments.json` (or configurable via `LOT_ASSIGNMENTS_FILE_PATH` env var). Structure:

```json
{
  "2024": {
    "committedAt": "2025-03-15T10:00:00Z",
    "strategy": "FIFO",
    "assignments": [
      {
        "id": "la-001",
        "sellTransactionId": "sell-123",
        "buyTransactionId": "buy-456",
        "quantity": 0.5,
        "costBasis": 150000,
        "buyFee": 50,
        "asset": "BTC"
      }
    ]
  }
}
```

##### How `generateTaxReport()` uses committed assignments

```
For each SELL transaction:
  1. Check if this sell's tax year has committed assignments
  2. If YES → use the committed BuyAllocations directly (skip strategy selection)
        → subtract consumed quantities from buy positions (as if FIFO consumed them)
  3. If NO  → use the configured AccountingStrategy to select lots (preview mode)
```

This means:
- **Past years** with committed assignments are deterministic regardless of which strategy you're currently previewing.
- **Current year** (uncommitted) lets you try different strategies and see the impact.
- You can re-commit a year if you change your mind (before filing taxes).

---

### Phase 3: Preview / Commit Workflow

#### API Endpoints

##### Preview (existing endpoints, enhanced)

```
GET /tax?start=2025-01-01&end=2025-12-31&method=MIN_GAIN&threshold=1000
GET /export/tax-report/complete?start=2025-01-01&end=2025-12-31&method=MAX_GAIN
```

Returns the tax report as normal. Committed years are respected; uncommitted years use the requested strategy. Response includes a flag:

```json
{
  "summary": {
    "accountingMethod": "MIN_GAIN",
    "isCommitted": false,
    "committedYears": [2021, 2022, 2023, 2024],
    "previewYears": [2025]
  }
}
```

##### Compare strategies

```
GET /tax/compare?start=2025-01-01&end=2025-12-31
```

Runs all strategies and returns a comparison summary:

```json
{
  "comparison": {
    "FIFO":      { "profit": 45000, "fees": 1200, "netTaxable": 43800 },
    "MAX_GAIN":  { "profit": 72000, "fees": 1500, "netTaxable": 70500 },
    "MIN_GAIN":  { "profit":  8000, "fees":  900, "netTaxable":  7100 },
    "NEUTRAL":   { "profit":   450, "fees": 1100, "netTaxable":  -650 }
  },
  "committedYears": [2021, 2022, 2023, 2024],
  "previewYear": 2025
}
```

##### Commit

```
POST /tax/commit
Body: {
  "taxYear": 2025,
  "method": "MIN_GAIN",
  "threshold": 1000    // only for NEUTRAL
}
```

1. Runs `generateTaxReport()` with the specified method for the given year
2. Extracts all `SellEvent.buyAllocations` for that year
3. Persists them as `LotAssignment[]` via `LotAssignmentStorage`
4. Returns the committed report

##### Uncommit (re-open a year for re-selection)

```
DELETE /tax/commit/:taxYear
```

Deletes committed assignments for that year. Returns confirmation + warning that downstream years may now produce different results.

##### View committed assignments

```
GET /tax/commit/:taxYear
```

Returns the committed `LotAssignment[]` for inspection.

---

### Phase 4: Data Model Changes

#### `SellEvent` enhancements

Add to `BuyAllocation`:

```typescript
export interface BuyAllocation {
    buyTransactionId: string;
    quantity: number;
    costBasis: number;
    selectionReason?: string;    // NEW: "FIFO: oldest lot", "MIN_GAIN: highest cost basis lot"
    buyDate?: Date;              // NEW: for audit trail — when was this lot acquired
    costBasisPerUnit?: number;   // NEW: cost basis / quantity for this allocation
}
```

Add to `SellEvent`:

```typescript
export class SellEvent {
    // ... existing fields ...
    isCommitted: boolean = false;         // NEW: was this from committed assignments
    strategyUsed: string = 'FIFO';        // NEW: which strategy produced this matching
}
```

#### `TaxReport` enhancements

Add to summary:

```typescript
summary: {
    // ... existing fields ...
    accountingMethod: string;
    isCommitted: boolean;
    committedYears: number[];
    previewYears: number[];
    strategyOptions?: {           // Only in compare mode
        [method: string]: {
            profit: number;
            fees: number;
            netTaxable: number;
        }
    }
}
```

---

## Implementation Order

### Step 1 — Strategy interface + FIFO extraction (no behaviour change)
- Create `AccountingStrategy` interface and `BuyLot` type
- Implement `FifoStrategy` that reproduces current behaviour exactly
- Refactor `generateTaxReport()` to use strategy — all tests/outputs should be identical
- Extract `calculateProportionalCostBasis()` to unify the duplicated logic
- **Verification:** Run existing reports, diff output — must be identical

### Step 2 — Additional strategies
- Implement `MaxGainStrategy`, `MinGainStrategy`, `NeutralGainStrategy`
- Add strategy factory: `resolveStrategy(name, options) → AccountingStrategy`
- Wire `?method=` query param in tax routes
- **Verification:** Run same period with each strategy, verify gain ordering makes sense

### Step 3 — Comparison endpoint
- Add `GET /tax/compare` endpoint
- Returns summary-level metrics for all strategies in one call
- **Verification:** Compare output matches individual strategy runs

### Step 4 — Lot assignment persistence
- Create `LotAssignment` model and `LotAssignmentStorage` interface
- Implement `LotAssignmentFileRepository`
- Wire into `generateTaxReport()` — committed years use stored assignments, uncommitted years use strategy
- **Verification:** Commit 2024, run 2025 report, verify 2024 lots are locked

### Step 5 — Commit/uncommit workflow
- Add `POST /tax/commit`, `DELETE /tax/commit/:taxYear`, `GET /tax/commit/:taxYear`
- Add `isCommitted` / `committedYears` to report output
- **Verification:** Full workflow — preview → compare → commit → verify persistence → re-run

### Step 6 — Audit trail & export
- Add `selectionReason`, `buyDate`, `costBasisPerUnit` to `BuyAllocation`
- Add `strategyUsed` to `SellEvent`
- Update CSV export to include strategy/assignment metadata
- **Verification:** Exported CSVs contain complete audit trail

---

## Edge Cases & Gotchas

### 1. Partial lot consumption across years
A buy lot purchased in 2023 may be partially consumed in 2024 (committed as FIFO) and partially consumed in 2025 (using MIN_GAIN). The 2025 processing must:
- Load 2024 committed assignments
- Subtract committed quantities from buy lot `remainingQuantity`
- Only then apply the 2025 strategy to the **remaining** portion

### 2. Re-committing a year invalidates downstream
If you re-commit 2024 with a different strategy, the lot assignments change, which means 2025's available lots change too. If 2025 is also committed, it may now be **invalid** (referencing lots that are no longer available). 

**Safeguard:** When re-committing year N, warn if year N+1 is committed and offer to cascade-delete downstream commitments.

### 3. Crypto-crypto synthetic legs
The expansion in `expandTransactionsForAccounting()` creates synthetic transactions. Lot assignments must reference the **synthetic leg IDs** (e.g. `txn-123#base-sell`), not the original transaction ID, since the buy positions are built from synthetic legs.

### 4. Reward transactions
Rewards create buy positions with `costBasis = fair market value at earning`. These lots have known, fixed cost bases — useful for NEUTRAL strategy since their gain contribution is predictable.

### 5. Float precision
Current code uses epsilon `0.00000000001` for float comparisons. Strategy sorting must be stable when cost bases are within epsilon of each other. Use `Number.EPSILON`-aware comparisons or consider using integer arithmetic (satoshis) for quantities.

### 6. Threshold and fee interaction
For NEUTRAL strategy: if withdrawal fees for the period are 3000 NOK and threshold is 1000 NOK, the target window is effectively `[-4000, -2000]` in raw gain terms (since 3000 of deductible fees will reduce the tax bill regardless). The strategy should account for this to avoid over-optimising.

### 7. Empty buy queue
If a sell has no buy lots available (incomplete history), all strategies should produce the same warning. Don't let strategy selection mask data quality issues.

---

## Environment Variables (new)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOT_ASSIGNMENTS_FILE_PATH` | `./data/lot-assignments.json` | Path to committed lot assignments file |
| `DEFAULT_ACCOUNTING_METHOD` | `FIFO` | Default strategy when `?method=` is not specified |
| `NEUTRAL_THRESHOLD` | `1000` | Default threshold for NEUTRAL strategy (in native currency units) |

---

## Future Considerations

### Per-sell strategy assignment
Norwegian rules allow choosing lots **per individual sell**, not just per year. A future enhancement could add:
```
POST /tax/lot-assignment
Body: {
  "sellTransactionId": "sell-123",
  "buyAllocations": [
    { "buyTransactionId": "buy-456", "quantity": 0.5 },
    { "buyTransactionId": "buy-789", "quantity": 0.3 }
  ]
}
```
This would allow manual lot picking via a future front-end UI.

### Average cost method
While not one of the "free choice" strategies, average cost is commonly used in other jurisdictions. The architecture supports adding it — implement `AverageCostStrategy` that ignores individual lots and uses weighted average cost basis across all holdings.

### Multi-year optimisation
Instead of optimising each sell independently, a global optimiser could consider the entire tax year holistically — e.g., "what's the best overall assignment of all lots to all sells to minimise total gain?" This is a more complex optimisation problem but feasible for typical portfolio sizes.

### Tax-loss harvesting suggestions
Given available lots and current market prices, suggest sells that would realise losses to offset gains. This builds on the strategy infrastructure but adds a proactive recommendation layer.
