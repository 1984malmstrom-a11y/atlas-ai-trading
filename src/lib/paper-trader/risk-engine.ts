import type { RiskReport } from './types';
import { calculatePositionSize } from './position-sizing';
import { calculatePortfolioExposure } from './portfolio-exposure';
import { calculateDiversification } from './diversification';
import { calculateDrawdown } from './drawdown';

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
  peakPortfolioValue?: number; // optional peak for drawdown calculations
  expectedReturnPercent?: number; // optional signal input (percent)
  confidence?: number; // optional decision confidence (0-100)
  // config overrides
  maxPositionPercent?: number; // default 0.10
  dailyTradeLimit?: number; // default 5
};

export function evaluateRisk(input: RiskEngineInput): RiskReport{
  const reasons: string[] = [];
  const portfolio = input && input.portfolio ? input.portfolio : null;
  const decision = input && input.decision ? input.decision : null;

  // Basic input validation
  if (!portfolio || !decision){
    return { allowed: false, score: 0, level: 'HIGH', reasons: ['INVALID_RISK_INPUT'] };
  }


  // Validate numeric inputs: use defaults only when undefined
  let maxPositionPercent: number;
  if (input.maxPositionPercent === undefined) {
    maxPositionPercent = 0.10;
  } else {
    if (!Number.isFinite(input.maxPositionPercent) || !(input.maxPositionPercent > 0)){
      return { allowed: false, score: 0, level: 'HIGH', reasons: ['INVALID_RISK_INPUT'] };
    }
    maxPositionPercent = input.maxPositionPercent;
  }

  let dailyTradeLimit: number;
  if (input.dailyTradeLimit === undefined){
    dailyTradeLimit = 5;
  } else {
    if (!Number.isFinite(input.dailyTradeLimit) || !Number.isInteger(input.dailyTradeLimit) || input.dailyTradeLimit < 0){
      return { allowed: false, score: 0, level: 'HIGH', reasons: ['INVALID_RISK_INPUT'] };
    }
    dailyTradeLimit = input.dailyTradeLimit;
  }

  let todaysTradeCount: number;
  if (input.todaysTradeCount === undefined){
    todaysTradeCount = 0;
  } else {
    if (!Number.isFinite(input.todaysTradeCount) || !Number.isInteger(input.todaysTradeCount) || input.todaysTradeCount < 0){
      return { allowed: false, score: 0, level: 'HIGH', reasons: ['INVALID_RISK_INPUT'] };
    }
    todaysTradeCount = input.todaysTradeCount;
  }

  // portfolio availableCash and totalValue must be finite and >= 0
  if (!Number.isFinite(portfolio.availableCash) || portfolio.availableCash < 0 || !Number.isFinite(portfolio.totalValue) || portfolio.totalValue < 0){
    return { allowed: false, score: 0, level: 'HIGH', reasons: ['INVALID_RISK_INPUT'] };
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
      return { allowed: false, score: 0, level: 'HIGH', reasons: ['INVALID_RISK_INPUT'] };
    }
  }

  // Rule: Reject if daily trade limit reached
  if (todaysTradeCount >= dailyTradeLimit){
    reasons.push('DAILY_TRADE_LIMIT_REACHED');
  }

  // Rule: Reject if cash is insufficient (for BUY)
  if (decision.side === 'BUY'){
    // If the user requested a specific notional, flag insufficient cash.
    if (typeof decision.requestedNotionalSek === 'number' && Number.isFinite(decision.requestedNotionalSek) && portfolio.availableCash < decision.requestedNotionalSek){
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
            return { allowed: false, score: 0, level: 'HIGH', reasons: ['INVALID_RISK_INPUT'] };
        }
        existingMarket = existing.marketValue;
      } else {
        // validate quantity and currentPrice before using
        if (!Number.isFinite(existing.quantity) || existing.quantity < 0){
          return { allowed: false, score: 0, level: 'HIGH', reasons: ['INVALID_RISK_INPUT'] };
        }
        if (existing.currentPrice !== undefined){
          if (!Number.isFinite(existing.currentPrice) || existing.currentPrice < 0){
            return { allowed: false, score: 0, level: 'HIGH', reasons: ['INVALID_RISK_INPUT'] };
          }
          existingMarket = existing.quantity * existing.currentPrice;
        } else {
          existingMarket = 0;
        }
      }
    }

    // Use centralized position sizing to determine recommended notional and exposure
    const sizing = calculatePositionSize({ availableCash: portfolio.availableCash, totalValue: portfolio.totalValue, requestedNotionalSek: decision.requestedNotionalSek, maxPositionPercent, confidence: input.confidence });
    const exposure = calculatePortfolioExposure(portfolio);
    const intendedAdd = sizing.recommendedNotional;
    // If intended add would push the largest holding above the cap, reject
    const additionalPercent = Number.isFinite(portfolio.totalValue) && portfolio.totalValue > 0 ? (intendedAdd / portfolio.totalValue) : 0;
    const newLargestPercent = exposure.largestHoldingPercent + additionalPercent;
    if (newLargestPercent > maxPositionPercent){
      reasons.push('POSITION_SIZE_EXCEEDS_LIMIT');
    }
  }

  // Compute risk score
  let score = 100;

  // Position >10% penalty (fixed 10% threshold)
  if (decision.side === 'BUY'){
    const sizingForScoring = calculatePositionSize({ availableCash: portfolio.availableCash, totalValue: portfolio.totalValue, requestedNotionalSek: decision.requestedNotionalSek, maxPositionPercent, confidence: input.confidence });
    const exposure = calculatePortfolioExposure(portfolio);
    const intendedAdd = (typeof sizingForScoring.recommendedNotional === 'number' && Number.isFinite(sizingForScoring.recommendedNotional)) ? sizingForScoring.recommendedNotional : 0;

    // If the new largest holding percent would exceed 10%, penalize
    const additionalPercent = Number.isFinite(portfolio.totalValue) && portfolio.totalValue > 0 ? (intendedAdd / portfolio.totalValue) : 0;
    const newLargestPercent = exposure.largestHoldingPercent + additionalPercent;
    const tenPercentCapPercent = 0.10;
    if (Number.isFinite(newLargestPercent) && newLargestPercent > tenPercentCapPercent){
      score -= 40;
    }

    // Cash after buy <10% penalty using exposure.cashPercent
    const cashAfterPercent = exposure.cashPercent - additionalPercent;
    if (Number.isFinite(cashAfterPercent) && cashAfterPercent < 0.10){
      score -= 30;
    }
  }

  // Today's trades >=80% of daily limit penalty
  if (Number.isFinite(todaysTradeCount) && Number.isFinite(dailyTradeLimit) && dailyTradeLimit > 0){
    if (todaysTradeCount >= (0.8 * dailyTradeLimit)){
      score -= 20;
    }
  }

  // Diversification penalty: apply after other deductions
  const diversification = calculateDiversification(portfolio);
  if (diversification.isConcentrated) {
    score -= 15;
  }

  // Drawdown penalty: compute from provided peak or use current as peak (no drawdown)
  const peakVal = (typeof input.peakPortfolioValue === 'number' && Number.isFinite(input.peakPortfolioValue) && input.peakPortfolioValue > 0) ? input.peakPortfolioValue : portfolio.totalValue;
  const drawdown = calculateDrawdown({ currentPortfolioValue: portfolio.totalValue, peakPortfolioValue: peakVal });
  if (drawdown.isDrawdownCritical) {
    score -= 25;
  } else if (drawdown.isDrawdownWarning) {
    score -= 10;
  }

  if (score < 0) score = 0;
  if (score > 100) score = 100;

  const level: 'LOW' | 'MEDIUM' | 'HIGH' = score >= 80 ? 'LOW' : (score >= 50 ? 'MEDIUM' : 'HIGH');

  const allowed = reasons.length === 0;
  // Attach recommendedNotional, exposure, diversification and drawdown for callers
  const sizingFinal = calculatePositionSize({ availableCash: portfolio.availableCash, totalValue: portfolio.totalValue, requestedNotionalSek: decision.requestedNotionalSek, maxPositionPercent, confidence: input.confidence });
  const exposureFinal = calculatePortfolioExposure(portfolio);
  const diversificationFinal = calculateDiversification(portfolio);
  return { allowed, score, level, reasons, recommendedNotional: sizingFinal.recommendedNotional, exposure: exposureFinal, diversification: diversificationFinal, drawdown, positionSizing: { recommendedNotional: sizingFinal.recommendedNotional, confidenceAdjustedNotional: sizingFinal.confidenceAdjustedNotional } };
}

// Optional helper to use Decision Engine as final step. Uses dynamic import
// so it does not cause circular initialization problems at module load time.
// Note: DecisionEngine is intentionally separate; risk engine does not
// import or reference the decision engine to avoid coupling.
