// Intraday Market Context builder (deterministic, pure)
export type IntradayCoverage = 'COMPLETE' | 'LIMITED' | 'INSUFFICIENT' | 'UNAVAILABLE';
export type IntradayDirection = 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';

export type IntradayCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type IntradayMarketContext = {
  schemaVersion: 1;
  source: 'TWELVE_DATA_INTRADAY';
  symbol: string;
  interval: '5min' | '15min';

  observedAt: string | null;
  generatedAt: string;
  fetchedAt: string | null;
  expiresAt: string | null;
  isFresh: boolean;

  coverage: IntradayCoverage;
  pointCount: number;

  latest: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  };

  session: {
    openPrice: number | null;
    highPrice: number | null;
    lowPrice: number | null;
    changePercent: number | null;
    rangePercent: number | null;
    cumulativeVolume: number | null;
  };

  momentum: {
    shortReturnPercent: number | null;
    volumeVsAverage: number | null;
    direction: IntradayDirection;
  };

  warnings: readonly string[];
};

export type BuildIntradayInput = {
  symbol: string;
  interval: '5min' | '15min';
  candles: readonly IntradayCandle[];
  fetchedAt?: string | null;
  now?: Date;
};

function isFiniteNumber(x: any): x is number { return typeof x === 'number' && Number.isFinite(x); }
function toIso(d: Date){ return d.toISOString(); }
function round4(n: number){ return Number(Number(n).toFixed(4)); }

