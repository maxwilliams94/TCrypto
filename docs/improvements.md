# CSV Import Format - Focused Improvements

## Current State Analysis

### Required Headers (Current)
```
Id, Status, Side, Market, TransactionType, Fee, FilledQuantity, FilledQuote, FilledPrice, Timestamp
```

### Optional Headers (Current)
```
Exchange, Validator, Epoch, RewardSource
```

## ✅ Accepted Changes (To Implement)

### 1. **FeeCurrency** ⭐ PRIORITY
**Reason:** Some exchanges take fees in the cryptocurrency being sold, not the quote currency.

**Example:**
```csv
Market,Side,Fee,FeeCurrency
BTC-NOK,SELL,0.001,BTC  # Fee taken in BTC, not NOK
```

This fee must be converted to fiat for accurate tax calculations.

### 2. **Notes/Comments** ⭐ PRIORITY
**Reason:** Allow user annotations for context.

**Examples:**
```csv
Id,Notes
tx-001,DCA purchase #3
tx-002,Transferred from Kraken
tx-003,Withdrawal to cold wallet
```

### 3. **WITHDRAWAL and TRANSFER Transaction Types** ⭐ PRIORITY
**Reason:** These have fees but no gain/loss.

- `WITHDRAWAL` — Moving crypto off exchange (has fee, no taxable event)
- `TRANSFER` — Moving between own wallets/exchanges (has fee, no taxable event)

**Example:**
```csv
Id,TransactionType,Fee,Notes
withdraw-001,WITHDRAWAL,0.0001,Sent to Ledger hardware wallet
transfer-001,TRANSFER,0.00005,Moved from Binance to Kraken
```

### 4. **Rethink Crypto-Crypto Transaction Handling** 🤔 NEEDS DESIGN
**Current problem:** System creates artificial NOK transactions that never happened.

**Need to decide:** Better approach for tracking and calculating profit/loss on crypto-crypto trades.

### 4. **Rethink Crypto-Crypto Transaction Handling** ✅ DECISION MADE
**Decision:** Store original transactions, convert at report time.

**Rationale:** 
- Keep original transaction data intact (BTC-USDC stays as BTC-USDC)
- No artificial NOK transactions
- Tax reporter handles conversion logic when generating reports
- More transparent and auditable

**Key insight:** USDC trades need TWO exchange rates:
1. **BTC price** (BTC → USD rate at transaction time)
2. **USD-NOK rate** (USD → NOK rate at transaction time)

This captures both:
- Gain/loss from BTC price movement
- Gain/loss from USD-NOK forex movement

**Implementation detail (2025-10-31):** The importer now keeps BTC-USDC trades intact. During tax report generation the profit reporter expands each crypto-crypto trade into runtime NOK legs (USDC→NOK sell + BTC→NOK buy) using the stored exchange rates, so FIFO and FX gains are handled without polluting the persisted transaction list.

### 5. **Store Exchange Rates on Transactions** ⭐ NEW
**Reason:** Enable accurate crypto-crypto tax calculations at report time.

**New fields:**
- `BaseCurrencyRate` — Exchange rate of base currency to native currency (e.g., BTC to NOK)
- `QuoteCurrencyRate` — Exchange rate of quote currency to native currency (e.g., USDC to NOK)

These rates are fetched once during import and stored with the transaction, avoiding repeated API calls during report generation.

---

## ❌ Rejected/Deferred

The following suggestions are **NOT** being implemented:

- **Protocol/DApp/Chain fields** — Out of scope for now
- **Cost basis override** — Transfer-in is treated as a buy somewhere; use Notes to indicate it was a transfer
- **Multi-leg transaction grouping** — Not needed currently
- **Price source metadata** — Not needed currently
- **Staking enhancements** (RewardType, APY, etc.) — Current fields sufficient
- **All Tier 2-4 advanced fields** — Out of scope

---

## Updated CSV Format Specification

### Required Fields
```csv
Id                      # Unique transaction ID
Status                  # FILLED (only status processed currently)
Market                  # BASE-QUOTE pair (e.g., BTC-NOK)
Side                    # BUY or SELL
TransactionType         # See supported types below
FilledQuantity          # Base currency amount
FilledQuote             # Quote currency amount
FilledPrice             # Price per unit (0 = auto-lookup for rewards)
Fee                     # Fee amount
Timestamp               # Transaction timestamp (ISO 8601)
```

### Optional Fields (Current)
```csv
Exchange                # Exchange/platform name
Validator               # For staking rewards
Epoch                   # For staking rewards
RewardSource            # For staking rewards
```

