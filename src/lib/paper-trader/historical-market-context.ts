// Historical Market Context builder for Victor
// Implements typed HistoricalMarketContext and deterministic, pure computations

export type HistoricalTrendDirection = 'UP' | 'DOWN' | 'SIDEWAYS' | 'INSUFFICIENT';
export type HistoricalVolatilityState = 'LOW' | 'NORMAL' | 'HIGH' | 'EXPANDING' | 'CONTRACTING' | 'INSUFFICIENT';
export type HistoricalMomentumPersistence = 'STRONG' | 'MODERATE' | 'WEAK' | 'REVERSING' | 'INSUFFICIENT';
export type HistoricalDataQuality = 'COMPLETE' | 'LIMITED' | 'INSUFFICIENT';

export type HistoricalMarketContext = {
  schemaVersion: 1;
  source: 'VICTOR_HISTORICAL_MARKET_CONTEXT';
  symbol: string;
  observedAt: string | null;
  generatedAt: string;

  observationCount: number;
  hasVolume: boolean;
  dataQuality: HistoricalDataQuality;
  missingCapabilities: string[];

  shortTrend: HistoricalTrendDirection;
  mediumTrend: HistoricalTrendDirection;
  longTrend: HistoricalTrendDirection;
  trendAgreement: number;

  volatilityState: HistoricalVolatilityState;
  currentVolatility: number | null;
  previousVolatility: number | null;

  momentumPersistence: HistoricalMomentumPersistence;
  momentumScore: number | null;

  currentDrawdownPercent: number | null;
  maxDrawdownPercent: number | null;
  recoveryPercent: number | null;

  rangePosition: number | null;
  distanceFromHighPercent: number | null;
  distanceFromLowPercent: number | null;

  volumeTrend: 'RISING' | 'FALLING' | 'STABLE' | 'UNAVAILABLE';

  warnings: string[];
};

export type HistoricalMarketContextInput = {
  symbol: string;
  closes: readonly number[];
  dates: readonly string[];
  volumes?: readonly number[];
  fetchedAt?: string;
  now?: Date;
};

export type HistoricalMarketContextSnapshot = {
  schemaVersion: 1;
  source: 'VICTOR_HISTORICAL_MARKET_CONTEXT';
  symbol: string;
  observedAt: string | null;
  generatedAt: string;

  observationCount: number;
  hasVolume: boolean;
  dataQuality: HistoricalDataQuality;
  missingCapabilities: string[];

  shortTrend: HistoricalTrendDirection;
  mediumTrend: HistoricalTrendDirection;
  longTrend: HistoricalTrendDirection;
  trendAgreement: number;

  volatilityState: HistoricalVolatilityState;
  momentumPersistence: HistoricalMomentumPersistence;
  currentDrawdownPercent: number | null;
  maxDrawdownPercent: number | null;
  recoveryPercent: number | null;
  rangePosition: number | null;
  volumeTrend: HistoricalMarketContext['volumeTrend'];
  warnings: string[];
};

function isFiniteNumber(x: any): x is number { return typeof x === 'number' && Number.isFinite(x); }

function toIso(d: Date){ return d.toISOString(); }

function safePercent(n: number | null){ if (n === null) return null; if (!Number.isFinite(n)) return null; return Number(Number(n).toFixed(6)); }

// Linear regression slope normalized against mean price
// We use index (0..n-1) as x and price as y. Normalized slope = slope / meanPrice
function normalizedLinearSlope(arr: number[]): number | null {
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const n = arr.length;
  const xs = new Array(n); const ys = new Array(n);
  let sumX = 0; let sumY = 0;
  for (let i = 0; i < n; i++){ xs[i] = i; ys[i] = Number(arr[i]); if (!isFiniteNumber(ys[i])) return null; sumX += xs[i]; sumY += ys[i]; }
  const meanX = sumX / n; const meanY = sumY / n;
  let num = 0; let den = 0;
  for (let i = 0; i < n; i++){ const dx = xs[i] - meanX; const dy = ys[i] - meanY; num += dx * dy; den += dx * dx; }
  if (den === 0) return 0;
  const slope = num / den; // price units per index
  if (!Number.isFinite(slope) || meanY === 0) return null;
  return slope / meanY; // unitless relative slope per index
}

