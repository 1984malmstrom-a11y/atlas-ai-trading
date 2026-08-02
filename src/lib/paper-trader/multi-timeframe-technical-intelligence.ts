import { IntradayCandle } from './intraday-market-context';

// Multi-timeframe Technical Intelligence
export type Timeframe = '5min' | '15min' | '1h' | '4h' | '1day';

export type TFIndicators = {
  timeframe: Timeframe;
  observedAt: string | null;
  isFresh: boolean;
  pointCount: number;
  trend: 'STRONG_UP'|'UP'|'SIDEWAYS'|'DOWN'|'STRONG_DOWN'|'UNKNOWN';
  momentum: 'STRONG_POSITIVE'|'POSITIVE'|'NEUTRAL'|'NEGATIVE'|'STRONG_NEGATIVE'|'UNKNOWN';
  volatility: 'LOW'|'NORMAL'|'HIGH'|'EXTREME'|'UNKNOWN';
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  distanceFromEma20Percent: number | null;
  distanceFromEma50Percent: number | null;
  distanceFromEma200Percent: number | null;
  rsi14: number | null;
  atr14: number | null;
  atrPercent: number | null;
  recentSwingHigh: number | null;
  recentSwingLow: number | null;
  supportLevel: number | null;
  resistanceLevel: number | null;
  rangePosition: number | null; // 0..1
  warnings: string[];
};

export type MultiTimeframeTechnicalIntelligence = {
  schemaVersion: 1;
  source: 'VICTOR_MULTI_TIMEFRAME_TECHNICAL_INTELLIGENCE';
  symbol: string;
  assetType: string;
  generatedAt: string;
  observedAt: string | null;
  expiresAt: string | null;
  isFresh: boolean;
  coverage: 'COMPLETE'|'LIMITED'|'INSUFFICIENT'|'UNAVAILABLE';
  quality: 'COMPLETE'|'LIMITED'|'INSUFFICIENT';
  confidence: number; // 0..1
  strength: 'STRONG'|'MODERATE'|'WEAK'|'INSUFFICIENT';
  timeframes: TFIndicators[];
  shortTermTrend: TFIndicators['trend'] | null;
  mediumTermTrend: TFIndicators['trend'] | null;
  longTermTrend: TFIndicators['trend'] | null;
  trendAgreement: 'ALIGNED_BULLISH'|'ALIGNED_BEARISH'|'MIXED'|'CONFLICTING'|'INSUFFICIENT';
  momentumAgreement: 'ALIGNED_POSITIVE'|'ALIGNED_NEGATIVE'|'MIXED'|'INSUFFICIENT';
  volatilityRegime: 'LOW'|'NORMAL'|'HIGH'|'UNKNOWN';
  supportResistancePosition: 'NEAR_SUPPORT'|'MID_RANGE'|'NEAR_RESISTANCE'|'BREAKOUT'|'BREAKDOWN'|'UNKNOWN';
  higherTimeframeBias: 'BULLISH'|'BEARISH'|'NEUTRAL'|'UNKNOWN';
  supportingSignals: string[];
  conflictingSignals: string[];
  summary: string | null;
  missingCapabilities: string[];
  warnings: string[];
};

function isFiniteNum(v:any): v is number { return typeof v === 'number' && Number.isFinite(v); }
function toIso(d: Date){ return d.toISOString(); }
function clamp01(v:number){ return Math.max(0, Math.min(1, v)); }

// EMA simple; returns null if not enough points
function ema(values: number[], period: number): number | null {
  if (!Array.isArray(values) || values.length < period) return null;
  // start with SMA
  let sma = 0; for (let i=0;i<period;i++) sma += values[i]; sma = sma / period;
  const k = 2/(period+1);
  let prev = sma;
  for (let i=period;i<values.length;i++){ prev = values[i]*k + prev*(1-k); }
  return Number(prev);
}

// RSI Wilder implementation
function rsi14(values: number[]): number | null {
  if (!Array.isArray(values) || values.length < 15) return null;
  let gains = 0, losses = 0;
  for (let i=1;i<=14;i++){ const diff = values[i] - values[i-1]; if (diff > 0) gains += diff; else losses += -diff; }
  let avgGain = gains/14, avgLoss = losses/14;
  for (let i=15;i<values.length;i++){ const diff = values[i] - values[i-1]; avgGain = (avgGain*13 + (diff>0?diff:0))/14; avgLoss = (avgLoss*13 + (diff<0?-diff:0))/14; }
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss; const rsi = 100 - (100/(1+rs)); return Number(Math.max(0, Math.min(100, rsi)).toFixed(3));
}