### New Optional Fields (To Be Implemented)
```csv
FeeCurrency             # Currency of fee (defaults to quote currency if not specified)
Notes                   # User annotations/comments
BaseCurrencyRate        # Exchange rate of base currency to native currency (for crypto-crypto)
QuoteCurrencyRate       # Exchange rate of quote currency to native currency (for crypto-crypto)
```

### Supported Transaction Types
```
TRADE                   # Regular buy/sell
STAKING_REWARD          # Staking rewards
LENDING_REWARD          # Lending rewards
AIRDROP                 # Airdrop receipts
MINING_REWARD           # Mining rewards
FORK                    # Fork receipts
INTERNAL_TRANSFER       # treated as untaxable
WITHDRAWAL              # Withdrawal with fee (no gain/loss) [NEW]
TRANSFER                # Transfer with fee (no gain/loss) [NEW]
```

---

## Examples

### Example 1: Trade with Fee in Sold Asset
```csv
Id,Status,Market,Exchange,Side,TransactionType,FilledQuantity,FilledQuote,FilledPrice,Fee,FeeCurrency,Timestamp,Notes
tx-001,FILLED,BTC-NOK,binance,SELL,TRADE,0.1,55000,550000,0.001,BTC,2024-01-15T10:00:00Z,Regular sale
```

### Example 2: Staking Reward
```csv
Id,Status,Market,Exchange,Side,TransactionType,FilledQuantity,FilledQuote,FilledPrice,Fee,Timestamp,Validator,Epoch,RewardSource,Notes
reward-123,FILLED,ADA-NOK,cardano,BUY,STAKING_REWARD,5.5,46.75,8.5,0,2024-01-15T00:00:00Z,ADAVERSE,452,cardano,Weekly staking reward
```

### Example 3: Transfer from Another Exchange
```csv
Id,Status,Market,Side,TransactionType,FilledQuantity,FilledQuote,FilledPrice,Fee,Timestamp,Notes
transfer-001,FILLED,BTC-NOK,BUY,DEPOSIT,0.5,200000,400000,0,2024-06-01T10:00:00Z,Transferred from Kraken
```

### Example 4: Withdrawal to Hardware Wallet
```csv
Id,Status,Market,Side,TransactionType,FilledQuantity,FilledQuote,FilledPrice,Fee,FeeCurrency,Timestamp,Notes
withdraw-001,FILLED,BTC-NOK,,WITHDRAWAL,0.5,0,0,0.0001,BTC,2024-07-01T10:00:00Z,Sent to Ledger
```

### Example 5: Transfer Between Own Wallets
```csv
Id,Status,Market,Side,TransactionType,FilledQuantity,FilledQuote,FilledPrice,Fee,FeeCurrency,Timestamp,Notes
move-001,FILLED,ETH-NOK,,TRANSFER,2.0,0,0,0.002,ETH,2024-08-01T10:00:00Z,Moved to MetaMask
```

### Example 6: Crypto-Crypto Trade (BTC-USDC)
```csv
Id,Status,Market,Exchange,Side,TransactionType,FilledQuantity,FilledQuote,FilledPrice,Fee,FeeCurrency,Timestamp,BaseCurrencyRate,QuoteCurrencyRate,Notes
buy-btc-usdc,FILLED,BTC-USDC,coinbase,BUY,TRADE,0.1,6500,65000,3.25,USDC,2024-01-15T10:00:00Z,650000,10.00,Bought BTC with USDC
sell-btc-usdc,FILLED,BTC-USDC,coinbase,SELL,TRADE,0.1,7200,72000,3.60,USDC,2024-06-15T10:00:00Z,756000,10.50,Sold BTC for USDC
```

**Explanation:**
- `BaseCurrencyRate` = BTC to NOK rate (e.g., 650,000 NOK per BTC)
- `QuoteCurrencyRate` = USDC to NOK rate (e.g., 10.00 NOK per USDC)
- These rates are fetched during import and stored for tax calculation

---

## Crypto-Crypto Tax Calculation Example

### Scenario: BTC-USDC Round Trip

**Trade 1: BUY 0.1 BTC with 6,500 USDC**
- Date: 2024-01-15
- Price: 65,000 USDC per BTC
- Fee: 3.25 USDC
- BTC-NOK rate: 650,000 (fetched from CoinGecko)
- USDC-NOK rate: 10.00 (fetched from exchange rate API)

**Cost basis calculation:**
```
Quote amount in NOK = 6,500 USDC × 10.00 = 65,000 NOK
Fee in NOK = 3.25 USDC × 10.00 = 32.50 NOK
Total cost basis = 65,000 + 32.50 = 65,032.50 NOK
```

