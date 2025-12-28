

export type TransactionType = 'TRADE' | 'STAKING_REWARD' | 'LENDING_REWARD' | 'AIRDROP' | 'MINING_REWARD' | 'FORK' | 'INTERNAL_TRANSFER' | 'WITHDRAW' | 'DEPOSIT';

export class Transaction {
    id: string;
    baseCurrency: string;
    quoteCurrency: string;
    exchange: string;
    side: string;
    baseSize: number;
    quoteSize: number;
    price: number;
    fee: number;
    dateTime: Date;
    type: TransactionType;
    
    // Tax accounting fields (for audit trail and tax reporting)
    taxCurrency?: string;           // The currency used for tax calculation (e.g., 'NOK')
    taxQuoteSize?: number;          // Quote size converted to tax currency
    taxPrice?: number;              // Price per unit in tax currency (taxQuoteSize / baseSize)
    taxFee?: number;                // Fee converted to tax currency
    taxConversionRate?: number;     // Exchange rate used for conversion (quoteCurrency -> taxCurrency)
    taxConversionDate?: Date;       // Date used for the exchange rate lookup
    feeCurrency?: string;           // Currency of the fee (for future support of non-fiat fees)
    
    sourceTransactionId?: string; // Link back to original trade when using derived legs
    leg?: 'BASE' | 'QUOTE' | 'ORIGINAL';
    processingSequence?: number;
    
    // Reward-specific fields (for STAKING_REWARD, MINING_REWARD, AIRDROP, LENDING_REWARD, FORK)
    rewardSource?: string;          // Source of reward (e.g., 'Lido', 'Kraken Staking', 'Mining Pool')
    
    // Income tracking for rewards (separate from cost basis for asset)
    // When a reward is earned, it's INCOME at that value. Then it becomes an ASSET with cost basis = income value.
    incomeValue?: number;           // The value of the reward at time of earning (in original currency)
    incomeValueInTaxCurrency?: number; // Income value converted to tax currency
    incomeConversionRate?: number;  // Exchange rate used to convert income value to tax currency
    incomeDate?: Date;              // Date when the income was realized (usually same as dateTime for rewards)
    

    constructor(
        id: string,
        baseCurrency: string,
        quoteCurrency: string,
        exchange: string,
        side: string,
        baseSize: number,
        quoteSize: number,
        price: number,
        fee: number,
        dateTime: Date,
        type: TransactionType = 'TRADE',
    ) {
        this.id = id;
        this.baseCurrency = baseCurrency;
        this.quoteCurrency = quoteCurrency;
        this.exchange = exchange;
        this.side = side;
        this.baseSize = baseSize;
        this.quoteSize = quoteSize;
        this.price = price;
        this.fee = fee;
        this.dateTime = dateTime;
        this.type = type;
    }

    toSimpleJSON() {
        const baseInfo: any = {
            id: this.id,
            CCY: `${this.baseCurrency}-${this.quoteCurrency}`,
            exchange: this.exchange,
            side: this.side,
            type: this.type,
            baseSize: this.baseSize,
            price: this.price,
            fee: this.fee,
            feeCurrency: this.feeCurrency,
            dateTime: this.dateTime.toISOString(),
            sourceTransactionId: this.sourceTransactionId,
            leg: this.leg
        };

        // Add reward-specific fields if present
        if (this.isReward()) {
            Object.assign(baseInfo, {
                rewardSource: this.rewardSource,
                incomeValue: this.incomeValue,
                incomeDate: this.incomeDate?.toISOString()
            });
        }

        // Add tax conversion fields if available
        if (this.hasTaxConversion()) {
            Object.assign(baseInfo, {
                taxCurrency: this.taxCurrency,
                taxPrice: this.taxPrice,
                taxQuoteSize: this.taxQuoteSize,
                taxFee: this.taxFee,
                taxConversionRate: this.taxConversionRate
            });
        }

        // Add income tracking in tax currency if available
        if (this.incomeValueInTaxCurrency !== undefined) {
            baseInfo['incomeValueInTaxCurrency'] = this.incomeValueInTaxCurrency;
        }

        return baseInfo;
    }

    /**
     * Check if this transaction is a reward-type transaction
     */
    isReward(): boolean {
        return ['STAKING_REWARD', 'LENDING_REWARD', 'AIRDROP', 'MINING_REWARD', 'FORK'].includes(this.type);
    }

    /**
     * Check if this transaction represents income for tax purposes
     */
    isTaxableIncome(): boolean {
        return this.isReward();
    }

