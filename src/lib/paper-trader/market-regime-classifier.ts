export type MarketRegimeInput = {
  trendStrength?: number; // expected -1..1 (normalized), where positive = uptrend
  momentum?: number; // percent points (e.g., 5 => +5%)
  volatility?: number; // normalized 0..1
  priceVsMovingAverage?: number; // fraction (e.g., 0.02 => price 2% above MA)
  volumeStrength?: number; // normalized 0..1
};

export type MarketRegimeResult = {
  regime: 'STRONG_UPTREND'|'WEAK_UPTREND'|'STRONG_DOWNTREND'|'WEAK_DOWNTREND'|'RANGE_BOUND'|'HIGH_VOLATILITY'|'UNCERTAIN';
  confidence: number; // 0-100
  reasons: string[];
  riskNote?: string | null;
};

function isFiniteNumber(x:any){ return typeof x === 'number' && Number.isFinite(x); }

export function classifyMarketRegime(input: MarketRegimeInput): MarketRegimeResult{
  const ts = isFiniteNumber(input.trendStrength) ? Number(input.trendStrength) : null;
  const momentum = isFiniteNumber(input.momentum) ? Number(input.momentum) : null;
  const vol = isFiniteNumber(input.volatility) ? Number(input.volatility) : null;
  const pvma = isFiniteNumber(input.priceVsMovingAverage) ? Number(input.priceVsMovingAverage) : null;
  const volStr = isFiniteNumber(input.volumeStrength) ? Number(input.volumeStrength) : null;

  const reasons: string[] = [];

  // Validate minimal inputs
  if (ts === null && momentum === null && vol === null && pvma === null){
    return { regime: 'UNCERTAIN', confidence: 0, reasons: ['Missing all input signals'], riskNote: 'Insufficient data' };
  }

  // HIGH_VOLATILITY priority
  const VOL_THRESHOLD = 0.6;
  if (vol !== null && vol >= VOL_THRESHOLD){
    if (vol !== null) reasons.push(`volatility ${vol} >= ${VOL_THRESHOLD}`);
    const conf = Math.max(50, Math.round(Math.min(100, 80 * Math.min(1, vol / VOL_THRESHOLD))));
    return { regime: 'HIGH_VOLATILITY', confidence: conf, reasons, riskNote: 'Elevated volatility — prefer risk controls' };
  }

  // Helper to detect sign agreement/conflict
  const sign = (v:number|null) => v === null ? 0 : (v > 0 ? 1 : (v < 0 ? -1 : 0));
  const sTs = sign(ts); const sMom = sign(momentum); const sPvma = sign(pvma);

  // Contradictory signals -> UNCERTAIN
  if ( (sTs !== 0 && sMom !== 0 && sTs !== sMom) || (sTs !== 0 && sPvma !== 0 && sTs !== sPvma) || (sMom !== 0 && sPvma !== 0 && sMom !== sPvma) ){
    reasons.push('Contradictory directional signals');
    return { regime: 'UNCERTAIN', confidence: 20, reasons, riskNote: 'Signals disagree' };
  }

  // Compute a simple score for confidence
  const scoreParts: number[] = [];
  if (ts !== null) scoreParts.push(Math.min(1, Math.abs(ts)) * 60);
  if (momentum !== null) scoreParts.push(Math.min(20, Math.abs(momentum)) * 2);
  if (pvma !== null) scoreParts.push(Math.min(0.05, Math.abs(pvma)) * 400);
  if (volStr !== null) scoreParts.push(Math.min(1, Math.abs(volStr)) * 10);
  let confidence = Math.round(Math.min(100, scoreParts.reduce((s,n)=> s + n, 0)));
  // reduce confidence when volatility exists but below threshold
  if (vol !== null && vol > 0){ confidence = Math.round(confidence * (1 - Math.min(0.4, vol * 0.4))); }
  confidence = Math.max(0, Math.min(100, confidence));

  // Range-bound detection
  if ((ts === null || Math.abs(ts) < 0.3) && (momentum === null || Math.abs(momentum) < 1) && (pvma === null || Math.abs(pvma) < 0.005)){
    reasons.push('Low trend, low momentum, price near MA');
    return { regime: 'RANGE_BOUND', confidence: Math.min(60, confidence || 30), reasons, riskNote: 'Limited directional edge' };
  }

  // Uptrend / Downtrend classification
  // Strong thresholds
  const strongTrend = ts !== null && Math.abs(ts) >= 0.7;
  const weakTrend = ts !== null && Math.abs(ts) >= 0.3 && Math.abs(ts) < 0.7;
  const strongMomentum = momentum !== null && Math.abs(momentum) >= 5;
  const weakMomentum = momentum !== null && Math.abs(momentum) >= 1 && Math.abs(momentum) < 5;
  const pvmaStrong = pvma !== null && Math.abs(pvma) >= 0.02;
  const pvmaWeak = pvma !== null && Math.abs(pvma) >= 0.005 && Math.abs(pvma) < 0.02;

  // Positive direction
  const dir = (sTs !== 0) ? sTs : (sMom !== 0 ? sMom : (sPvma !== 0 ? sPvma : 0));

  if (dir > 0){
    if (strongTrend || strongMomentum || pvmaStrong){ reasons.push('Bullish signals: strong trend/momentum/price>MA'); return { regime: 'STRONG_UPTREND', confidence: Math.max(60, confidence), reasons, riskNote: 'Bias towards long positions' }; }
    if (weakTrend || weakMomentum || pvmaWeak){ reasons.push('Bullish signals: weak trend/momentum/price slightly above MA'); return { regime: 'WEAK_UPTREND', confidence: Math.max(40, confidence), reasons, riskNote: 'Mild bullish bias' }; }
  }

  if (dir < 0){
    if (strongTrend || strongMomentum || pvmaStrong){ reasons.push('Bearish signals: strong downtrend/momentum/price<MA'); return { regime: 'STRONG_DOWNTREND', confidence: Math.max(60, confidence), reasons, riskNote: 'Bias towards defensive posture' }; }
    if (weakTrend || weakMomentum || pvmaWeak){ reasons.push('Bearish signals: weak downtrend/momentum/price slightly below MA'); return { regime: 'WEAK_DOWNTREND', confidence: Math.max(40, confidence), reasons, riskNote: 'Mild bearish bias' }; }
  }

  // Fallback uncertain
  reasons.push('Signals insufficient to determine clear regime');
  return { regime: 'UNCERTAIN', confidence: Math.max(10, confidence), reasons, riskNote: 'Ambiguous signals' };
}

export default classifyMarketRegime;