// ATR 14
function atr14(highs:number[], lows:number[], closes:number[]): number | null {
  if (!Array.isArray(highs) || highs.length < 2) return null;
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < 2) return null;
  const trs: number[] = [];
  for (let i=1;i<n;i++){ const tr = Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])); trs.push(tr); }
  if (trs.length < 14) return null;
  // Wilder's average
  let sum = 0; for (let i=0;i<14;i++) sum += trs[i]; let prev = sum/14;
  for (let i=14;i<trs.length;i++) prev = (prev*13 + trs[i]) / 14;
  return Number(prev);
}

function recentHighLow(closes:number[], lookback:number){ if (!Array.isArray(closes) || closes.length === 0) return { high:null, low:null }; const slice = closes.slice(-lookback); return { high: Math.max(...slice), low: Math.min(...slice) }; }

export function buildMultiTimeframeTechnicalIntelligence(opts: { symbol: string; assetType?: string; candlesByTimeframe?: Record<Timeframe, IntradayCandle[]>; now?: Date; observedAt?: string | null }): MultiTimeframeTechnicalIntelligence {
  const now = opts.now || new Date(); const generatedAt = toIso(now);
  const sym = String(opts.symbol || '').toUpperCase(); const at = String(opts.assetType || 'STOCK').toUpperCase();
  const tfList: Timeframe[] = ['5min','15min','1h','4h','1day'];
  const timeframes: TFIndicators[] = [];
  const candlesByTimeframe = opts.candlesByTimeframe || {} as Record<Timeframe, IntradayCandle[]>;
  for (const tf of tfList){ const c = Array.isArray(candlesByTimeframe[tf]) ? candlesByTimeframe[tf].slice() : []; // defensive copy
    const closes = c.map(x=> x.close).filter(isFiniteNum);
    const highs = c.map(x=> x.high).filter(isFiniteNum);
    const lows = c.map(x=> x.low).filter(isFiniteNum);
    const pointCount = closes.length;
    const observedAt = c.length ? (c[c.length-1].timestamp || null) : null;
    const freshnessMs = { '5min': 12*60*1000, '15min': 32*60*1000, '1h': 90*60*1000, '4h': 5*60*60*1000, '1day': 48*60*60*1000 } as Record<Timeframe, number>;
    const lastTs = observedAt ? new Date(observedAt).getTime() : 0; const isFresh = observedAt ? (now.getTime() - lastTs <= (freshnessMs[tf]||0)) : false;
    const ema20 = ema(closes, 20); const ema50 = ema(closes, 50); const ema200 = ema(closes, 200);
    const lastClose = closes.length ? closes[closes.length-1] : null;
    const distanceFromEma20Percent = (lastClose !== null && ema20 !== null && ema20 !== 0) ? Number(((lastClose - ema20)/ema20*100).toFixed(3)) : null;
    const distanceFromEma50Percent = (lastClose !== null && ema50 !== null && ema50 !== 0) ? Number(((lastClose - ema50)/ema50*100).toFixed(3)) : null;
    const distanceFromEma200Percent = (lastClose !== null && ema200 !== null && ema200 !== 0) ? Number(((lastClose - ema200)/ema200*100).toFixed(3)) : null;
    const rsi = closes.length ? rsi14(closes) : null;
    const atr = atr14(highs, lows, closes);
    const atrPercent = (atr !== null && lastClose !== null && lastClose !== 0) ? Number((atr / lastClose * 100).toFixed(3)) : null;
    const swings = recentHighLow(closes, Math.min(60, closes.length));
    const supportLevel = swings.low === null ? null : swings.low;
    const resistanceLevel = swings.high === null ? null : swings.high;
    const rangePosition = (supportLevel !== null && resistanceLevel !== null && resistanceLevel !== supportLevel && lastClose !== null) ? Number(((lastClose - supportLevel) / (resistanceLevel - supportLevel)).toFixed(6)) : null;
    // trend & momentum heuristics
    let trend: TFIndicators['trend'] = 'UNKNOWN';
    if (ema20 !== null && ema50 !== null && ema200 !== null && lastClose !== null){
      const bullScore = (lastClose > ema20 ? 1 : 0) + (ema20 > ema50 ? 1 : 0) + (ema50 > ema200 ? 1 : 0);
      if (bullScore >= 3) trend = 'STRONG_UP'; else if (bullScore === 2) trend = 'UP'; else if (bullScore === 1) trend = 'SIDEWAYS'; else trend = 'DOWN';
      // strong down check
      const bearScore = (lastClose < ema20 ? 1 : 0) + (ema20 < ema50 ? 1 : 0) + (ema50 < ema200 ? 1 : 0);
      if (bearScore >= 3) trend = 'STRONG_DOWN';
    } else if (pointCount > 0) trend = 'SIDEWAYS';
    let momentum: TFIndicators['momentum'] = 'UNKNOWN';
    if (rsi !== null){ if (rsi >= 70) momentum = 'STRONG_POSITIVE'; else if (rsi >= 55) momentum = 'POSITIVE'; else if (rsi > 45) momentum = 'NEUTRAL'; else if (rsi > 30) momentum = 'NEGATIVE'; else momentum = 'STRONG_NEGATIVE'; }
    let volatility: TFIndicators['volatility'] = 'UNKNOWN';
    if (atrPercent !== null){ if (atrPercent >= 3) volatility = 'EXTREME'; else if (atrPercent >= 1.5) volatility = 'HIGH'; else if (atrPercent >= 0.5) volatility = 'NORMAL'; else volatility = 'LOW'; }
    const warnings: string[] = [];
    if (pointCount < 15) warnings.push('INSUFFICIENT_POINTS');
    timeframes.push({ timeframe: tf, observedAt: observedAt || null, isFresh, pointCount, trend, momentum, volatility, ema20: ema20 === null ? null : Number(ema20), ema50: ema50 === null ? null : Number(ema50), ema200: ema200 === null ? null : Number(ema200), distanceFromEma20Percent, distanceFromEma50Percent, distanceFromEma200Percent, rsi14: rsi, atr14: atr, atrPercent, recentSwingHigh: swings.high === null ? null : swings.high, recentSwingLow: swings.low === null ? null : swings.low, supportLevel, resistanceLevel, rangePosition, warnings });
  }

  // Combine conclusions (short=5min/15min, medium=1h, long=1day)
  const tfMap = new Map(timeframes.map(t=> [t.timeframe, t]));
  const shortTerm = tfMap.get('5min') || tfMap.get('15min') || null;
  const mediumTerm = tfMap.get('1h') || null;
  const longTerm = tfMap.get('1day') || null;
  function mapTrendToBias(tr: TFIndicators['trend'] | null){ if (!tr) return 'UNKNOWN'; if (tr === 'STRONG_UP' || tr === 'UP') return 'BULLISH'; if (tr === 'STRONG_DOWN' || tr === 'DOWN') return 'BEARISH'; return 'NEUTRAL'; }
  const higherTimeframeBias = mapTrendToBias(longTerm ? longTerm.trend : null);
  // trendAgreement: naive majority across short/medium/long
  const trends = [shortTerm ? shortTerm.trend : null, mediumTerm ? mediumTerm.trend : null, longTerm ? longTerm.trend : null].filter(x=> x !== null) as TFIndicators['trend'][];
  let trendAgreement: MultiTimeframeTechnicalIntelligence['trendAgreement'] = 'INSUFFICIENT';
  if (trends.length === 3){ const bulls = trends.filter(t=> t === 'STRONG_UP' || t === 'UP').length; const bears = trends.filter(t=> t === 'STRONG_DOWN' || t === 'DOWN').length; if (bulls === 3) trendAgreement = 'ALIGNED_BULLISH'; else if (bears === 3) trendAgreement = 'ALIGNED_BEARISH'; else if (bulls > 0 && bears > 0) trendAgreement = 'CONFLICTING'; else trendAgreement = 'MIXED'; }

  const coverage = timeframes.filter(t=> t.pointCount > 0).length >= 3 ? 'COMPLETE' : timeframes.filter(t=> t.pointCount > 0).length >= 1 ? 'LIMITED' : 'UNAVAILABLE';
  const quality = coverage === 'COMPLETE' ? 'COMPLETE' : coverage === 'LIMITED' ? 'LIMITED' : 'INSUFFICIENT';
  const confidence = clamp01((timeframes.filter(t=> t.isFresh && t.pointCount >= 15).length) / 5);
  const strengthLabel: MultiTimeframeTechnicalIntelligence['strength'] = confidence >= 0.75 ? 'STRONG' : confidence >= 0.4 ? 'MODERATE' : 'WEAK';
  const supportingSignals: string[] = [];
  const missingCapabilities: string[] = [];
  if (timeframes.every(t=> t.pointCount < 15)) missingCapabilities.push('INSUFFICIENT_CANDLES');

  const out: MultiTimeframeTechnicalIntelligence = {
    schemaVersion: 1,
    source: 'VICTOR_MULTI_TIMEFRAME_TECHNICAL_INTELLIGENCE',
    symbol: sym,
    assetType: at,
    generatedAt,
    observedAt: null,
    expiresAt: null,
    isFresh: timeframes.some(t=> t.isFresh),
    coverage,
    quality,
    confidence,
    strength: strengthLabel,
    timeframes,
    shortTermTrend: shortTerm ? shortTerm.trend : null,
    mediumTermTrend: mediumTerm ? mediumTerm.trend : null,
    longTermTrend: longTerm ? longTerm.trend : null,
    trendAgreement,
    momentumAgreement: 'INSUFFICIENT',
    volatilityRegime: 'UNKNOWN',
    supportResistancePosition: 'UNKNOWN',
    higherTimeframeBias: higherTimeframeBias as any,
    supportingSignals,
    conflictingSignals: [],
    summary: null,
    missingCapabilities,
    warnings: [],
  };
  return out;
}

