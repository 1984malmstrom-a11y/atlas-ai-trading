export type RiskDecision = { allowed: boolean; reasons: string[] };

export type PortfolioSnapshot = {
  availableCash: number;
  totalValue: number;
  holdings?: Array<{ symbol: string; quantity: number; averagePrice?: number; currentPrice?: number; marketValue?: number }>;
};

export type TradeDecision = {
  side: 'BUY' | 'SELL';
  symbol: string;
  quantity?: number;
  requestedNotionalSek?: number; // preferred notional for buys
  notional?: number; // explicit notional
  referencePrice?: number;
};

export type RiskEngineInput = {
  portfolio: PortfolioSnapshot;
  decision: TradeDecision;
  // optional runtime stats
  todaysTradeCount?: number;
  // config overrides
  maxPositionPercent?: number; // default 0.10
  dailyTradeLimit?: number; // default 5
};

export function evaluateRisk(input: RiskEngineInput): RiskDecision{
  const reasons: string[] = [];
  const portfolio = input && input.portfolio ? input.portfolio : null;
  const decision = input && input.decision ? input.decision : null;

  // Basic input validation
  if (!portfolio || !decision){
    return { allowed: false, reasons: ['INVALID_RISK_INPUT'] };
  }


  // Validate numeric inputs: use defaults only when undefined
  let maxPositionPercent: number;
  if (input.maxPositionPercent === undefined) {
    maxPositionPercent = 0.10;
  } else {
    if (!Number.isFinite(input.maxPositionPercent) || !(input.maxPositionPercent > 0)){
      return { allowed: false, reasons: ['INVALID_RISK_INPUT'] };
    }
    maxPositionPercent = input.maxPositionPercent;
  }

  let dailyTradeLimit: number;
  if (input.dailyTradeLimit === undefined){
    dailyTradeLimit = 5;
  } else {
    if (!Number.isFinite(input.dailyTradeLimit) || !Number.isInteger(input.dailyTradeLimit) || input.dailyTradeLimit < 0){
      return { allowed: false, reasons: ['INVALID_RISK_INPUT'] };
    }
    dailyTradeLimit = input.dailyTradeLimit;
  }

  let todaysTradeCount: number;
  if (input.todaysTradeCount === undefined){
    todaysTradeCount = 0;
  } else {
    if (!Number.isFinite(input.todaysTradeCount) || !Number.isInteger(input.todaysTradeCount) || input.todaysTradeCount < 0){
      return { allowed: false, reasons: ['INVALID_RISK_INPUT'] };
    }
    todaysTradeCount = input.todaysTradeCount;
  }

  // portfolio availableCash and totalValue must be finite and >= 0
  if (!Number.isFinite(portfolio.availableCash) || portfolio.availableCash < 0 || !Number.isFinite(portfolio.totalValue) || portfolio.totalValue < 0){
    reasons.push('INVALID_RISK_INPUT');
    return { allowed: false, reasons };
  }

  // Determine notional for this decision
  let notional: number | null = null;
  if (typeof decision.notional === 'number' && Number.isFinite(decision.notional)) {
    notional = decision.notional;
  } else if (typeof decision.requestedNotionalSek === 'number' && Number.isFinite(decision.requestedNotionalSek)){
    notional = decision.requestedNotionalSek;
  } else if (typeof decision.quantity === 'number' && typeof decision.referencePrice === 'number'){
    if (!Number.isFinite(decision.quantity) || !Number.isFinite(decision.referencePrice) || decision.quantity <= 0 || decision.referencePrice <= 0){
      // quantity/ref invalid -> notional remains null and will be rejected for BUY
      notional = null;
    } else {
      const computed = decision.quantity * decision.referencePrice;
      if (!Number.isFinite(computed) || computed <= 0) {
        notional = null;
      } else {
        notional = computed;
      }
    }
  }

  // For BUY, notional must be a finite > 0
  if (decision.side === 'BUY'){
    if (!(typeof notional === 'number' && Number.isFinite(notional) && notional > 0)){
      return { allowed: false, reasons: ['INVALID_RISK_INPUT'] };
    }
  }

  // Rule: Reject if daily trade limit reached
  if (todaysTradeCount >= dailyTradeLimit){
    reasons.push('DAILY_TRADE_LIMIT_REACHED');
  }

  // Rule: Reject if cash is insufficient (for BUY)
  if (decision.side === 'BUY'){
    if (Number.isFinite(notional) && portfolio.availableCash < (notional as number)){
      reasons.push('INSUFFICIENT_CASH');
    }
  }

  // Rule: Reject if position value exceeds max percent (for BUY)
  if (decision.side === 'BUY'){
    const sym = (decision.symbol||'').toUpperCase();
    const existing = Array.isArray(portfolio.holdings) ? portfolio.holdings.find(h => (h.symbol||'').toUpperCase() === sym) : null;

    let existingMarket = 0;
    if (existing){
      if (existing.marketValue !== undefined){
        if (!Number.isFinite(existing.marketValue) || existing.marketValue < 0){
          return { allowed: false, reasons: ['INVALID_RISK_INPUT'] };
        }
        existingMarket = existing.marketValue;
      } else {
        // validate quantity and currentPrice before using
        if (!Number.isFinite(existing.quantity) || existing.quantity < 0){
          return { allowed: false, reasons: ['INVALID_RISK_INPUT'] };
        }
        if (existing.currentPrice !== undefined){
          if (!Number.isFinite(existing.currentPrice) || existing.currentPrice < 0){
            return { allowed: false, reasons: ['INVALID_RISK_INPUT'] };
          }
          existingMarket = existing.quantity * existing.currentPrice;
        } else {
          existingMarket = 0;
        }
      }
    }

    const intendedAdd = Number.isFinite(notional as number) ? notional as number : 0;
    const newPositionValue = existingMarket + intendedAdd;
    const cap = Number.isFinite(portfolio.totalValue) ? (portfolio.totalValue * maxPositionPercent) : null;
    if (cap !== null && newPositionValue > cap){
      reasons.push('POSITION_SIZE_EXCEEDS_LIMIT');
    }
  }

  return { allowed: reasons.length === 0, reasons };
}
