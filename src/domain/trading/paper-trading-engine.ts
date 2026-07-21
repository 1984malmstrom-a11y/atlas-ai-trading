import { Portfolio } from '../portfolio/types';

export type Order = {
  id: string;
  symbol: string;
  side: 'Köp' | 'Sälj';
  quantity: number;
  price?: number; // limit or executed
}

export type Execution = {
  orderId: string;
  executedPrice: number;
  quantity: number;
  fee: number;
}

export type FailureCode =
  | 'INVALID_QUANTITY'
  | 'INSUFFICIENT_CASH'
  | 'POSITION_LIMIT_EXCEEDED'
  | 'HOLDING_NOT_FOUND'
  | 'INSUFFICIENT_HOLDING'
  | 'INVALID_PRICE';

export type TradeSuccess = { success: true; transaction: Execution; portfolio: Portfolio };
export type TradeFailure = { success: false; code: FailureCode; message: string; portfolio: Portfolio };
export type TradeResult = TradeSuccess | TradeFailure;

export class PaperTradingEngine {
  feePercent = 0.0005;
  slippageMin = 0.0001;
  slippageMax = 0.001;
  // position limit as fraction of total value
  positionLimit = 0.10;

  constructor(private readonly portfolio: Portfolio){}

  private evaluatePositionLimit(marketValue: number){
    return marketValue <= this.portfolio.totalValue * this.positionLimit;
  }

  simulateExecution(order: Order): TradeResult {
    // Validate quantity
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
      return { success: false, code: 'INVALID_QUANTITY', message: 'Ogiltig kvantitet', portfolio: this.portfolio };
    }

    const marketPrice = order.price || 100;
    if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
      return { success: false, code: 'INVALID_PRICE', message: 'Ogiltigt pris', portfolio: this.portfolio };
    }

    const slippage = marketPrice * (this.slippageMin + Math.random() * (this.slippageMax - this.slippageMin));
    const executedPrice = order.side === 'Köp' ? marketPrice + slippage : marketPrice - slippage;
    const notional = executedPrice * order.quantity;
    const fee = Math.abs(notional) * this.feePercent;

    // Copy original portfolio for failures to return unchanged portfolio
    const original = this.portfolio;

    // SELL checks
    if (order.side === 'Sälj') {
      const holding = original.holdings.find(h => h.symbol === order.symbol);
      if (!holding) return { success: false, code: 'HOLDING_NOT_FOUND', message: 'Innehav saknas', portfolio: original };
      if (holding.quantity < order.quantity) return { success: false, code: 'INSUFFICIENT_HOLDING', message: 'Otillräckligt antal att sälja', portfolio: original };
      // proceed to create new portfolio immutably
    }

    // BUY checks
    if (order.side === 'Köp') {
      const existingMarketValue = original.holdings.find(h => h.symbol === order.symbol)?.marketValue || 0;
      const projectedMarketValue = notional + existingMarketValue;
      if (!this.evaluatePositionLimit(projectedMarketValue)) return { success: false, code: 'POSITION_LIMIT_EXCEEDED', message: 'Positionsgräns överskrids', portfolio: original };
      const cost = notional + fee;
      if (cost > original.availableCash) return { success: false, code: 'INSUFFICIENT_CASH', message: 'Otillräckligt saldo', portfolio: original };
    }

    // Build new immutable portfolio
    const newPortfolio: Portfolio = JSON.parse(JSON.stringify(original));

    if (order.side === 'Köp') {
      // deduct cash
      newPortfolio.availableCash = Math.max(0, newPortfolio.availableCash - (notional + fee));
      // merge or add holding
      const existing = newPortfolio.holdings.find(h => h.symbol === order.symbol);
      if (existing) {
        const newQty = existing.quantity + order.quantity;
        existing.averagePrice = ((existing.averagePrice * existing.quantity) + (executedPrice * order.quantity)) / newQty;
        existing.quantity = newQty;
        existing.currentPrice = executedPrice;
        existing.marketValue = existing.quantity * existing.currentPrice;
      } else {
        newPortfolio.holdings.push({
          id: `h_${order.symbol}`,
          symbol: order.symbol,
          name: order.symbol,
          assetType: 'Stock',
          quantity: order.quantity,
          averagePrice: executedPrice,
          currentPrice: executedPrice,
          marketValue: order.quantity * executedPrice,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          portfolioWeight: 0,
        } as any);
      }
    } else {
      // Sell
      const existing = newPortfolio.holdings.find(h => h.symbol === order.symbol)!;
      existing.quantity = Math.max(0, existing.quantity - order.quantity);
      existing.currentPrice = executedPrice;
      existing.marketValue = existing.quantity * existing.currentPrice;
      const proceed = Math.max(0, notional - fee);
      newPortfolio.availableCash += proceed;
    }

    // Recalculate total value
    newPortfolio.totalValue = newPortfolio.holdings.reduce((s, it) => s + it.marketValue, 0) + newPortfolio.availableCash;

    const transaction: Execution = { orderId: order.id, executedPrice, quantity: order.quantity, fee };
    return { success: true, transaction, portfolio: newPortfolio };
  }
}
