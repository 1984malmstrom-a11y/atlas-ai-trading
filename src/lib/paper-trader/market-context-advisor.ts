export type MarketRegimeAdviceInput = {
  marketRegime?: { regime?: string; confidence?: number; reasons?: string[]; riskNote?: string | null } | null;
  technicalScore?: number | null; // 0-100
  momentum?: number | null; // percent
  volatility?: number | null; // 0-1
  trendStrength?: number | null; // -1..1
};

export type MarketContextAdvice = {
  outlook: 'FAVORABLE_LONG'|'FAVORABLE_SHORT'|'NEUTRAL'|'CAUTION'|'HIGH_RISK'|'INSUFFICIENT_DATA';
  confidence: number; // 0-100
  recommendation: string; // short guidance
  cautions: string[];
  supportingReasons: string[]; // always at least one
};

function clamp01(n:number){ return Math.max(0, Math.min(100, Math.round(n))); }

// Pure deterministic advisor that uses MarketRegime output and optional technical inputs.
export function buildMarketContextAdvice(input: MarketRegimeAdviceInput): MarketContextAdvice{
  const mr = input && input.marketRegime ? input.marketRegime : null;
  const techScore = typeof input.technicalScore === 'number' && Number.isFinite(input.technicalScore) ? input.technicalScore : null;
  const momentum = typeof input.momentum === 'number' && Number.isFinite(input.momentum) ? input.momentum : null;
  const vol = typeof input.volatility === 'number' && Number.isFinite(input.volatility) ? input.volatility : null;
  const trend = typeof input.trendStrength === 'number' && Number.isFinite(input.trendStrength) ? input.trendStrength : null;

  const reasons: string[] = [];
  const cautions: string[] = [];

  if (!mr || !mr.regime){
    reasons.push('Market regime missing');
    return { outlook: 'INSUFFICIENT_DATA', confidence: 0, recommendation: 'Insufficient data to form market context', cautions: ['No market regime available'], supportingReasons: reasons };
  }

  // base confidence derived from classifier confidence when present
  const baseConf = (typeof mr.confidence === 'number' && Number.isFinite(mr.confidence)) ? clamp01(mr.confidence) : 40;
  reasons.push(`Regime:${mr.regime}`);
  if (mr.reasons && Array.isArray(mr.reasons) && mr.reasons.length) reasons.push(...mr.reasons.slice(0,3));

  // volatility-driven overrides
  if (mr.regime === 'HIGH_VOLATILITY' || (vol !== null && vol >= 0.6)){
    // if other signals are strongly aligned (e.g., strong trend and high techScore), allow CAUTION instead
    const strongDirectional = (trend !== null && Math.abs(trend) >= 0.7) || (techScore !== null && techScore >= 80) || (momentum !== null && Math.abs(momentum) >= 8);
    if (strongDirectional){
      cautions.push('High volatility but strong directional signals observed');
      const conf = clamp01(Math.max(baseConf, 50));
      return { outlook: 'CAUTION', confidence: conf, recommendation: 'Proceed with caution; prefer reduced size and tighter risk controls', cautions, supportingReasons: reasons };
    }
    cautions.push('Elevated volatility');
    const conf = clamp01(Math.max(baseConf, 60));
    return { outlook: 'HIGH_RISK', confidence: conf, recommendation: 'High volatility — avoid initiating new directional positions', cautions, supportingReasons: reasons };
  }

  // Range bound
  if (mr.regime === 'RANGE_BOUND'){
    const conf = clamp01(Math.max(baseConf, 30));
    reasons.push('Price near moving average, low momentum');
    return { outlook: 'NEUTRAL', confidence: conf, recommendation: 'Prefer non-directional or wait-for-breakout', cautions, supportingReasons: reasons };
  }

  // Strong up/down trends
  if (mr.regime === 'STRONG_UPTREND' || mr.regime === 'WEAK_UPTREND'){
    const conf = clamp01(baseConf + (techScore !== null ? Math.round((techScore - 50) * 0.2) : 0));
    const outlook = (mr.regime === 'STRONG_UPTREND' || (techScore !== null && techScore >= 70)) ? 'FAVORABLE_LONG' : 'NEUTRAL';
    if (outlook !== 'NEUTRAL') reasons.push('Directional bias: bullish'); else reasons.push('Weak bullish evidence');
    return { outlook, confidence: conf, recommendation: outlook === 'FAVORABLE_LONG' ? 'Bias towards long opportunities' : 'No clear actionable bias', cautions, supportingReasons: reasons };
  }

  if (mr.regime === 'STRONG_DOWNTREND' || mr.regime === 'WEAK_DOWNTREND'){
    const conf = clamp01(baseConf + (techScore !== null ? Math.round((techScore - 50) * 0.2) : 0));
    const outlook = (mr.regime === 'STRONG_DOWNTREND' || (techScore !== null && techScore >= 70)) ? 'FAVORABLE_SHORT' : 'NEUTRAL';
    if (outlook !== 'NEUTRAL') reasons.push('Directional bias: bearish'); else reasons.push('Weak bearish evidence');
    return { outlook, confidence: conf, recommendation: outlook === 'FAVORABLE_SHORT' ? 'Bias towards short/defensive opportunities' : 'No clear actionable bias', cautions, supportingReasons: reasons };
  }

  if (mr.regime === 'UNCERTAIN'){
    reasons.push('Classifier flagged uncertain regime');
    return { outlook: 'INSUFFICIENT_DATA', confidence: clamp01(Math.max(10, baseConf)), recommendation: 'Signals are contradictory or insufficient', cautions: ['Signals disagree'], supportingReasons: reasons };
  }

  // fallback
  return { outlook: 'NEUTRAL', confidence: clamp01(baseConf), recommendation: 'No strong market context', cautions, supportingReasons: reasons };
}

export default buildMarketContextAdvice;