export function sanitizeMultiTimeframeTechnicalIntelligenceForState(s: MultiTimeframeTechnicalIntelligence){
  const copy = JSON.parse(JSON.stringify(s)) as MultiTimeframeTechnicalIntelligence;
  copy.supportingSignals = Array.isArray(copy.supportingSignals) ? copy.supportingSignals.slice(0,8) : [];
  copy.conflictingSignals = Array.isArray(copy.conflictingSignals) ? copy.conflictingSignals.slice(0,8) : [];
  copy.missingCapabilities = Array.isArray(copy.missingCapabilities) ? copy.missingCapabilities.slice(0,10) : [];
  copy.warnings = Array.isArray(copy.warnings) ? copy.warnings.slice(0,10) : [];
  copy.timeframes = Array.isArray(copy.timeframes) ? copy.timeframes.map(t=> ({ ...t, warnings: Array.isArray(t.warnings) ? t.warnings.slice(0,5) : [] })).slice(0,5) : [] as any;
  return copy;
}

export function buildMultiTimeframeTechnicalReadiness(s: MultiTimeframeTechnicalIntelligence){
  return { ready: s.quality === 'COMPLETE' && s.confidence >= 0.5, checkedAt: new Date().toISOString(), symbol: s.symbol };
}

// Per-cycle resolver factory
export function createPerCycleTechnicalIntelligenceResolver(opts?: { getCandles?: (symbol:string, timeframe: Timeframe)=>Promise<IntradayCandle[]|null>, appendAudit?: (p:any)=>Promise<void>, updateState?: (symbol:string, snap:any)=>void }){
  const cache = new Map<string, Promise<MultiTimeframeTechnicalIntelligence | null>>();
  async function build(symbol: string, assetType?: string){
    const key = `${String(symbol).toUpperCase()}|${String(assetType||'')}`;
    if (cache.has(key)) return cache.get(key) as Promise<MultiTimeframeTechnicalIntelligence | null>;
    const p = (async ()=>{
      try{
        const tfList: Timeframe[] = ['5min','15min','1h','4h','1day'];
        const candlesByTimeframe: Record<Timeframe, IntradayCandle[]> = {} as any;
        for (const tf of tfList){ try{ const res = opts && typeof opts.getCandles === 'function' ? await opts!.getCandles(String(symbol).toUpperCase(), tf) : null; candlesByTimeframe[tf] = Array.isArray(res) ? res.slice() : []; }catch(_){ candlesByTimeframe[tf] = []; } }
        const snap = buildMultiTimeframeTechnicalIntelligence({ symbol, assetType, candlesByTimeframe, now: new Date() });
        try{ if (opts && typeof opts.appendAudit === 'function') await opts.appendAudit({ kind: 'MULTI_TIMEFRAME_TECHNICAL_INTELLIGENCE_SNAPSHOT', symbol: snap.symbol, generatedAt: snap.generatedAt, coverage: snap.coverage, quality: snap.quality, confidence: snap.confidence, trendAgreement: snap.trendAgreement, higherTimeframeBias: snap.higherTimeframeBias, volatilityRegime: snap.volatilityRegime, warnings: snap.warnings.slice(0,5) }).catch(()=>{}); }catch(_){ }
        try{ if (opts && typeof opts.updateState === 'function') opts.updateState(String(symbol).toUpperCase(), sanitizeMultiTimeframeTechnicalIntelligenceForState(snap)); }catch(_){ }
        return snap;
      }catch(e){ return null; }
    })();
    cache.set(key, p);
    return p;
  }
  return { build, cache } as const;
}

export default { buildMultiTimeframeTechnicalIntelligence, sanitizeMultiTimeframeTechnicalIntelligenceForState, buildMultiTimeframeTechnicalReadiness, createPerCycleTechnicalIntelligenceResolver };
