import { Portfolio } from '../portfolio/types';
import { evaluateDecision } from '../../lib/paper-trader/decision-engine';
import { evaluateTrade } from '../../lib/paper-trader/trade-evaluation';

export type Order = {
  id: string;
  symbol: string;
  side: 'Köp' | 'Sälj';
  quantity: number;
  price?: number; // limit or executed
  expectedReturnPercent?: number;
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
    // intermediate vars for BUY adjustments
    let tentativeQty: number = 0;
    let confidenceAdjustedNotional: number = NaN;
    let existingMarketValue: number = 0;
    let decisionRiskReport: any = null;

    // SELL checks
    if (order.side === 'Sälj') {
      const holding = original.holdings.find(h => h.symbol === order.symbol);
      if (!holding) return { success: false, code: 'HOLDING_NOT_FOUND', message: 'Innehav saknas', portfolio: original };
      if (holding.quantity < order.quantity) return { success: false, code: 'INSUFFICIENT_HOLDING', message: 'Otillräckligt antal att sälja', portfolio: original };
      // proceed to create new portfolio immutably
    }

    // BUY checks
    if (order.side === 'Köp') {
      // Validate expectedReturnPercent provided by Victor via typed order flow
      if (!Number.isFinite((order as any).expectedReturnPercent)) {
        return { success: false, code: 'INVALID_QUANTITY', message: 'Missing or invalid expectedReturnPercent', portfolio: original };
      }
      const expectedReturnPercent = (order as any).expectedReturnPercent as number;

      // Run decision engine first, passing through expectedReturnPercent
      const decisionResult = evaluateDecision({
        portfolio: { availableCash: original.availableCash, totalValue: original.totalValue, holdings: original.holdings.map(h => ({ symbol: h.symbol, quantity: h.quantity, currentPrice: h.currentPrice, marketValue: h.marketValue })) },
        decision: { side: 'BUY', symbol: order.symbol, quantity: order.quantity, notional },
        todaysTradeCount: 0,
        expectedReturnPercent,
      });

      const riskReport = decisionResult.risk;
      decisionRiskReport = riskReport;

      if (!riskReport.allowed) {
        // Deny BUY when risk engine indicates not allowed (including SIGNAL_HOLD).
        let code: FailureCode = 'POSITION_LIMIT_EXCEEDED';
        if (riskReport.reasons.includes('INSUFFICIENT_CASH')) code = 'INSUFFICIENT_CASH';
        if (riskReport.reasons.includes('INVALID_RISK_INPUT')) code = 'INVALID_QUANTITY';
        return { success: false, code, message: 'Blocked by risk engine', portfolio: original, risk: { score: riskReport.score, level: riskReport.level, reasons: riskReport.reasons } };
      }

      lastRiskReport = { score: riskReport.score, level: riskReport.level, reasons: riskReport.reasons };

      existingMarketValue = original.holdings.find(h => h.symbol === order.symbol)?.marketValue || 0;

      // Use confidence-adjusted notional from risk.positionSizing when available
      confidenceAdjustedNotional = riskReport.positionSizing && typeof riskReport.positionSizing.confidenceAdjustedNotional === 'number' ? Number(riskReport.positionSizing.confidenceAdjustedNotional) : NaN;

      const baselinePrice = marketPrice;
      const requestedQty = Number.isFinite(order.quantity as number) ? Number(order.quantity) : Infinity;
      if (Number.isFinite(confidenceAdjustedNotional)) {
        if (confidenceAdjustedNotional > 0) {
          const maxQtyByConfidence = confidenceAdjustedNotional / baselinePrice;
          tentativeQty = Math.max(0, Math.min(requestedQty, maxQtyByConfidence));
        } else {
          // explicit zero or negative sized notional -> deny
          return { success: false, code: 'INVALID_QUANTITY', message: 'Blocked by position sizing (invalid adjusted notional)', portfolio: original, risk: lastRiskReport };
        }
      } else {
        // missing/undefined sizing -> deny
        return { success: false, code: 'INVALID_QUANTITY', message: 'Blocked by position sizing (missing adjusted notional)', portfolio: original, risk: lastRiskReport };
      }
      if (tentativeQty <= 0) {
        return { success: false, code: 'INVALID_QUANTITY', message: 'Blocked by position sizing (zero quantity)', portfolio: original, risk: lastRiskReport };
      }

      // We'll re-evaluate affordability and position limits after computing the actual executedPrice (with slippage and fees)
    }

    // At this point compute final BUY quantities/notional based on tentativeQty and the actual executedPrice/slippage
    let finalQty = order.quantity;
    let finalNotional = notional;
    let finalFee = fee;
    if (order.side === 'Köp'){
      // tentativeQty was computed above; use executedPrice to compute notional
      // Note: executedPrice was computed earlier (marketPrice +/- slippage)
      // Recompute tentative notional and cap by confidenceAdjustedNotional
      const recomputedNotional = tentativeQty * executedPrice;
      const cappedNotional = (Number.isFinite(confidenceAdjustedNotional) && confidenceAdjustedNotional > 0) ? Math.min(recomputedNotional, confidenceAdjustedNotional) : recomputedNotional;
      finalQty = Math.max(0, cappedNotional / executedPrice);
      finalNotional = finalQty * executedPrice;
      finalFee = Math.abs(finalNotional) * this.feePercent;

      // Ensure final cost fits available cash; if not, reduce quantity
      const cost = finalNotional + finalFee;
      if (cost > original.availableCash){
        const maxAffordableQty = original.availableCash / (executedPrice * (1 + this.feePercent));
        finalQty = Math.min(finalQty, maxAffordableQty);
        finalNotional = finalQty * executedPrice;
        finalFee = Math.abs(finalNotional) * this.feePercent;
      }

      // Check position limit with finalNotional
      const projectedMarketValue = finalNotional + existingMarketValue;
      if (!this.evaluatePositionLimit(projectedMarketValue)) return { success: false, code: 'POSITION_LIMIT_EXCEEDED', message: 'Positionsgräns överskrids', portfolio: original, risk: lastRiskReport };

      if (!Number.isFinite(finalQty) || finalQty <= 0){
        return { success: false, code: 'INVALID_QUANTITY', message: 'Blocked by position sizing (no affordable quantity)', portfolio: original, risk: lastRiskReport };
      }
    }

    // Build new immutable portfolio
    const newPortfolio: Portfolio = JSON.parse(JSON.stringify(original));

    if (order.side === 'Köp') {
      // deduct cash using final notional and fee
      newPortfolio.availableCash = Math.max(0, newPortfolio.availableCash - (finalNotional + finalFee));
      // merge or add holding using finalQty
      const existing = newPortfolio.holdings.find(h => h.symbol === order.symbol);
      if (existing) {
        const newQty = existing.quantity + finalQty;
        existing.averagePrice = ((existing.averagePrice * existing.quantity) + (executedPrice * finalQty)) / newQty;
        existing.quantity = newQty;
        existing.currentPrice = executedPrice;
        existing.marketValue = existing.quantity * existing.currentPrice;
      } else {
        newPortfolio.holdings.push({
          id: `h_${order.symbol}`,
          symbol: order.symbol,
          name: order.symbol,
          assetType: 'Stock',
          quantity: finalQty,
          averagePrice: executedPrice,
          currentPrice: executedPrice,
          marketValue: finalQty * executedPrice,
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

    const transaction: Execution = { orderId: order.id, executedPrice, quantity: order.side === 'Köp' ? finalQty : order.quantity, fee: order.side === 'Köp' ? finalFee : fee };
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
