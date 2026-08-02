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
  const momentumScore = input.momentumScore ?? (ctx ? (ctx as unknown as Record<string, unknown>).momentumScore as number | null ?? null : null);
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
  const volMap: Record<string, number> = { HIGH: 1, EXPANDING: 0.8, NORMAL: 0.2, CONTRACTING: -0.2, LOW: -0.8, INSUFFICIENT: 0 };
  const volScore = volMap[volatilityState] ?? 0;
  if (volatilityState !== 'INSUFFICIENT') signals.push(`volatility:${volatilityState}`);

  // Momentum numeric
  const momMap: Record<string, number> = { STRONG: 1, MODERATE: 0.6, WEAK: 0.2, REVERSING: -0.9, INSUFFICIENT: 0 };
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
  const confidence = clamp01(Number(Number((absStrength * 0.75 + obsBonus) * qualityFactor).toFixed(3)));

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

// --- Intelligence contract and adapter ---

export type VolatilityRegime = 'HIGH'|'NORMAL'|'LOW'|'EXPANDING'|'CONTRACTING'|'UNKNOWN';
export type RiskRegime = 'RISK_ON'|'RISK_OFF'|'NEUTRAL'|'UNKNOWN';
export type StrengthLabel = 'STRONG'|'MODERATE'|'WEAK'|'INSUFFICIENT';

export type MarketRegimeIntelligenceSnapshot = {
  schemaVersion: 1;
  source: 'VICTOR_MARKET_REGIME_INTELLIGENCE';
  symbol: string;
  observedAt: string | null;
  generatedAt: string;

  primaryRegime: 'BULL_TREND'|'BEAR_TREND'|'SIDEWAYS'|'BREAKOUT'|'MEAN_REVERSION'|'UNKNOWN';
  volatilityRegime: VolatilityRegime;
  riskRegime: RiskRegime;

  confidence: number; // 0..1
  strength: StrengthLabel;
  quality: 'COMPLETE'|'LIMITED'|'INSUFFICIENT';

  supportingSignals: readonly string[];
  conflictingSignals: readonly string[];
  reasoning: readonly string[];
  warnings: readonly string[];
};

export type BuildMarketRegimeIntelligenceInput = {
  symbol: string;
  historicalContext?: HistoricalMarketContextSnapshot;
  now?: Date;
};

function mapPrimary(reg: MarketRegime): MarketRegimeIntelligenceSnapshot['primaryRegime']{
  if (reg === 'BULL_TREND') return 'BULL_TREND';
  if (reg === 'BEAR_TREND') return 'BEAR_TREND';
  if (reg === 'SIDEWAYS') return 'SIDEWAYS';
  if (reg === 'BREAKOUT') return 'BREAKOUT';
  if (reg === 'MEAN_REVERSION') return 'MEAN_REVERSION';
  return 'UNKNOWN';
}

function mapVolatility(v: HistoricalMarketContextSnapshot['volatilityState']): VolatilityRegime{
  if (!v) return 'UNKNOWN';
  if (v === 'HIGH' || v === 'EXPANDING') return 'HIGH';
  if (v === 'CONTRACTING' || v === 'LOW') return 'LOW';
  if (v === 'NORMAL') return 'NORMAL';
  return 'UNKNOWN';
}

function mapRisk(reg: MarketRegime): RiskRegime{
  if (reg === 'RISK_ON') return 'RISK_ON';
  if (reg === 'RISK_OFF') return 'RISK_OFF';
  return 'NEUTRAL';
}

function labelStrength(s: number): StrengthLabel{
  const a = Math.abs(Number(s||0));
  if (!Number.isFinite(a) || a <= 0.05) return 'INSUFFICIENT';
  if (a >= 0.6) return 'STRONG';
  if (a >= 0.25) return 'MODERATE';
  return 'WEAK';
}

export function buildMarketRegimeIntelligence(input: BuildMarketRegimeIntelligenceInput): MarketRegimeIntelligenceSnapshot {
  const now = input.now instanceof Date ? input.now : new Date();
  const generatedAt = now.toISOString();
  const symbol = String(input.symbol || '').toUpperCase();
  const ctx = input.historicalContext;

  // Reuse detectMarketRegime by translating historical context into its input shape
  const dm = detectMarketRegime({
    context: ctx,
    observationCount: ctx ? ctx.observationCount : 0,
    dataQuality: ctx ? (ctx.dataQuality as unknown as 'COMPLETE'|'LIMITED'|'INSUFFICIENT') : 'INSUFFICIENT'
  });

  const primaryRegime = mapPrimary(dm.regime);
  const volatilityRegime = mapVolatility(ctx ? ctx.volatilityState : 'INSUFFICIENT');
  const riskRegime = mapRisk(dm.regime);

  const warningsSet = new Set<string>(Array.isArray(ctx && ctx.warnings) ? ctx!.warnings.slice() : []);
  if (!ctx || ctx.observationCount < 20) warningsSet.add('INSUFFICIENT_HISTORY');

  const supporting = Array.isArray(dm.supportingSignals) ? Array.from(new Set(dm.supportingSignals)).sort() : [];
  const conflicting: string[] = []; // placeholder: detection module currently doesn't flag explicit conflicts

  const snap: MarketRegimeIntelligenceSnapshot = {
    schemaVersion: 1,
    source: 'VICTOR_MARKET_REGIME_INTELLIGENCE',
    symbol,
    observedAt: ctx ? ctx.observedAt : null,
    generatedAt,
    primaryRegime,
    volatilityRegime,
    riskRegime,
    confidence: Number(Number(dm.confidence || 0).toFixed(3)),
    strength: labelStrength(dm.strength),
    quality: ctx ? ctx.dataQuality : 'INSUFFICIENT',
    supportingSignals: supporting,
    conflictingSignals: conflicting,
    reasoning: Array.isArray(dm.reasoning) ? dm.reasoning.slice(0,5) : [],
    warnings: Array.from(warningsSet).sort()
  };
  return snap;
}

export function buildMarketRegimeIntelligenceAudit(cycleId: string, snap: MarketRegimeIntelligenceSnapshot): Record<string, unknown>{
  return {
    kind: 'MARKET_REGIME_INTELLIGENCE_SNAPSHOT',
    cycleId,
    schemaVersion: snap.schemaVersion,
    source: snap.source,
    symbol: snap.symbol,
    observedAt: snap.observedAt,
    generatedAt: snap.generatedAt,
    primaryRegime: snap.primaryRegime,
    volatilityRegime: snap.volatilityRegime,
    riskRegime: snap.riskRegime,
    confidence: snap.confidence,
    strength: snap.strength,
    quality: snap.quality,
    supportingSignals: snap.supportingSignals,
    conflictingSignals: snap.conflictingSignals,
    reasoning: snap.reasoning.slice(0,5),
    warnings: snap.warnings.slice(0,10)
  };
}

export function sanitizeIntelligenceForState(snap: MarketRegimeIntelligenceSnapshot){
  return {
    ...snap,
    supportingSignals: Array.isArray(snap.supportingSignals) ? snap.supportingSignals.slice() : [],
    conflictingSignals: Array.isArray(snap.conflictingSignals) ? snap.conflictingSignals.slice() : [],
    reasoning: Array.isArray(snap.reasoning) ? snap.reasoning.slice(0,5) : [],
    warnings: Array.isArray(snap.warnings) ? snap.warnings.slice(0,10) : []
  } as MarketRegimeIntelligenceSnapshot;
}
