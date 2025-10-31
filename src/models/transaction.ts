

export type TransactionType = 'TRADE' | 'STAKING_REWARD' | 'LENDING_REWARD' | 'AIRDROP' | 'MINING_REWARD' | 'FORK' | 'TRANSFER_IN' | 'TRANSFER_OUT';

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
    
    // Staking/reward specific fields
    validator?: string;      // For staking rewards
    epoch?: number;          // For staking rewards
    rewardSource?: string;   // Source of the reward (e.g., 'cardano', 'polkadot')
    sourceTransactionId?: string; // Link back to original trade when using derived legs
    leg?: 'BASE' | 'QUOTE' | 'ORIGINAL';
    processingSequence?: number;
    

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
        validator?: string,
        epoch?: number,
        rewardSource?: string
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
        this.validator = validator;
        this.epoch = epoch;
        this.rewardSource = rewardSource;
    }

    toSimpleJSON() {
        const baseInfo = {
            CCY: `${this.baseCurrency}-${this.quoteCurrency}`,
            exchange: this.exchange,
            side: this.side,
            type: this.type,
            baseSize: this.baseSize,
            price: this.price,
            fee: this.fee,
            dateTime: this.dateTime.toISOString(),
            validator: this.validator,
            epoch: this.epoch,
            rewardSource: this.rewardSource,
            sourceTransactionId: this.sourceTransactionId,
            leg: this.leg
        };

        // Add tax conversion fields if available
        if (this.hasTaxConversion()) {
            return {
                ...baseInfo,
                taxCurrency: this.taxCurrency,
                taxPrice: this.taxPrice,
                taxQuoteSize: this.taxQuoteSize,
                taxFee: this.taxFee,
                taxConversionRate: this.taxConversionRate
            };
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
        return this.isReward() || this.type === 'TRANSFER_IN';
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
        
        // Assume fee is in quote currency by default (can be overridden later)
        if (!this.feeCurrency) {
            this.feeCurrency = this.quoteCurrency;
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