function stddev(arr: number[]): number | null {
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const m = arr.reduce((s,n)=> s + n, 0)/arr.length;
  const v = arr.reduce((s,n)=> s + Math.pow(n - m, 2), 0)/(arr.length - 1);
  const s = Math.sqrt(v);
  return Number.isFinite(s) ? s : null;
}

export function buildHistoricalMarketContext(input: HistoricalMarketContextInput): HistoricalMarketContext {
  const now = input.now || new Date();
  const generatedAt = toIso(now);
  const symbol = String(input.symbol || '').toUpperCase();

  // Build records with original index to deterministically collapse duplicates
  const records: { date: string; dateObj: Date; close: number; vol?: number; idx: number }[] = [];
  for (let i = 0; i < Math.min(input.closes.length, input.dates.length); i++){
    const rawClose = input.closes[i]; const rawDate = input.dates[i];
    const rawVol = input.volumes && input.volumes.length > i ? input.volumes[i] : undefined;
    if (!isFiniteNumber(rawClose) || rawClose <= 0) continue;
    const d = new Date(String(rawDate)); if (isNaN(d.getTime())) continue;
    if (d.getTime() > now.getTime()) continue; // ignore future
    if (rawVol !== undefined && (!isFiniteNumber(rawVol) || rawVol < 0)) continue; // invalid vol
    records.push({ date: d.toISOString().slice(0,10), dateObj: d, close: rawClose, vol: rawVol, idx: i });
  }

  if (records.length === 0){
    const empty: HistoricalMarketContext = {
      schemaVersion: 1, source: 'VICTOR_HISTORICAL_MARKET_CONTEXT', symbol, observedAt: null, generatedAt,
      observationCount: 0, hasVolume: false, dataQuality: 'INSUFFICIENT', missingCapabilities: ['LONG_TREND','VOLUME_TREND','VOLATILITY_COMPARISON','DRAWDOWN_CONTEXT'],
      shortTrend: 'INSUFFICIENT', mediumTrend: 'INSUFFICIENT', longTrend: 'INSUFFICIENT', trendAgreement: 0,
      volatilityState: 'INSUFFICIENT', currentVolatility: null, previousVolatility: null,
      momentumPersistence: 'INSUFFICIENT', momentumScore: null,
      currentDrawdownPercent: null, maxDrawdownPercent: null, recoveryPercent: null,
      rangePosition: null, distanceFromHighPercent: null, distanceFromLowPercent: null,
      volumeTrend: 'UNAVAILABLE', warnings: ['INSUFFICIENT_HISTORY']
    };
    return empty;
  }

  // sort by date ascending; collapse duplicate dates deterministically choosing the record with largest idx (latest in input)
  records.sort((a,b)=> a.dateObj.getTime() - b.dateObj.getTime() || a.idx - b.idx);
  const collapsed: typeof records = [];
  for (const r of records){
    const last = collapsed.length ? collapsed[collapsed.length-1] : null;
    if (last && last.date === r.date){
      // keep the one with larger idx (later in original arrays)
      if (r.idx >= last.idx) collapsed[collapsed.length-1] = r;
    } else collapsed.push(r);
  }

  const closes = collapsed.map(r=> r.close);
  const dates = collapsed.map(r=> r.date);
  const vols = collapsed.map(r=> r.vol).filter(v=> v !== undefined) as number[];
  const observedAt = dates.length ? dates[dates.length-1] : null;
  const observationCount = closes.length;

  let dataQuality: HistoricalDataQuality = 'INSUFFICIENT';
  if (observationCount >= 60) dataQuality = 'COMPLETE';
  else if (observationCount >= 20) dataQuality = 'LIMITED';

  const hasVolume = vols.length === closes.length;
  const missingCapabilities: string[] = [];
  if (observationCount < 60) missingCapabilities.push('LONG_TREND');
  if (!hasVolume) missingCapabilities.push('VOLUME_TREND');

  // TREND windows
  const takeLast = (n:number) => closes.slice(Math.max(0, closes.length - n));
  const shortWindow = takeLast(10);
  const mediumWindow = takeLast(30);
  const longWindow = takeLast(60);

  // compute normalized slopes
  const shortSlope = normalizedLinearSlope(shortWindow);
  const medSlope = normalizedLinearSlope(mediumWindow);
  const longSlope = normalizedLinearSlope(longWindow);

  // Conservative thresholds: small normalized slopes are SIDEWAYS
  // thresholds chosen to require several percent moves across window
  const SHORT_THRESH = 0.003; // ~0.3% per index over short window
  const MED_THRESH = 0.0018;
  const LONG_THRESH = 0.001;

  function classifySlope(s: number | null, thr: number): HistoricalTrendDirection {
    if (s === null) return 'INSUFFICIENT';
    if (s > thr) return 'UP';
    if (s < -thr) return 'DOWN';
    return 'SIDEWAYS';
  }

  const shortTrend = classifySlope(shortSlope, SHORT_THRESH);
  const mediumTrend = classifySlope(medSlope, MED_THRESH);
  const longTrend = classifySlope(longSlope, LONG_THRESH);

  // trendAgreement conservative: 1 when all available point same direction (including SIDEWAYS)
  const available = [shortTrend, mediumTrend, longTrend].filter(t=> t !== 'INSUFFICIENT');
  let trendAgreement = 0;
  if (available.length === 0) trendAgreement = 0;
  else {
    const counts: Record<string, number> = { UP:0, DOWN:0, SIDEWAYS:0 } as any;
    for (const t of available) counts[t] = (counts[t]||0) + 1;
    if (counts.UP === available.length || counts.DOWN === available.length || counts.SIDEWAYS === available.length) trendAgreement = 1;
    else {
      const majority = Math.max(counts.UP, counts.DOWN);
      trendAgreement = Number((majority / available.length * 0.9).toFixed(3));
    }
  }

  // RETURNS and VOLATILITY
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++){ const a = closes[i-1]; const b = closes[i]; if (!isFiniteNumber(a) || !isFiniteNumber(b) || a === 0) continue; returns.push((b - a) / Math.abs(a)); }

  let currentVol: number | null = null; let previousVol: number | null = null; let volatilityState: HistoricalVolatilityState = 'INSUFFICIENT';
  if (returns.length >= 10){
    const last20 = returns.slice(-20);
    const prev20 = returns.slice(-40, -20);
    const sdLast = stddev(last20);
    const sdPrev = stddev(prev20);
    currentVol = sdLast === null ? null : safePercent(sdLast * 100);
    previousVol = sdPrev === null ? null : safePercent(sdPrev * 100);
    // overall baseline
    const overall = stddev(returns);
    const baseline = overall === null ? null : overall * 100;
    if (currentVol === null) volatilityState = 'INSUFFICIENT';
    else if (previousVol !== null && currentVol > previousVol * 1.2) volatilityState = 'EXPANDING';
    else if (previousVol !== null && currentVol < previousVol * 0.8) volatilityState = 'CONTRACTING';
    else if (baseline !== null && currentVol > baseline * 1.5) volatilityState = 'HIGH';
    else if (baseline !== null && currentVol < baseline * 0.7) volatilityState = 'LOW';
    else volatilityState = 'NORMAL';
  }

  // MOMENTUM: combine positive return fraction with short/medium trend and optional volume confirmation
  let momentumScore: number | null = null; let momentumPersistence: HistoricalMomentumPersistence = 'INSUFFICIENT';
  if (returns.length >= 3){
    const pos = returns.filter(r=> r > 0).length; const neg = returns.filter(r=> r < 0).length; const total = returns.length;
    const posFrac = total ? pos / total : 0; const negFrac = total ? neg / total : 0;
    const shortDir = shortTrend === 'UP' ? 1 : shortTrend === 'DOWN' ? -1 : 0;
    const medDir = mediumTrend === 'UP' ? 1 : mediumTrend === 'DOWN' ? -1 : 0;
    // REVERSING if short contradicts medium or long
    if ((shortDir !== 0) && ((medDir !== 0 && shortDir !== medDir) || (longTrend !== 'INSUFFICIENT' && ((shortDir === 1 && longTrend === 'DOWN') || (shortDir === -1 && longTrend === 'UP'))))){
      momentumPersistence = 'REVERSING';
    } else {
      let score = (posFrac - negFrac) * 0.8 + shortDir * 0.1 + medDir * 0.05;
      // volume confirmation small boost if present
      if (hasVolume){
        const last10Vol = vols.slice(-10); const prev10Vol = vols.slice(-20, -10);
        if (last10Vol.length === 10 && prev10Vol.length === 10){
          const avgLast = last10Vol.reduce((s,n)=> s + n,0)/10; const avgPrev = prev10Vol.reduce((s,n)=> s + n,0)/10;
          if (avgPrev > 0 && avgLast / avgPrev >= 1.2) score += 0.05;
          if (avgPrev > 0 && avgLast / avgPrev <= 0.8) score -= 0.05;
        }
      }
      score = Math.max(-1, Math.min(1, score));
      momentumScore = Number(Number(score).toFixed(3));
      // classify
      if (momentumScore >= 0.6) momentumPersistence = 'STRONG';
      else if (momentumScore >= 0.2) momentumPersistence = 'MODERATE';
      else if (momentumScore > -0.2) momentumPersistence = 'WEAK';
      else momentumPersistence = 'REVERSING';
    }
  }

  // DRAWDOWN
  let currentDrawdownPercent: number | null = null; let maxDrawdownPercent: number | null = null; let recoveryPercent: number | null = null;
  if (closes.length >= 1){
    let peak = closes[0]; let maxDD = 0; let troughAfterPeak = peak; let lastTroughPeakGap: { peak:number; trough:number } | null = null;
    for (let i = 1; i < closes.length; i++){
      const v = closes[i];
      if (v > peak){
        // new peak
        peak = v;
        troughAfterPeak = v;
      } else {
        // drawdown from current peak
        if (v < troughAfterPeak) troughAfterPeak = v;
        const dd = (peak - troughAfterPeak) / peak * 100;
        if (dd > maxDD){ maxDD = dd; lastTroughPeakGap = { peak, trough: troughAfterPeak }; }
      }
    }
    const last = closes[closes.length - 1];
    // current drawdown from most recent running peak
    let runningPeak = closes[0];
    for (const v of closes){ if (v > runningPeak) runningPeak = v; }
    if (runningPeak > 0){ const cd = (runningPeak - last) / runningPeak * 100; currentDrawdownPercent = safePercent(cd); }
    if (maxDD > 0) maxDrawdownPercent = Number(Number(maxDD).toFixed(6));
    if (lastTroughPeakGap && maxDrawdownPercent !== null){ const peak = lastTroughPeakGap.peak; const trough = lastTroughPeakGap.trough; const denom = peak - trough; if (denom > 0){ recoveryPercent = Number(Number(((last - trough) / denom) * 100).toFixed(6)); if (recoveryPercent < 0) recoveryPercent = 0; if (recoveryPercent > 100) recoveryPercent = 100; } }
  }

  // RANGE POSITION (last up to 60)
  const windowForRange = longWindow.length ? longWindow : closes.slice();
  let rangePosition: number | null = null; let distanceFromHighPercent: number | null = null; let distanceFromLowPercent: number | null = null;
  if (windowForRange.length > 0){
    const high = Math.max(...windowForRange); const low = Math.min(...windowForRange);
    const last = closes[closes.length - 1];
    if (high === low){ rangePosition = 0.5; distanceFromHighPercent = 0; distanceFromLowPercent = 0; }
    else { rangePosition = Number(((last - low) / (high - low)).toFixed(6)); distanceFromHighPercent = Number(((high - last) / high * 100).toFixed(6)); distanceFromLowPercent = Number(((last - low) / low * 100).toFixed(6)); }
  }

  // VOLUME TREND
  let volumeTrend: HistoricalMarketContext['volumeTrend'] = 'UNAVAILABLE';
  if (hasVolume && vols.length >= 20){
    const last10 = vols.slice(-10); const prev10 = vols.slice(-20, -10);
    const avgLast = last10.reduce((s,n)=> s + n,0)/last10.length; const avgPrev = prev10.reduce((s,n)=> s + n,0)/prev10.length;
    if (avgPrev > 0 && avgLast / avgPrev >= 1.12) volumeTrend = 'RISING';
    else if (avgPrev > 0 && avgLast / avgPrev <= 0.88) volumeTrend = 'FALLING';
    else volumeTrend = 'STABLE';
  }

  // WARNINGS
  const warningsSet = new Set<string>();
  if (dataQuality === 'INSUFFICIENT') warningsSet.add('INSUFFICIENT_HISTORY');
  if (dataQuality === 'LIMITED') warningsSet.add('LIMITED_HISTORY');
  if (!hasVolume) warningsSet.add('VOLUME_UNAVAILABLE');
  if (momentumPersistence === 'REVERSING') warningsSet.add('MOMENTUM_REVERSAL');
  if (volatilityState === 'HIGH') warningsSet.add('HIGH_VOLATILITY');
  if ((currentDrawdownPercent !== null && currentDrawdownPercent > 20) || (maxDrawdownPercent !== null && maxDrawdownPercent > 30)) warningsSet.add('DEEP_DRAWDOWN');

  const warnings = Array.from(warningsSet).sort();

  const out: HistoricalMarketContext = {
    schemaVersion: 1, source: 'VICTOR_HISTORICAL_MARKET_CONTEXT', symbol, observedAt, generatedAt,
    observationCount, hasVolume, dataQuality, missingCapabilities,
    shortTrend, mediumTrend, longTrend, trendAgreement,
    volatilityState, currentVolatility: currentVol, previousVolatility: previousVol,
    momentumPersistence, momentumScore: momentumScore === null ? null : Number(Number(momentumScore).toFixed(6)),
    currentDrawdownPercent: currentDrawdownPercent === null ? null : Number(Number(currentDrawdownPercent).toFixed(6)),
    maxDrawdownPercent: maxDrawdownPercent === null ? null : Number(Number(maxDrawdownPercent).toFixed(6)),
    recoveryPercent: recoveryPercent === null ? null : Number(Number(recoveryPercent).toFixed(6)),
    rangePosition: rangePosition === null ? null : Number(Number(rangePosition).toFixed(6)),
    distanceFromHighPercent: distanceFromHighPercent === null ? null : Number(Number(distanceFromHighPercent).toFixed(6)),
    distanceFromLowPercent: distanceFromLowPercent === null ? null : Number(Number(distanceFromLowPercent).toFixed(6)),
    volumeTrend, warnings
  };

  return out;
}