    /**
     * Set the income value for reward transactions.
     * This represents the fair market value of the reward at the time it was earned.
     * The income is taxable in the year it was earned, even if the asset is sold later.
     * 
     * For cost basis purposes, the asset's cost basis is set equal to this income value.
     * 
     * @param incomeValue The FMV of the reward in the original currency
     * @param conversionRate Exchange rate to convert income value to tax currency
     * @param conversionDate Date used for the exchange rate lookup
     */
    setRewardIncome(
        incomeValue: number,
        conversionRate?: number,
        conversionDate?: Date
    ): void {
        if (!this.isReward()) {
            throw new Error(`Cannot set reward income on non-reward transaction type: ${this.type}`);
        }
        
        this.incomeValue = incomeValue;
        this.incomeDate = conversionDate || this.dateTime;
        
        // If conversion rate is provided, also store the converted income value
        if (conversionRate !== undefined && this.taxCurrency) {
            this.incomeConversionRate = conversionRate;
            this.incomeValueInTaxCurrency = incomeValue * conversionRate;
        }
    }

    /**
     * Get the income value to report for tax purposes
     * For rewards, this is typically the FMV at time of earning
     */
    getIncomeValue(): number {
        if (!this.isReward()) {
            return 0;
        }
        return this.incomeValue ?? this.quoteSize; // Fall back to quoteSize if incomeValue not set
    }

    /**
     * Get the income value in tax currency
     */
    getIncomeValueInTaxCurrency(): number {
        if (!this.isReward()) {
            return 0;
        }
        if (this.incomeValueInTaxCurrency !== undefined) {
            return this.incomeValueInTaxCurrency;
        }
        if (this.incomeValue !== undefined && this.incomeConversionRate !== undefined) {
            return this.incomeValue * this.incomeConversionRate;
        }
        return this.taxQuoteSize ?? this.quoteSize; // Fall back to taxQuoteSize or quoteSize
    }

    /**
     * Check if this reward has explicit income tracking set
     */
    hasIncomeTracking(): boolean {
        return this.incomeValue !== undefined;
    }

    /**
     * Set tax-related fields for audit trail and tax reporting.
     * This converts the transaction's quote currency values to the tax currency.
     * 
     * @param taxCurrency The currency to use for tax calculation (e.g., 'NOK')
     * @param conversionRate Exchange rate from quoteCurrency to taxCurrency
     * @param conversionDate Date used for the exchange rate lookup
     * @param feeConversionRate Optional separate exchange rate for fee conversion (defaults to same as conversionRate)
     */
    setTaxConversion(
        taxCurrency: string,
        conversionRate: number,
        conversionDate: Date,
        feeConversionRate?: number
    ): void {
        this.taxCurrency = taxCurrency;
        this.taxConversionRate = conversionRate;
        this.taxConversionDate = conversionDate;
        
        // Convert quote size and price to tax currency
        this.taxQuoteSize = this.quoteSize * conversionRate;
        this.taxPrice = this.price * conversionRate;
        
        // Convert fee to tax currency (use separate rate if provided)
        const feeRate = feeConversionRate !== undefined ? feeConversionRate : conversionRate;
        this.taxFee = this.fee * feeRate;
        
        // Default fee currency to the fiat in the market pair if present; otherwise use quote currency
        // Only set if fee is present (> 0)
        if (!this.feeCurrency && (this.fee ?? 0) > 0) {
            const fiatInPair = isFiat(this.baseCurrency) ? this.baseCurrency : (isFiat(this.quoteCurrency) ? this.quoteCurrency : undefined);
            this.feeCurrency = fiatInPair || this.quoteCurrency;
        }
    }

    /**
     * Check if tax conversion has been applied to this transaction
     */
    hasTaxConversion(): boolean {
        return this.taxCurrency !== undefined && this.taxPrice !== undefined;
    }

    /**
     * Get the price to use for tax calculations (converted if available, original otherwise)
     */
    getTaxPrice(): number {
        return this.taxPrice !== undefined ? this.taxPrice : this.price;
    }

    /**
     * Get the fee to use for tax calculations (converted if available, original otherwise)
     */
    getTaxFee(): number {
        return this.taxFee !== undefined ? this.taxFee : this.fee;
    }
  }

export function isCryptoCryptoTransaction(transaction: Transaction): boolean {
    return !isFiat(transaction.baseCurrency) && !isFiat(transaction.quoteCurrency);
}

function isFiat(currency: string): boolean {
    const fiatCurrencies = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'JPY', 'CNY', 'AUD', 'CAD'];
    return fiatCurrencies.includes(currency.toUpperCase());
}