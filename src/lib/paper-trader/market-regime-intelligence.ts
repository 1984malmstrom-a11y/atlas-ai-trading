// Market Regime Intelligence - pure, deterministic, typed
import { HistoricalMarketContextSnapshot } from './historical-market-context';

export type MarketRegime =
  | 'BULL_TREND'
  | 'BEAR_TREND'
  | 'SIDEWAYS'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'MEAN_REVERSION'
  | 'BREAKOUT'
  | 'RISK_ON'
  | 'RISK_OFF'
  | 'UNKNOWN';

export type MarketQuality = 'COMPLETE' | 'LIMITED' | 'INSUFFICIENT';

export type MarketRegimeResult = {
  regime: MarketRegime;
  confidence: number; // 0..1
  strength: number; // -1..1 (signed strength where applicable)
  supportingSignals: string[];
  reasoning: string[];
  quality: MarketQuality;
  observedAt: string | null;
};

export type MarketRegimeInput = {
  // any subset of these may be provided; context preferred when available
  context?: HistoricalMarketContextSnapshot;
  // explicit overrides (useful for tests)
  shortTrend?: HistoricalMarketContextSnapshot['shortTrend'];
  mediumTrend?: HistoricalMarketContextSnapshot['mediumTrend'];
  longTrend?: HistoricalMarketContextSnapshot['longTrend'];
  volatilityState?: HistoricalMarketContextSnapshot['volatilityState'];
  momentumPersistence?: HistoricalMarketContextSnapshot['momentumPersistence'];
  momentumScore?: number | null;
  currentDrawdownPercent?: number | null;
  maxDrawdownPercent?: number | null;
  rangePosition?: number | null; // 0..1
  volumeTrend?: HistoricalMarketContextSnapshot['volumeTrend'];
  observationCount?: number;
  dataQuality?: MarketQuality;
};

function clamp01(v: number){ return Math.max(0, Math.min(1, v)); }