export function buildIntradayMarketContext(input: BuildIntradayInput): IntradayMarketContext{
  const now = input.now || new Date();
  const generatedAt = toIso(now);
  const symbol = String(input.symbol || '').toUpperCase();
  const interval = input.interval;
  const fetchedAt = input.fetchedAt || null;

  // Defensive copy and validate incoming candles (expect oldest->newest or any order)
  const recs = Array.isArray(input.candles) ? input.candles.slice() : [];
  // filter invalid and future beyond 2 minutes
  const nowMs = now.getTime();
  const valid: { ts: string; tms: number; open:number; high:number; low:number; close:number; vol:number | null; idx:number }[] = [];
  for (let i=0;i<recs.length;i++){
    const c = recs[i];
    if (!c || typeof c.timestamp !== 'string') continue;
    const d = new Date(c.timestamp);
    if (!isFinite(d.getTime())) continue;
    if (d.getTime() > nowMs + 2*60*1000) continue;
    const open = c.open; const high = c.high; const low = c.low; const close = c.close; let vol = c.volume === undefined ? null : c.volume;
    if (!isFiniteNumber(open) || open <= 0) continue;
    if (!isFiniteNumber(high) || high <= 0) continue;
    if (!isFiniteNumber(low) || low <= 0) continue;
    if (!isFiniteNumber(close) || close <= 0) continue;
    if (!(high >= open && high >= close && high >= low)) continue;
    if (!(low <= open && low <= close)) continue;
    if (vol !== null && vol !== undefined){ if (!isFiniteNumber(vol) || vol < 0) vol = null; }
    valid.push({ ts: d.toISOString(), tms: d.getTime(), open: Number(open), high: Number(high), low: Number(low), close: Number(close), vol: vol === null ? null : Number(vol), idx: i });
  }

  if (valid.length === 0){
    const empty: IntradayMarketContext = {
      schemaVersion: 1, source: 'TWELVE_DATA_INTRADAY', symbol, interval,
      observedAt: null, generatedAt, fetchedAt: fetchedAt || null, expiresAt: null, isFresh: false,
      coverage: 'UNAVAILABLE', pointCount: 0,
      latest: { open: null, high: null, low: null, close: null, volume: null },
      session: { openPrice: null, highPrice: null, lowPrice: null, changePercent: null, rangePercent: null, cumulativeVolume: null },
      momentum: { shortReturnPercent: null, volumeVsAverage: null, direction: 'UNKNOWN' },
      warnings: ['INTRADAY_DATA_UNAVAILABLE']
    };
    return empty;
  }

  // collapse duplicates keeping last seen (higher idx), then sort oldest->newest
  const mapByTs = new Map<string, { rec: any; idx:number }>();
  for (const r of valid){ const ex = mapByTs.get(r.ts); if (!ex || r.idx >= ex.idx) mapByTs.set(r.ts, { rec: r, idx: r.idx }); }
  const tsList = Array.from(mapByTs.keys()).sort((a,b)=> a < b ? -1 : a > b ? 1 : 0);
  const candles = tsList.map(ts => mapByTs.get(ts)!.rec);

  const pointCount = candles.length;
  let coverage: IntradayCoverage = 'UNAVAILABLE';
  if (pointCount >= 48) coverage = 'COMPLETE'; else if (pointCount >= 24) coverage = 'LIMITED'; else if (pointCount >= 8) coverage = 'INSUFFICIENT'; else coverage = 'UNAVAILABLE';

  // freshness thresholds
  const last = candles[candles.length-1];
  const ageMs = nowMs - last.tms;
  let isFresh = false;
  if (interval === '5min') isFresh = ageMs <= 12*60*1000; else isFresh = ageMs <= 32*60*1000;

  // latest summary
  const latest = { open: Number(last.open), high: Number(last.high), low: Number(last.low), close: Number(last.close), volume: last.vol === null ? null : Number(last.vol) };

  // session metrics
  const openPrice = candles.length ? candles[0].open : null;
  const highPrice = candles.reduce((s:any,c:any)=> Math.max(s, c.high), -Infinity);
  const lowPrice = candles.reduce((s:any,c:any)=> Math.min(s, c.low), Infinity);
  const highP = highPrice === -Infinity ? null : Number(highPrice);
  const lowP = lowPrice === Infinity ? null : Number(lowPrice);
  let changePercent: number | null = null; let rangePercent: number | null = null;
  if (isFiniteNumber(openPrice) && openPrice !== 0 && isFiniteNumber(latest.close)){
    changePercent = round4((latest.close - openPrice) / openPrice * 100);
    if (isFiniteNumber(highP) && isFiniteNumber(lowP) && openPrice !== 0) rangePercent = round4((highP - lowP) / openPrice * 100);
  }
  const cumulativeVolumeVals = candles.map(c=> c.vol).filter(v=> v !== null) as number[];
  const cumulativeVolume = cumulativeVolumeVals.length ? cumulativeVolumeVals.reduce((s,n)=> s + n, 0) : null;

  // momentum: shortReturnPercent compare latest close vs close 5 candles earlier
  let shortReturnPercent: number | null = null;
  const lookback = 5;
  if (candles.length > lookback){ const earlier = candles[candles.length - 1 - lookback]; if (isFiniteNumber(earlier.close) && earlier.close !== 0){ shortReturnPercent = round4((latest.close - earlier.close) / earlier.close * 100); } }
  let direction: IntradayDirection = 'UNKNOWN';
  if (shortReturnPercent === null) direction = 'UNKNOWN'; else if (shortReturnPercent > 0.15) direction = 'UP'; else if (shortReturnPercent < -0.15) direction = 'DOWN'; else direction = 'FLAT';

  // volume vs average of up to previous 20 candles (exclude latest)
  let volumeVsAverage: number | null = null;
  if (isFiniteNumber(latest.volume)){
    const prior = candles.slice(0, Math.max(0, candles.length - 1)).slice(-20).map((c:any)=> c.vol).filter(v=> v !== null) as number[];
    if (prior.length > 0){ const avg = prior.reduce((s,n)=> s + n, 0)/prior.length; if (avg > 0) volumeVsAverage = round4(Number(latest.volume) / avg); else volumeVsAverage = null; }
  }

  // warnings
  const warningsSet = new Set<string>();
  if (coverage === 'UNAVAILABLE') warningsSet.add('INTRADAY_DATA_UNAVAILABLE');
  if (coverage === 'INSUFFICIENT') warningsSet.add('INTRADAY_HISTORY_INSUFFICIENT');
  if (coverage === 'LIMITED') warningsSet.add('INTRADAY_HISTORY_LIMITED');
  if (!isFresh) warningsSet.add('INTRADAY_DATA_STALE');
  if (cumulativeVolume === null) warningsSet.add('INTRADAY_VOLUME_UNAVAILABLE');
  if (valid.length !== input.candles.length) warningsSet.add('INTRADAY_INVALID_CANDLES_FILTERED');
  const warnings = Array.from(warningsSet).sort().slice(0,10);

  const out: IntradayMarketContext = {
    schemaVersion: 1, source: 'TWELVE_DATA_INTRADAY', symbol, interval,
    observedAt: candles.length ? candles[candles.length-1].ts : null,
    generatedAt, fetchedAt: fetchedAt || null, expiresAt: null, isFresh,
    coverage, pointCount,
    latest: { open: latest.open || null, high: latest.high || null, low: latest.low || null, close: latest.close || null, volume: latest.volume === null ? null : Number(latest.volume) },
    session: { openPrice: openPrice === null ? null : Number(openPrice), highPrice: highP, lowPrice: lowP, changePercent: changePercent === null ? null : Number(changePercent), rangePercent: rangePercent === null ? null : Number(rangePercent), cumulativeVolume: cumulativeVolume === null ? null : Number(cumulativeVolume) },
    momentum: { shortReturnPercent: shortReturnPercent === null ? null : Number(shortReturnPercent), volumeVsAverage: volumeVsAverage === null ? null : Number(volumeVsAverage), direction },
    warnings
  };

  return out;
}

