import { Portfolio } from '../portfolio/types';
import { evaluateDecision } from '../../lib/paper-trader/decision-engine';
import { evaluateTrade } from '../../lib/paper-trader/trade-evaluation';

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
  evaluation?: {
    pnlSek: number;
    pnlPercent: number;
    winner: boolean;
  };
}

export type FailureCode =
  | 'INVALID_QUANTITY'
  | 'INSUFFICIENT_CASH'
  | 'POSITION_LIMIT_EXCEEDED'
  | 'HOLDING_NOT_FOUND'
  | 'INSUFFICIENT_HOLDING'
  | 'INVALID_PRICE';

export type TradeSuccess = { success: true; transaction: Execution; portfolio: Portfolio; risk?: { score: number; level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] } };
export type TradeFailure = { success: false; code: FailureCode; message: string; portfolio: Portfolio; risk?: { score: number; level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] } };
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
    let lastRiskReport: { score: number; level: 'LOW'|'MEDIUM'|'HIGH'; reasons: string[] } | undefined = undefined;
    let evaluationObj: { pnlSek: number; pnlPercent: number; winner: boolean } | undefined = undefined;

    // SELL checks
    if (order.side === 'Sälj') {
      const holding = original.holdings.find(h => h.symbol === order.symbol);
      if (!holding) return { success: false, code: 'HOLDING_NOT_FOUND', message: 'Innehav saknas', portfolio: original };
      if (holding.quantity < order.quantity) return { success: false, code: 'INSUFFICIENT_HOLDING', message: 'Otillräckligt antal att sälja', portfolio: original };
      // proceed to create new portfolio immutably
    }

    // BUY checks
    if (order.side === 'Köp') {
      // Run risk engine first
      const decisionResult = evaluateDecision({
        portfolio: { availableCash: original.availableCash, totalValue: original.totalValue, holdings: original.holdings.map(h => ({ symbol: h.symbol, quantity: h.quantity, currentPrice: h.currentPrice, marketValue: h.marketValue })) },
        decision: { side: 'BUY', symbol: order.symbol, quantity: order.quantity, notional },
        todaysTradeCount: 0,
      });

      const riskReport = decisionResult.risk;

      if (!riskReport.allowed) {
        // If the only reason for denial is SIGNAL_HOLD, treat as non-blocking for this demo engine
        // (keeps backward-compatible behavior for small demo buys in tests).
        const onlyHold = Array.isArray(riskReport.reasons) && riskReport.reasons.length === 1 && riskReport.reasons[0] === 'SIGNAL_HOLD';
        if (!onlyHold){
          // map some common reasons to failure codes; use POSITION_LIMIT_EXCEEDED as default
          let code: FailureCode = 'POSITION_LIMIT_EXCEEDED';
          if (riskReport.reasons.includes('INSUFFICIENT_CASH')) code = 'INSUFFICIENT_CASH';
          if (riskReport.reasons.includes('INVALID_RISK_INPUT')) code = 'INVALID_QUANTITY';
          return { success: false, code, message: 'Blocked by risk engine', portfolio: original, risk: { score: riskReport.score, level: riskReport.level, reasons: riskReport.reasons } };
        }
      }

      lastRiskReport = { score: riskReport.score, level: riskReport.level, reasons: riskReport.reasons };

      const existingMarketValue = original.holdings.find(h => h.symbol === order.symbol)?.marketValue || 0;
      const projectedMarketValue = notional + existingMarketValue;
      if (!this.evaluatePositionLimit(projectedMarketValue)) return { success: false, code: 'POSITION_LIMIT_EXCEEDED', message: 'Positionsgräns överskrids', portfolio: original, risk: lastRiskReport };
      const cost = notional + fee;
      if (cost > original.availableCash) return { success: false, code: 'INSUFFICIENT_CASH', message: 'Otillräckligt saldo', portfolio: original, risk: lastRiskReport };
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
      const existingBefore = original.holdings.find(h => h.symbol === order.symbol);
      const existing = newPortfolio.holdings.find(h => h.symbol === order.symbol)!;
      const prevQty = existingBefore ? existingBefore.quantity : 0;
      const prevAvg = existingBefore && typeof existingBefore.averagePrice === 'number' ? existingBefore.averagePrice : null;
      existing.quantity = Math.max(0, existing.quantity - order.quantity);
      existing.currentPrice = executedPrice;
      existing.marketValue = existing.quantity * existing.currentPrice;
      const proceed = Math.max(0, notional - fee);
      newPortfolio.availableCash += proceed;
      // If position fully closed (no remaining quantity) and we have cost-basis, evaluate trade
      let evaluationObj: { pnlSek: number; pnlPercent: number; winner: boolean } | undefined = undefined;
      if ((existing.quantity === 0 || prevQty === order.quantity) && prevAvg !== null) {
        evaluationObj = evaluateTrade({ entryPrice: prevAvg, exitPrice: executedPrice, quantity: order.quantity });
      }
    }

    // Recalculate total value
    newPortfolio.totalValue = newPortfolio.holdings.reduce((s, it) => s + it.marketValue, 0) + newPortfolio.availableCash;

    const transaction: Execution = { orderId: order.id, executedPrice, quantity: order.quantity, fee };
    // attach evaluation object if we computed one above
    try{
      if (typeof evaluationObj !== 'undefined' && evaluationObj !== null){
        (transaction as any).evaluation = evaluationObj;
      }
    }catch(_){ }

    const successResult: any = { success: true, transaction, portfolio: newPortfolio };
    if (lastRiskReport !== undefined) successResult.risk = lastRiskReport;
    return successResult as TradeResult;
  }
}
