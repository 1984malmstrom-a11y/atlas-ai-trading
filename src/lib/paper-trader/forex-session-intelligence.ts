import { IntradayCandle } from './intraday-market-context';

export type ForexSession = 'TOKYO'|'LONDON'|'NEW_YORK';
export type SessionOverlap = 'NONE'|'TOKYO_LONDON'|'LONDON_NEW_YORK';

export type ForexSessionIntelligence = {
  schemaVersion: 1;
  source: 'VICTOR_FOREX_SESSION_INTELLIGENCE';
  symbol: string;
  generatedAt: string;
  observedAt: string | null;
  timezoneBasis: 'UTC';
  activeSessions: ForexSession[];
  overlap: SessionOverlap;
  primarySession: ForexSession | null;
  sessionPhase: 'PRE_OPEN'|'OPENING'|'ACTIVE'|'CLOSING'|'CLOSED'|'UNKNOWN';
  liquidityExpectation: 'LOW'|'NORMAL'|'HIGH'|'UNKNOWN';
  volatilityExpectation: 'LOW'|'NORMAL'|'HIGH'|'UNKNOWN';
  sessionOpen: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
  sessionChangePercent: number | null;
  sessionRangePercent: number | null;
  rangeVsRecentAverage: number | null;
  pointCount: number;
  isFresh: boolean;
  coverage: 'COMPLETE'|'LIMITED'|'INSUFFICIENT'|'UNAVAILABLE';
  quality: 'COMPLETE'|'LIMITED'|'INSUFFICIENT';
  confidence: number;
  supportingSignals: string[];
  warnings: string[];
};

function toIso(d: Date){ return d.toISOString(); }

// UTC session boundaries (hours in 24h UTC)
const SESSION_RANGES: Record<ForexSession, { start:number; end:number }> = {
  TOKYO: { start: 0, end: 8 }, // 00:00 - 08:00 UTC
  LONDON: { start: 7, end: 16 }, // 07:00 - 16:00 UTC
  NEW_YORK: { start: 12, end: 21 } // 12:00 - 21:00 UTC
};

export function buildForexSessionIntelligence(opts: { symbol: string; candles?: IntradayCandle[]; now?: Date }): ForexSessionIntelligence | null {
  const sym = String(opts.symbol || '').toUpperCase(); if (!sym) return null;
  const now = opts.now || new Date(); const generatedAt = toIso(now);
  const tzHour = now.getUTCHours();
  const active: ForexSession[] = [];
  for (const s of Object.keys(SESSION_RANGES) as ForexSession[]){ const r = SESSION_RANGES[s]; // inclusive start, exclusive end
    const inside = (tzHour >= r.start && tzHour < r.end) || (r.start > r.end && (tzHour >= r.start || tzHour < r.end)); if (inside) active.push(s); }
  let overlap: SessionOverlap = 'NONE'; if (active.includes('TOKYO') && active.includes('LONDON')) overlap = 'TOKYO_LONDON'; if (active.includes('LONDON') && active.includes('NEW_YORK')) overlap = 'LONDON_NEW_YORK';
  const primary = active.length ? active[0] : null;
  const candles = Array.isArray(opts.candles) ? opts.candles.slice() : [];
  const closes = candles.map(c=> c.close).filter(n=> typeof n === 'number' && Number.isFinite(n));
  const pointCount = closes.length;
  const isFresh = candles.length ? (new Date().getTime() - new Date(candles[candles.length-1].timestamp).getTime() <= 60*60*1000) : false;
  const open = closes.length ? closes[0] : null; const high = closes.length ? Math.max(...closes) : null; const low = closes.length ? Math.min(...closes) : null; const last = closes.length ? closes[closes.length-1] : null;
  const sessionChangePercent = (open !== null && last !== null && open !== 0) ? Number(((last - open)/open*100).toFixed(4)) : null;
  const sessionRangePercent = (open !== null && high !== null && low !== null && open !== 0) ? Number(((high - low)/open*100).toFixed(4)) : null;
  const recentAvgRange = closes.length >= 10 ? (Math.max(...closes.slice(-10)) - Math.min(...closes.slice(-10))) : null;
  const rangeVsRecentAverage = (sessionRangePercent !== null && recentAvgRange !== null && last !== null && last !== 0) ? Number((( (high! - low!) - recentAvgRange) / (recentAvgRange || 1)).toFixed(3)) : null;
  const coverage = pointCount >= 10 ? 'COMPLETE' : pointCount >= 4 ? 'LIMITED' : pointCount > 0 ? 'INSUFFICIENT' : 'UNAVAILABLE';
  const quality = coverage === 'COMPLETE' ? 'COMPLETE' : coverage === 'LIMITED' ? 'LIMITED' : 'INSUFFICIENT';
  const confidence = pointCount > 0 ? clamp01(Math.min(1, pointCount / 60)) : 0;
  const liquidityExpectation: ForexSessionIntelligence['liquidityExpectation'] = active.length > 1 ? 'HIGH' : active.length === 1 ? 'NORMAL' : 'LOW';
  const volatilityExpectation: ForexSessionIntelligence['volatilityExpectation'] = sessionRangePercent !== null && Math.abs(sessionRangePercent) >= 1 ? 'HIGH' : 'NORMAL';
  const phase: ForexSessionIntelligence['sessionPhase'] = active.length === 0 ? 'CLOSED' : (pointCount === 0 ? 'PRE_OPEN' : 'ACTIVE');
  const warnings: string[] = [];
  if (coverage === 'UNAVAILABLE') warnings.push('FOREX_SESSION_DATA_UNAVAILABLE');
  if (candles.length && candles.some(c=> !Number.isFinite(c.close))) warnings.push('INVALID_CANDLES');
  return { schemaVersion: 1, source: 'VICTOR_FOREX_SESSION_INTELLIGENCE', symbol: sym, generatedAt, observedAt: candles.length ? candles[candles.length-1].timestamp : null, timezoneBasis: 'UTC', activeSessions: active, overlap, primarySession: primary, sessionPhase: phase, liquidityExpectation, volatilityExpectation, sessionOpen: open, sessionHigh: high, sessionLow: low, sessionChangePercent, sessionRangePercent, rangeVsRecentAverage, pointCount, isFresh, coverage, quality, confidence, supportingSignals: [], warnings };
}

function clamp01(v:number){ return Math.max(0, Math.min(1, v)); }

export function sanitizeForexSessionIntelligenceForState(s: ForexSessionIntelligence){ const copy = JSON.parse(JSON.stringify(s)) as ForexSessionIntelligence; copy.supportingSignals = Array.isArray(copy.supportingSignals) ? copy.supportingSignals.slice(0,8) : []; copy.warnings = Array.isArray(copy.warnings) ? copy.warnings.slice(0,10) : []; return copy; }

export default { buildForexSessionIntelligence, sanitizeForexSessionIntelligenceForState };