// Build sanitized audit payload for a context snapshot
export function buildHistoricalContextAuditPayload(cycleId: string, ctx: HistoricalMarketContext): Record<string, unknown> {
  const out: Record<string, unknown> = {
    kind: 'HISTORICAL_MARKET_CONTEXT_SNAPSHOT',
    cycleId,
    schemaVersion: ctx.schemaVersion,
    source: ctx.source,
    symbol: ctx.symbol,
    observedAt: ctx.observedAt,
    generatedAt: ctx.generatedAt,
    observationCount: ctx.observationCount,
    hasVolume: ctx.hasVolume,
    dataQuality: ctx.dataQuality,
    missingCapabilities: ctx.missingCapabilities,
    shortTrend: ctx.shortTrend,
    mediumTrend: ctx.mediumTrend,
    longTrend: ctx.longTrend,
    trendAgreement: ctx.trendAgreement,
    volatilityState: ctx.volatilityState,
    momentumPersistence: ctx.momentumPersistence,
    currentDrawdownPercent: ctx.currentDrawdownPercent,
    maxDrawdownPercent: ctx.maxDrawdownPercent,
    recoveryPercent: ctx.recoveryPercent,
    rangePosition: ctx.rangePosition,
    volumeTrend: ctx.volumeTrend,
    warnings: ctx.warnings,
  };
  return out;
}