**Trade 2: SELL 0.1 BTC for 7,200 USDC**
- Date: 2024-06-15
- Price: 72,000 USDC per BTC
- Fee: 3.60 USDC
- BTC-NOK rate: 756,000 (fetched from CoinGecko)
- USDC-NOK rate: 10.50 (fetched from exchange rate API)

**Proceeds calculation:**
```
Quote amount in NOK = 7,200 USDC × 10.50 = 75,600 NOK
Fee in NOK = 3.60 USDC × 10.50 = 37.80 NOK
Net proceeds = 75,600 - 37.80 = 75,562.20 NOK
```

**Profit/Loss calculation:**
```
Profit = Net proceeds - Cost basis
Profit = 75,562.20 - 65,032.50 = 10,529.70 NOK
```

### What This Captures:

1. **BTC price gain:** 65,000 → 72,000 USDC (+10.8%)
2. **USD-NOK forex gain:** 10.00 → 10.50 (+5%)
3. **Combined effect:** Original 65,000 NOK → 75,600 NOK proceeds

### Transparency in Reporting:

When generating tax reports, the system should show:
```
Sell Event: 0.1 BTC
Sold for: 7,200 USDC (75,600 NOK at rate 10.50)
Cost basis: 6,500 USDC (65,000 NOK at rate 10.00) + fees 32.50 NOK
Profit: 10,529.70 NOK
  - From BTC appreciation: ~7,000 NOK
  - From USD-NOK movement: ~3,250 NOK
  - Net of fees: ~70 NOK
```

### Why Store Exchange Rates:

1. **Consistency** — Use same rates for import and reporting
2. **Performance** — No repeated API calls during report generation
3. **Auditability** — Rates are frozen at transaction time
4. **Offline reporting** — Generate reports without API access
5. **Historical accuracy** — Rates may not be available later

---

## Implementation Tasks

### Task 1: Add FeeCurrency Support
**Changes needed:**
1. Update `Transaction` model to include `feeCurrency` field
2. Update `loadTransactionData()` to parse `FeeCurrency` column (default to quote currency)
3. Update tax calculation logic to convert fee to tax currency
4. Update CSV export to include fee currency

### Task 2: Add Notes Support
**Changes needed:**
1. Update `Transaction` model to include `notes` field
2. Update `loadTransactionData()` to parse `Notes` column
3. Include notes in transaction exports
4. Display notes in transaction listings

### Task 3: Add WITHDRAWAL and TRANSFER Types
**Changes needed:**
1. Update `TransactionType` enum to include `WITHDRAWAL` and `TRANSFER`
2. Update `loadTransactionData()` to support these types
3. Update tax reporter to skip gain/loss calculation for these types
4. Track fees for these transactions
5. Ensure they don't affect cost basis calculations

### Task 4: Redesign Crypto-Crypto Handling
**Implementation approach:**
1. **Stop splitting crypto-crypto transactions** during import
2. **Fetch and store exchange rates** for both currencies during import:
   - `BaseCurrencyRate` — Base currency to NOK (e.g., BTC → NOK)
   - `QuoteCurrencyRate` — Quote currency to NOK (e.g., USDC → NOK)
3. **Update Transaction model** to include these rate fields
4. **Update tax reporter** to use stored rates for conversion at report time:
   - Buy: Cost basis = (FilledQuote × QuoteCurrencyRate) + (Fee × FeeCurrencyRate)
   - Sell: Proceeds = (FilledQuote × QuoteCurrencyRate) - (Fee × FeeCurrencyRate)
5. **Add transparency** in sell event reporting showing breakdown:
   - Original amounts in USDC
   - Converted amounts in NOK with rates used
   - Breakdown of profit from crypto vs forex movement
6. **Test with real data** to validate accuracy

**Benefits:**
- No artificial transactions
- Original data preserved
- Transparent calculations
- Captures both crypto and forex gains/losses
- Rates stored for consistent reporting

---

## Migration Strategy

### Phase 1: Backward Compatible Changes
- Add `FeeCurrency` and `Notes` as optional fields
- Default behavior unchanged if fields not provided
- Existing CSVs continue to work

### Phase 2: New Transaction Types
- Add `WITHDRAWAL` and `TRANSFER` support
- Update documentation
- Provide examples

### Phase 3: Crypto-Crypto Redesign
- Research and design phase
- Implement new logic
- Migrate existing crypto-crypto transactions
- Validate tax calculations