function normalizeStrength(v: number){ // map -1..1 to -1..1 but keep safe
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

export function detectMarketRegime(input: MarketRegimeInput): MarketRegimeResult {
  // Pure deterministic extraction without mutation
  const ctx = input.context;
  const shortTrend = input.shortTrend ?? (ctx ? ctx.shortTrend : 'INSUFFICIENT');
  const mediumTrend = input.mediumTrend ?? (ctx ? ctx.mediumTrend : 'INSUFFICIENT');
  const longTrend = input.longTrend ?? (ctx ? ctx.longTrend : 'INSUFFICIENT');
  const volatilityState = input.volatilityState ?? (ctx ? ctx.volatilityState : 'INSUFFICIENT');
  const momentumPersistence = input.momentumPersistence ?? (ctx ? ctx.momentumPersistence : 'INSUFFICIENT');
  const momentumScore = input.momentumScore ?? (ctx ? (ctx as any).momentumScore ?? null : null);
  const currentDrawdownPercent = input.currentDrawdownPercent ?? (ctx ? ctx.currentDrawdownPercent ?? null : null);
  const maxDrawdownPercent = input.maxDrawdownPercent ?? (ctx ? ctx.maxDrawdownPercent ?? null : null);
  const rangePosition = input.rangePosition ?? (ctx ? ctx.rangePosition ?? null : null);
  const volumeTrend = input.volumeTrend ?? (ctx ? ctx.volumeTrend : 'UNAVAILABLE');
  const observationCount = input.observationCount ?? (ctx ? ctx.observationCount : 0);
  const quality = input.dataQuality ?? (ctx ? ctx.dataQuality : (observationCount >= 60 ? 'COMPLETE' : observationCount >= 20 ? 'LIMITED' : 'INSUFFICIENT'));
  const observedAt = ctx ? ctx.observedAt : null;

  const signals: string[] = [];

  // Trend numeric: UP=+1, DOWN=-1, SIDEWAYS=0
  const trToNum = (t: typeof shortTrend) => (t === 'UP' ? 1 : t === 'DOWN' ? -1 : 0);
  const longW = 0.5, medW = 0.3, shortW = 0.2;
  const trendScore = (trToNum(longTrend) * longW) + (trToNum(mediumTrend) * medW) + (trToNum(shortTrend) * shortW);

  if (longTrend !== 'INSUFFICIENT') signals.push(`long:${longTrend}`);
  if (mediumTrend !== 'INSUFFICIENT') signals.push(`medium:${mediumTrend}`);
  if (shortTrend !== 'INSUFFICIENT') signals.push(`short:${shortTrend}`);

  // Volatility numeric mapping
  const volMap: Record<string, number> = { HIGH: 1, EXPANDING: 0.8, NORMAL: 0.2, CONTRACTING: -0.2, LOW: -0.8, INSUFFICIENT: 0 } as any;
  const volScore = volMap[volatilityState] ?? 0;
  if (volatilityState !== 'INSUFFICIENT') signals.push(`volatility:${volatilityState}`);

  // Momentum numeric
  const momMap: Record<string, number> = { STRONG: 1, MODERATE: 0.6, WEAK: 0.2, REVERSING: -0.9, INSUFFICIENT: 0 } as any;
  const momScore = momentumScore !== null && Number.isFinite(momentumScore) ? Math.max(-1, Math.min(1, momentumScore)) : momMap[momentumPersistence] ?? 0;
  if (momentumPersistence !== 'INSUFFICIENT') signals.push(`momentum:${momentumPersistence}`);

  if (typeof rangePosition === 'number') signals.push(`range:${Number(rangePosition.toFixed(3))}`);
  if (volumeTrend !== 'UNAVAILABLE') signals.push(`volume:${volumeTrend}`);
  if (currentDrawdownPercent !== null) signals.push(`drawdown:${Number(currentDrawdownPercent.toFixed(3))}`);

  // Compose a combined signed strength (-1..1)
  // weights chosen to prefer trend and momentum, penalize volatility and drawdown
  let combined = 0;
  combined += trendScore * 0.6; // trend dominant
  combined += momScore * 0.25;
  combined += volScore * -0.15; // high vol reduces signed bullishness
  if (currentDrawdownPercent !== null) combined += (Math.max(-1, Math.min(0, -currentDrawdownPercent / 100))) * 0.2; // drawdown negative
  combined = normalizeStrength(combined);

  const absStrength = Math.abs(combined);

  // Confidence: function of |combined|, data quality and observation count
  const qualityFactor = quality === 'COMPLETE' ? 1 : quality === 'LIMITED' ? 0.8 : 0.45;
  const obsBonus = observationCount >= 60 ? 0.35 : observationCount >= 20 ? 0.12 : 0.02;
  const confidence = clamp01(Number((absStrength * 0.75 + obsBonus) * qualityFactor).toFixed(3) as any as number);

  const reasoning: string[] = [];
  if (absStrength > 0.5) reasoning.push('Strong directional signal from trend and momentum');
  else if (absStrength > 0.2) reasoning.push('Moderate directional signal');
  else reasoning.push('No clear directional bias');
  if (volatilityState === 'HIGH') reasoning.push('Elevated volatility');
  if (momentumPersistence === 'REVERSING') reasoning.push('Momentum reversal detected');
  if (currentDrawdownPercent !== null && currentDrawdownPercent > 15) reasoning.push('Significant recent drawdown');

  // Decision rules (deterministic rule set)
  let regime: MarketRegime = 'UNKNOWN';
  if (quality === 'INSUFFICIENT') {
    regime = 'UNKNOWN';
  } else if (volatilityState === 'HIGH' && absStrength < 0.25) {
    regime = 'HIGH_VOLATILITY';
  } else if (volatilityState === 'LOW' && absStrength < 0.25) {
    // If trends explicitly SIDEWAYS prefer mean-reversion, otherwise expose low-volatility
    if (longTrend === 'SIDEWAYS' && mediumTrend === 'SIDEWAYS' && shortTrend === 'SIDEWAYS') regime = 'MEAN_REVERSION';
    else regime = 'LOW_VOLATILITY';
  } else if (combined >= 0.35) {
    // bullish family
    if (volumeTrend === 'RISING' && typeof rangePosition === 'number' && rangePosition > 0.88) regime = 'BREAKOUT';
    else regime = 'BULL_TREND';
  } else if (combined <= -0.35) {
    if (volumeTrend === 'RISING' && typeof rangePosition === 'number' && rangePosition < 0.12) regime = 'BREAKOUT';
    else regime = 'BEAR_TREND';
  } else if (absStrength < 0.2) {
    // range-bound family
    if (volatilityState === 'LOW') regime = 'MEAN_REVERSION';
    else regime = 'SIDEWAYS';
  } else {
    // mixed signals: risk flags
    if (combined > 0) regime = 'RISK_ON';
    else regime = 'RISK_OFF';
  }

  const supportingSignals = signals.slice();

  return {
    regime,
    confidence: Number(confidence.toFixed(3)),
    strength: Number(combined.toFixed(3)),
    supportingSignals,
    reasoning,
    quality,
    observedAt: observedAt ?? null,
  };
}

export default { detectMarketRegime };