// Sanitize for runtime state (defensive JSON-safe copy without raw arrays)
export function sanitizeContextForState(ctx: HistoricalMarketContext): HistoricalMarketContextSnapshot{
  // build typed defensive copy without raw arrays
  const out: HistoricalMarketContextSnapshot = {
    schemaVersion: ctx.schemaVersion,
    source: ctx.source,
    symbol: ctx.symbol,
    observedAt: ctx.observedAt,
    generatedAt: ctx.generatedAt,
    observationCount: ctx.observationCount,
    hasVolume: ctx.hasVolume,
    dataQuality: ctx.dataQuality,
    missingCapabilities: Array.isArray(ctx.missingCapabilities) ? ctx.missingCapabilities.slice() : [],
    shortTrend: ctx.shortTrend,
    mediumTrend: ctx.mediumTrend,
    longTrend: ctx.longTrend,
    trendAgreement: ctx.trendAgreement,
    volatilityState: ctx.volatilityState,
    momentumPersistence: ctx.momentumPersistence,
    currentDrawdownPercent: ctx.currentDrawdownPercent,
    maxDrawdownPercent: ctx.maxDrawdownPercent,
    recoveryPercent: ctx.recoveryPercent,
    rangePosition: ctx.rangePosition,
    volumeTrend: ctx.volumeTrend,
    warnings: Array.isArray(ctx.warnings) ? ctx.warnings.slice() : [],
  };
  return out;
}

export default { buildHistoricalMarketContext, buildHistoricalContextAuditPayload, sanitizeContextForState };