export function sanitizeIntradayMarketContextForState(ctx: IntradayMarketContext): IntradayMarketContext{
  // Build defensive JSON-safe copy without raw candles
  const out: IntradayMarketContext = JSON.parse(JSON.stringify(ctx));
  // Ensure warnings array exists and is stable
  out.warnings = Array.isArray(ctx.warnings) ? ctx.warnings.slice(0,10) : [];
  return out;
}

export type IntradayDataReadiness = {
  checkedAt: string;
  symbolCount: number;
  readyCount: number;
  limitedCount: number;
  insufficientCount: number;
  unavailableCount: number;
  staleCount: number;
  topBlockingReasons: readonly { reason: string; count: number }[];
};

export function buildIntradayDataReadiness(contexts: IntradayMarketContext[] | null | undefined, now?: Date): IntradayDataReadiness{
  const checkedAt = (now || new Date()).toISOString();
  const arr = Array.isArray(contexts) ? contexts : [];
  const symbolCount = arr.length;
  let readyCount = 0, limitedCount = 0, insufficientCount = 0, unavailableCount = 0, staleCount = 0;
  const reasonCounts: Record<string, number> = {};
  for (const c of arr){ if (!c) { unavailableCount++; reasonCounts['INTRADAY_DATA_UNAVAILABLE'] = (reasonCounts['INTRADAY_DATA_UNAVAILABLE']||0)+1; continue; }
    if (c.coverage === 'COMPLETE') readyCount++; else if (c.coverage === 'LIMITED') limitedCount++; else if (c.coverage === 'INSUFFICIENT') insufficientCount++; else unavailableCount++;
    if (!c.isFresh) staleCount++;
    for (const w of c.warnings || []) reasonCounts[w] = (reasonCounts[w]||0)+1;
  }
  const top = Object.keys(reasonCounts).map(k=> ({ reason: k, count: reasonCounts[k] })).sort((a,b)=> b.count - a.count || a.reason.localeCompare(b.reason)).slice(0,10);
  return { checkedAt, symbolCount, readyCount, limitedCount, insufficientCount, unavailableCount, staleCount, topBlockingReasons: top };
}

export default { buildIntradayMarketContext, sanitizeIntradayMarketContextForState, buildIntradayDataReadiness };
