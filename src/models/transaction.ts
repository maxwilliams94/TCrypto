

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
    quoteSizeNative?: number;
    nativeCurrency?: string;
    baseSizeRemaining?: number;
    soldOn?: Date;
    
    // Staking/reward specific fields
    validator?: string;      // For staking rewards
    epoch?: number;          // For staking rewards
    rewardSource?: string;   // Source of the reward (e.g., 'cardano', 'polkadot')
    

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
        this.baseSizeRemaining = baseSize;
        this.validator = validator;
        this.epoch = epoch;
        this.rewardSource = rewardSource;
    }

    toSimpleJSON() {
        return {
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
            rewardSource: this.rewardSource
        };
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
  }

export function isCryptoCryptoTransaction(transaction: Transaction): boolean {
    return !isFiat(transaction.baseCurrency) && !isFiat(transaction.quoteCurrency);
}

function isFiat(currency: string): boolean {
    const fiatCurrencies = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'JPY', 'CNY', 'AUD', 'CAD'];
    return fiatCurrencies.includes(currency.toUpperCase());
}