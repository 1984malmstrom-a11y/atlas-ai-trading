import type { RiskReport } from './types';
import { calculatePositionSize } from './position-sizing';
import { calculatePortfolioExposure } from './portfolio-exposure';
import { calculateDiversification } from './diversification';
import { calculateDrawdown } from './drawdown';

export type AssetCategory = 'Stock' | 'Forex' | 'Commodity' | 'Unknown';

// Map a holding/instrument `assetType` string to a normalized AssetCategory.
export function mapAssetTypeToCategory(assetType?: string): AssetCategory{
  if (!assetType) return 'Unknown';
  const t = String(assetType).toUpperCase();
  if (t.includes('FOREX')) return 'Forex';
  if (t.includes('COMMODITY')) return 'Commodity';
  if (t.includes('STOCK') || t.includes('ETF')) return 'Stock';
  return 'Unknown';
}

// Detect category for a symbol from a PortfolioSnapshot by inspecting holdings.assetType when present.
export function detectAssetCategory(portfolio: PortfolioSnapshot | null, symbol?: string): AssetCategory{
  try{
    if (!portfolio || !symbol) return 'Unknown';
    const sym = String(symbol).toUpperCase();
    if (!Array.isArray(portfolio.holdings)) return 'Unknown';
    const found = portfolio.holdings.find(h => (h && (h.symbol||'').toString().toUpperCase() === sym));
    if (!found) return 'Unknown';
    // If holding exposes assetType, map it; otherwise Unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const at = (found as any).assetType;
    return mapAssetTypeToCategory(typeof at === 'string' ? at : undefined);
  }catch(_){ return 'Unknown'; }
}

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
  adaptiveDecisionContext?: any;
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

  // --- Asset category awareness (new helper) ---
  // Determine asset category for the decision symbol using portfolio holdings when available.
  const assetCategory = detectAssetCategory(portfolio, (decision && decision.symbol) ? decision.symbol : '');

  // Compute risk score
  let score = 100;

  // Position >10% penalty (fixed 10% threshold)
  if (decision.side === 'BUY'){
    // Use sizing logic per asset category (currently identical behavior across categories)
    let sizingForScoring: any;
    switch (assetCategory){
      case 'Forex':
      case 'Commodity':
      case 'Stock':
      default:
          sizingForScoring = calculatePositionSize({ availableCash: portfolio.availableCash, totalValue: portfolio.totalValue, requestedNotionalSek: decision.requestedNotionalSek, maxPositionPercent, confidence: input.confidence });
        break;
    }
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

  // Preserve original risk before adaptive adjustments
  const originalRisk = score;
  const effectiveRisk = applyAdaptiveRiskPolicy(typeof originalRisk === 'number' ? originalRisk : 0, (input as any).adaptiveDecisionContext);

  const level: 'LOW' | 'MEDIUM' | 'HIGH' = score >= 80 ? 'LOW' : (score >= 50 ? 'MEDIUM' : 'HIGH');

  const allowed = reasons.length === 0;
  // Attach recommendedNotional, exposure, diversification and drawdown for callers
    const sizingFinal = calculatePositionSize({ availableCash: portfolio.availableCash, totalValue: portfolio.totalValue, requestedNotionalSek: decision.requestedNotionalSek, maxPositionPercent, confidence: effectiveRisk });
    try{ (sizingFinal as any).originalRisk = originalRisk; (sizingFinal as any).effectiveRisk = effectiveRisk; }catch(_){ }
  const exposureFinal = calculatePortfolioExposure(portfolio);
  const diversificationFinal = calculateDiversification(portfolio);
    // Apply adaptive position size policy immediately after sizingFinal is produced
    const originalPositionSize = typeof sizingFinal.confidenceAdjustedNotional === 'number' && Number.isFinite(sizingFinal.confidenceAdjustedNotional) ? sizingFinal.confidenceAdjustedNotional : sizingFinal.recommendedNotional;
    const effectivePositionSize = applyAdaptivePositionSizePolicy(originalPositionSize, (input as any).adaptiveDecisionContext, sizingFinal.recommendedNotional);
    // Override confidenceAdjustedNotional so execution uses effectivePositionSize while preserving original/effective separately
    const positionSizing = { recommendedNotional: sizingFinal.recommendedNotional, confidenceAdjustedNotional: effectivePositionSize, originalPositionSize, effectivePositionSize } as any;
    return { allowed, score, level, reasons, recommendedNotional: sizingFinal.recommendedNotional, exposure: exposureFinal, diversification: diversificationFinal, drawdown, positionSizing };
}

// Apply adaptive risk policy: deterministic, uses only adaptiveDecisionContext.riskBias,
// clamps bias to +/-0.20 (fractional), applies multiplicative adjustment and clamps to 0-100
export function applyAdaptiveRiskPolicy(originalRisk: number, adaptiveDecisionContext: any){
  let orig = typeof originalRisk === 'number' && !Number.isNaN(originalRisk) ? originalRisk : 0;
  const bias = (adaptiveDecisionContext && typeof adaptiveDecisionContext.riskBias === 'number') ? Number(adaptiveDecisionContext.riskBias) : 0;
  const limitedBias = Math.max(-0.2, Math.min(0.2, bias));
  let adjusted = orig * (1 + limitedBias);
  adjusted = Math.max(0, Math.min(100, adjusted));
  adjusted = Math.round(adjusted * 100) / 100;
  return adjusted;
}

// Apply adaptive position size policy: deterministic, uses only confidenceBias and riskBias from adaptiveDecisionContext
// - confidenceBias adjusts size by up to +/-10% (confidenceBias in points -> fraction by /100)
// - riskBias adjusts size by up to +/-15% (interpret riskBias as fraction)
// - combined adjustment limited to +/-20%
// - final size clamped to engine limit passed as maxAllowed (recommendedNotional)
export function applyAdaptivePositionSizePolicy(originalPositionSize: number, adaptiveDecisionContext: any, maxAllowed: number){
  let orig = typeof originalPositionSize === 'number' && !Number.isNaN(originalPositionSize) ? originalPositionSize : 0;
  const cb = (adaptiveDecisionContext && typeof adaptiveDecisionContext.confidenceBias === 'number') ? Number(adaptiveDecisionContext.confidenceBias) : 0;
  // confidenceBias is expressed in percentage points (e.g., 5 -> 5 points), convert to fraction
  let confFrac = cb / 100;
  // limit confidence adjustment to +/-10%
  confFrac = Math.max(-0.10, Math.min(0.10, confFrac));
  let adjusted = orig * (1 + confFrac);
  // Clamp to engine limits
  const maxAllowedSafe = (typeof maxAllowed === 'number' && Number.isFinite(maxAllowed) && maxAllowed >= 0) ? maxAllowed : orig;
  adjusted = Math.max(0, Math.min(maxAllowedSafe, adjusted));
  // Deterministic rounding to 2 decimals
  adjusted = Math.round(adjusted * 100) / 100;
  return adjusted;
}

// Optional helper to use Decision Engine as final step. Uses dynamic import
// so it does not cause circular initialization problems at module load time.
// Note: DecisionEngine is intentionally separate; risk engine does not
// import or reference the decision engine to avoid coupling.
