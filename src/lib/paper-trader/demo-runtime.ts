import { getNextNYOpenInstant } from '../../lib/us-market';
import createPaperTrader from './engine';
import ensureDailyStart from './ensure-daily-start';
import { PaperTraderConfig, PaperTradeDecision, SimulatedExecution, AuditEntry, LearningSignal } from './types';
import { calculatePerformance } from './performance-analytics';
import { evaluatePerformanceReflection } from './reflection-engine';
import * as DecisionEngine from './decision-engine';
import analyzeMarket from '../market-analysis';
import buildMarketSignals from '../victor-signals';
import { evaluateTrade } from './trade-evaluation';
import { resolveSingleEntryForReview } from './trade-review-entry';
import { createTradeFeedback, summarizeFeedbackBySignal } from './trade-feedback';
import { buildTradeReview } from './trade-review-builder';
// defer loading of technical analysis and instruments so tests can mock them before use
import { combineAnalyses } from './analysis-aggregator';
import estimateExpectedReturn from './expected-return';
import analyzePriceSeries from './technical';
import classifyMarketRegime from './market-regime-classifier';
import { buildMarketRegimeIntelligence, buildMarketRegimeIntelligenceAudit, sanitizeIntelligenceForState } from './market-regime-intelligence';
import buildMarketContextAdvice from './market-context-advisor';
import buildHistoricalContext from './historical-context-engine';
import type { HistoricalMarketContextSnapshot } from './historical-market-context';
import buildDecisionConfidenceExplanation from './decision-confidence-explainer';
import buildDecisionEvidence from './evidence-aggregator';
import analyzeEvidenceConsistency from './evidence-consistency-analyzer';
import buildEvidenceInformedDecision from './evidence-informed-decision-policy';
import type { DecisionEvidence } from './evidence-aggregator';
import type { EvidenceConsistency } from './evidence-consistency-analyzer';
import type { EvidenceInformedDecision } from './evidence-informed-decision-policy';
import type { HistoricalContext } from './historical-context-engine';
import evaluateShadowDecisionOutcome from './shadow-decision-outcome-evaluator';
import aggregateShadowDecisionPerformance from './shadow-decision-performance-aggregator';
import { createPerCycleContextAwareShadowResolver, sanitizeContextAwareShadowDecisionForState } from './context-aware-shadow-decision';
import { TRADABLE_INSTRUMENTS } from '../market-data/instruments';
import { TwelveDataMarketDataProvider } from '../market-data/twelve-data';
import { getMarketDataProvider } from '../market-data';
import { buildIntradayMarketContext, sanitizeIntradayMarketContextForState, buildIntradayDataReadiness, IntradayMarketContext } from './intraday-market-context';
import { resolveBenchmarkSymbol, buildBenchmarkMarketContext, sanitizeBenchmarkMarketContextForState, buildBenchmarkDataReadiness, BenchmarkMarketContext } from './benchmark-market-context';
import { getForexSessionDiagnostics } from '../forex-market';
import { fetchAndBuildFundamentalIntelligence } from '../paper-trader/fundamental-data';
import { buildMacroSignalsMock, buildMacroSignals, buildMacroSnapshotFromInstruments } from './macro-signals';
import { buildSectorStrengthSummaries, createSectorStrengthSignalForInstrument } from './sector-signals';
import { buildVolumeSignal, buildTrendQualitySignal, buildSupportResistanceSignal } from './market-structure-signals';
import { buildForexLaunchControlState, ForexLaunchControlState } from './forex-launch-control';
import { buildForexLaunchChecklist } from './forex-launch-checklist';
import { buildForexReadinessState, ForexReadinessState } from './forex-readiness';
import buildDailyTradingSummary from './daily-trading-summary';
import buildForexNoTradeSummary from './no-trade-summary';
import { DEFAULT_PAPER_AUTO_MANDATE } from '../../domain/trading/victor-types';
import fs from 'fs';
import path from 'path';
import computeNextPortfolioState from './portfolio-mutation';
import { Portfolio } from '../../domain/portfolio/types';
import { createSupabasePortfolioAdapter } from './supabase-portfolio-adapter';
import { SupabaseAuditAdapter } from './supabase-audit-adapter';
import { acquireRunCycleLockWithOwner, releaseRunCycleLock } from './run-cycle-lock';
import { createMarketNewsIntelligenceSummary, MarketNewsIntelligenceSummary } from './cycle-intelligence-snapshot';
import { createMarketNewsActivity, MarketNewsActivity } from './market-news-activity';

// Server-side in-memory runtime for demo-only Paper Trader V1

type RuntimeState = {
  startCapital: number;
  enabled: boolean;
  trader: ReturnType<typeof createPaperTrader>;
  portfolioAdapter: any;
  auditStore: any;
  latestDecision?: PaperTradeDecision | null;
  latestCycle?: any;
  latestMarketNewsActivity?: MarketNewsActivity | undefined;
  lastUpdated?: string;
  autonomousEnabled: boolean;
  latestDecisionIntelligenceBySymbol?: Record<string, any>;
  latestFundamentalIntelligenceBySymbol?: Record<string, any>;
  latestHistoricalMarketContextBySymbol?: Record<string, HistoricalMarketContextSnapshot>;
  latestMarketRegimeIntelligenceBySymbol?: Record<string, any>;
  latestIntradayMarketContextBySymbol?: Record<string, any>;
  latestBenchmarkMarketContextBySymbol?: Record<string, any>;
  benchmarkDataReadiness?: any;
  externalIntelligenceReadiness?: any;
  forexReadiness?: ForexReadinessState | null;
  forexAutonomyArmed?: boolean;
  forexLaunchControl?: ForexLaunchControlState | null;
  latestForexCycleStatus?: any;
  forexNoTradeSummary?: any;
  // scheduler is represented by the global singleton; do not duplicate state here
};

// singleton runtime stored at module scope
const START_CAPITAL = 100000;

function nowIso(){ return new Date().toISOString(); }

// max allowed age (calendar days) for historical daily candle used by TECHNICAL_MOMENTUM
// Chosen as 5 to cover normal weekend + occasional long holiday gaps (Thu -> Tue = 5 days).
const TECHNICAL_MOMENTUM_MAX_AGE_DAYS = 5;

// WATCHLIST Engine v1: default watchlist (reuses TRADABLE_INSTRUMENTS when possible)
export const DEFAULT_WATCHLIST = ['NVDA','MSFT','AAPL','META','AMZN','GOOGL','TSLA','AMD','NFLX','AVGO'];

// Return array of watchlist symbols that are present and enabled in eligibleInstruments
export function getWatchlistSymbols(eligibleInstruments: any[], watchlist = DEFAULT_WATCHLIST){
  try{
    if (!Array.isArray(eligibleInstruments)) return [];
    const allowed = new Set((watchlist||[]).map((s:string)=> String(s).toUpperCase()));
    const res: string[] = [];
    for (const i of eligibleInstruments){
      try{
        const p = (i && (i.providerSymbol || i.id)) ? String(i.providerSymbol || i.id).toUpperCase() : null;
        if (p && allowed.has(p)) res.push(p);
      }catch(_){ }
    }
    // dedupe and return
    return Array.from(new Set(res));
  }catch(_){ return []; }
}

// Small helper exposed for diagnostics: returns forex session status for a given instant.
export function forexSessionStatus(now?: Date){
  try{ return getForexSessionDiagnostics(now instanceof Date ? now : new Date()); }catch(e){ return { status: 'INVALID_DATE' }; }
}

// Create a per-cycle fundamental resolver factory (testable, no globals)
export function createPerCycleFundamentalResolver(opts: { fetchFundamental: (o:{symbol:string})=>Promise<any>, instruments?: any[], timeoutMs?: number, appendAudit?: (a:any)=>Promise<void>, updateState?: (s:string,r:any)=>void }){
  const map = new Map<string, Promise<any>>();
  const fetchFund = opts.fetchFundamental;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 3000;
  const instruments = Array.isArray(opts.instruments) ? opts.instruments : TRADABLE_INSTRUMENTS;
  async function resolve({ cycleId, symbol, assetType, analyzed }: { cycleId?: string; symbol: string; assetType?: string; analyzed?: boolean }){
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return null;
    // Normalize assetType from instruments list when not provided
    let at = typeof assetType === 'string' ? String(assetType).toUpperCase() : undefined;
    if (!at){ try{ const inst = Array.isArray(instruments) ? instruments.find((i:any)=> String((i.providerSymbol||i.id||'')).toUpperCase() === sym) : null; at = inst && inst.assetType ? String(inst.assetType).toUpperCase() : 'STOCK'; }catch(e){ at = 'STOCK'; } }
    // Only fetch for STOCK and when analyzed === true
    if (at !== 'STOCK') return { skipped: true, reason: 'NOT_STOCK' };
    if (analyzed === false) return { skipped: true, reason: 'NOT_ANALYZED' };
    if (map.has(sym)) return map.get(sym);
    const p = (async ()=>{
      try{
        const res = await Promise.race([ fetchFund({ symbol: sym }), new Promise(resolve => setTimeout(()=> resolve(null), timeoutMs)) ]);
        // append audit and update state via callbacks (best-effort)
        try{ if (opts.appendAudit && res && res.snapshot){ opts.appendAudit(res).catch(()=>{}); } }catch(_){ }
        try{ if (opts.updateState && res){ opts.updateState(sym, res); } }catch(_){ }
        return res;
      }catch(e){ return null; }
    })();
    map.set(sym, p);
    return p;
  }
  return { resolve };
}

// Per-cycle Market Regime Intelligence resolver (diagnostic-only)
export function createPerCycleMarketRegimeResolver(opts: { buildIntelligence: (o:{ symbol: string; historicalContext?: HistoricalMarketContextSnapshot; now?: Date })=>any, appendAudit?: (a:any)=>Promise<void>, getHistoricalSnapshot?: (s:string)=>HistoricalMarketContextSnapshot | null, updateState?: (s:string,r:any)=>void }){
  const map = new Map<string, Promise<any>>();
  const build = opts.buildIntelligence;
  async function resolve({ cycleId, symbol }: { cycleId?: string; symbol: string }){
    const sym = String(symbol || '').toUpperCase(); if (!sym) return null;
    if (map.has(sym)) return map.get(sym);
    const p = (async ()=>{
      try{
        // reuse existing historical snapshot via callback when available
        const hist = typeof opts.getHistoricalSnapshot === 'function' ? opts.getHistoricalSnapshot(sym) : undefined;
        const snap = build({ symbol: sym, historicalContext: hist || undefined, now: new Date() });
        // append audit if store provided
        try{ if (opts.appendAudit && typeof cycleId === 'string') opts.appendAudit(buildMarketRegimeIntelligenceAudit(cycleId, snap)).catch(()=>{}); }catch(_){ }
        try{ if (opts.updateState) opts.updateState(sym, sanitizeIntelligenceForState(snap)); }catch(_){ }
        return snap;
      }catch(e){ return null; }
    })();
    map.set(sym, p);
    return p;
  }
  return { resolve };
}

// Per-cycle intraday resolver factory: dedupe provider calls per cycle by key `${symbol}|${interval}`.
export function createPerCycleIntradayResolver(opts: { getIntraday: (symbol: string, interval: '5min'|'15min', limit?: number)=>Promise<any>, instruments?: any[], timeoutMs?: number, updateState?: (s:string,r:any)=>void }){
  const map = new Map<string, Promise<IntradayMarketContext | null>>();
  const getter = opts.getIntraday;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 8000;
  async function resolve({ symbol, interval, limit }: { symbol: string; interval: '5min'|'15min'; limit?: number }){
    const sym = String(symbol || '').toUpperCase(); if (!sym) return null;
    const key = `${sym}|${interval}`;
    if (map.has(key)) return map.get(key);
    const p = (async ()=>{
      try{
        const res = await Promise.race([ getter(sym, interval, typeof limit === 'number' ? limit : 64), new Promise((_,rej)=> setTimeout(()=> rej(Object.assign(new Error('INTRADAY_TIMEOUT'), { code: 'INTRADAY_TIMEOUT' })), timeoutMs)) ]);
        if (!res || !Array.isArray((res as any).candles)) throw Object.assign(new Error('INTRADAY_NO_VALID_CANDLES'), { code: 'INTRADAY_NO_VALID_CANDLES' });
        const ctx = buildIntradayMarketContext({ symbol: sym, interval, candles: (res as any).candles, fetchedAt: (res as any).fetchedAt });
        // update optional state callback with sanitized copy
        try{ if (opts.updateState) opts.updateState(sym, sanitizeIntradayMarketContextForState(ctx)); }catch(_){ }
        return ctx;
      }catch(e){
        // return sanitized UNAVAILABLE context
        try{ const unavailable: IntradayMarketContext = { schemaVersion: 1, source: 'TWELVE_DATA_INTRADAY', symbol: sym, interval, observedAt: null, generatedAt: new Date().toISOString(), fetchedAt: null, expiresAt: null, isFresh: false, coverage: 'UNAVAILABLE', pointCount: 0, latest: { open: null, high: null, low: null, close: null, volume: null }, session: { openPrice: null, highPrice: null, lowPrice: null, changePercent: null, rangePercent: null, cumulativeVolume: null }, momentum: { shortReturnPercent: null, volumeVsAverage: null, direction: 'UNKNOWN' }, warnings: ['INTRADAY_PROVIDER_UNAVAILABLE'] }; return unavailable; }catch(_){ return null; }
      }
    })();
    map.set(key, p as Promise<IntradayMarketContext | null>);
    return p;
  }
  return { resolve };
}

// Per-cycle benchmark resolver: dedupe benchmark symbol requests and build BenchmarkMarketContext
export function createPerCycleBenchmarkResolver(opts: { intradayResolver: { resolve: (o:{ symbol: string; interval: '15min'|'5min'; limit?: number }) => Promise<IntradayMarketContext | null> }, updateState?: (s:string,r:any)=>void }){
  const map = new Map<string, Promise<BenchmarkMarketContext | null>>();
  const intraday = opts.intradayResolver;
  async function resolve({ symbol, instrument, analyzed }:{ symbol: string; instrument?: any; analyzed?: boolean }){
    const sym = String(symbol || '').toUpperCase(); if (!sym) return null;
    // Only build for STOCKs and when analyzed === true
    const at = instrument && instrument.assetType ? String(instrument.assetType).toUpperCase() : undefined;
    if (at && at !== 'STOCK') return null;
    if (analyzed === false) return null;
    const benchmark = resolveBenchmarkSymbol(instrument || sym);
    if (!benchmark) {
      const unknown = buildBenchmarkMarketContext({ symbolContext: null, benchmarkContext: null, benchmarkSymbol: null, now: new Date() });
      try{ if (opts.updateState) opts.updateState(sym, sanitizeBenchmarkMarketContextForState(unknown)); }catch(_){ }
      return unknown;
    }
    const key = String(benchmark).toUpperCase();
    if (map.has(key)) return map.get(key);
    const p = (async ()=>{
      try{
        const bc = await intraday.resolve({ symbol: key, interval: '15min', limit: 64 });
        const sc = await intraday.resolve({ symbol: sym, interval: '15min', limit: 64 });
        const ctx = buildBenchmarkMarketContext({ symbolContext: sc || null, benchmarkContext: bc || null, benchmarkSymbol: key, now: new Date() });
        try{ if (opts.updateState) opts.updateState(sym, sanitizeBenchmarkMarketContextForState(ctx)); }catch(_){ }
        return ctx;
      }catch(e){ const unknown = buildBenchmarkMarketContext({ symbolContext: null, benchmarkContext: null, benchmarkSymbol: key, now: new Date() }); try{ if (opts.updateState) opts.updateState(sym, sanitizeBenchmarkMarketContextForState(unknown)); }catch(_){ } return unknown; }
    })();
    map.set(key, p);
    return p;
  }
  return { resolve };
}

// Select single best candidate: prefer SELL over BUY. Rank by confidence desc, then abs(expectedReturnPercent) desc, then symbol asc
export function selectBestCandidate(candidates: any[]){
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const sells = candidates.filter(c=> String(c.action||'').toUpperCase() === 'SELL');
  const buys = candidates.filter(c=> String(c.action||'').toUpperCase() === 'BUY');
  const cmp = (a:any,b:any)=>{
    const ca = typeof a.confidence === 'number' ? a.confidence : 0;
    const cb = typeof b.confidence === 'number' ? b.confidence : 0;
    if (ca !== cb) return cb - ca; // desc
    const ea = Math.abs(typeof a.expectedReturnPercent === 'number' ? a.expectedReturnPercent : 0);
    const eb = Math.abs(typeof b.expectedReturnPercent === 'number' ? b.expectedReturnPercent : 0);
    if (ea !== eb) return eb - ea; // desc
    const sa = String(a.symbol || '').toUpperCase();
    const sb = String(b.symbol || '').toUpperCase();
    return sa.localeCompare(sb);
  };
  if (sells.length > 0){ sells.sort(cmp); return sells[0]; }
  if (buys.length > 0){ buys.sort(cmp); return buys[0]; }
  return null;
}

// Freshness helper for TECHNICAL_MOMENTUM historical data
// API:
//   checkHistoricalFreshness(historicalLastDate?: string, now?: Date, maxAgeDays = 5)
// Returns: { valid: boolean; historicalLastDate?: string; historicalDataAgeDays?: number; reason?: 'MISSING_DATE'|'INVALID_DATE'|'FUTURE_DATE'|'STALE_DATE' }
// Notes:
// - Deterministic and pure: no FS or API calls.
// - Parses YYYY-MM-DD in UTC by appending T00:00:00.000Z when appropriate.
// - Uses UTC date-only arithmetic so timezones do not affect calendar-day age.
// - Default maxAgeDays = 5 to cover normal weekend + occasional long holiday gaps.
export function checkHistoricalFreshness(historicalLastDate?: string | null, now?: Date, maxAgeDays = 5){
  const res: { valid: boolean; historicalLastDate?: string; historicalDataAgeDays?: number; reason?: 'MISSING_DATE'|'INVALID_DATE'|'FUTURE_DATE'|'STALE_DATE' } = { valid: false };
  if (!historicalLastDate){ res.reason = 'MISSING_DATE'; return res; }
  // Normalize input to string
  const raw = String(historicalLastDate).trim();
  if (!raw){ res.reason = 'MISSING_DATE'; return res; }
  // Parse defensively: accept YYYY-MM-DD or full ISO; force UTC date-only by using Date.UTC
  let parsed: Date | null = null;
  try{
    // If string matches YYYY-MM-DD exactly, append Z to ensure UTC midnight
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)){
      parsed = new Date(raw + 'T00:00:00.000Z');
    } else {
      parsed = new Date(String(raw));
    }
    if (!parsed || !isFinite(parsed.getTime())){ parsed = null; }
  }catch(_){ parsed = null; }
  if (!parsed){ res.reason = 'INVALID_DATE'; return res; }
  const nowDate = now instanceof Date ? now : new Date();
  // Convert both to UTC date-only
  const toDateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const lastDateOnly = toDateOnly(parsed);
  const nowDateOnly = toDateOnly(nowDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  const ageDays = Math.floor((nowDateOnly.getTime() - lastDateOnly.getTime()) / msPerDay);
  if (ageDays < 0){ res.reason = 'FUTURE_DATE'; return res; }
  if (ageDays > maxAgeDays){ res.reason = 'STALE_DATE'; res.historicalDataAgeDays = ageDays; res.historicalLastDate = raw; return res; }
  // allowed when ageDays <= maxAgeDays
  res.valid = true;
  res.historicalLastDate = raw;
  res.historicalDataAgeDays = ageDays;
  return res;
}

// Factory: create TECHNICAL_MOMENTUM signal when techMeta passes freshness check
export function createTechnicalSignalIfFresh(techMeta: any, symbol: string, now?: Date, maxAgeDays = 5){
  try{
    if (!techMeta || techMeta.technicalAnalysisStatus !== 'success' || typeof techMeta.historicalDataPoints !== 'number' || techMeta.historicalDataPoints < 20) return null;
    const techSig = (techMeta.technicalSignal || '').toString().toUpperCase();
    let direction: 'BULLISH'|'BEARISH'|'NEUTRAL' = 'NEUTRAL';
    if (techSig === 'BUY') direction = 'BULLISH'; else if (techSig === 'SELL') direction = 'BEARISH';
    if (direction === 'NEUTRAL') return null;
    const freshness = checkHistoricalFreshness(techMeta.historicalLastDate, now, maxAgeDays);
    if (!freshness.valid) return null;
    const evidence = { momentumPercent: techMeta.technicalMomentumPercent, technicalScore: techMeta.technicalScore, technicalSignal: techMeta.technicalSignal, historicalDataPoints: techMeta.historicalDataPoints, historicalLastDate: freshness.historicalLastDate, historicalDataAgeDays: freshness.historicalDataAgeDays, generatedAt: (now instanceof Date ? now : new Date()).toISOString() } as any;
    const techSignal = { id: `technical_${symbol}`, type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', direction, severity: 'INFO', title: 'Technical: Momentum', description: 'Historical price series momentum', symbols: [symbol], evidence } as any;
    return techSignal;
  }catch(_){ return null; }
}

// Create a symbol-specific RELATIVE_STRENGTH signal comparing symbol changePercent
// against the market average changePercent for comparable instruments in the same cycle.
// Rules:
// - Use only valid, non-stale instruments with numeric changePercent
// - Require at least MIN_COMPARABLES comparable instruments to compute a stable average
// - Require an absolute difference >= RELATIVE_STRENGTH_MIN_DIFF_PERCENT to emit
// Thresholds chosen conservatively to avoid noise: 5 comparables, 0.7 percentage points.
export function createRelativeStrengthSignalForInstrument(instr: any, allInstruments: any[], now?: Date, opts?: { minComparables?: number; minDiffPercent?: number }){
  try{
    if (!instr || typeof instr.changePercent !== 'number') return null;
    if (instr.dataStatus === 'UNAVAILABLE' || instr.isStale) return null;
    const MIN_COMPARABLES = typeof (opts && opts.minComparables) === 'number' ? (opts as any).minComparables : 5;
    const RELATIVE_STRENGTH_MIN_DIFF_PERCENT = typeof (opts && opts.minDiffPercent) === 'number' ? (opts as any).minDiffPercent : 0.7; // absolute percent
    // filter comparables: valid numeric changePercent, not stale, not unavailable
    const comps = Array.isArray(allInstruments) ? allInstruments.filter((i:any)=> i && typeof i.changePercent === 'number' && i.dataStatus !== 'UNAVAILABLE' && !i.isStale) : [];
    if (!Array.isArray(comps) || comps.length < Math.max(MIN_COMPARABLES, 2)) return null;
    // compute market average excluding the instrument itself for stability
    const others = comps.filter((c:any)=> String(c.symbol).toUpperCase() !== String(instr.symbol).toUpperCase());
    if (!Array.isArray(others) || others.length < MIN_COMPARABLES) return null;
    const avg = others.reduce((s:any,c:any)=> s + Number(c.changePercent||0), 0) / others.length;
    if (!Number.isFinite(avg)) return null;
    const rel = Number(instr.changePercent) - avg;
    if (!Number.isFinite(rel)) return null;
    if (Math.abs(rel) < RELATIVE_STRENGTH_MIN_DIFF_PERCENT) return null;
    const dir = rel > 0 ? 'BULLISH' : 'BEARISH';
    const norm = String(instr.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const id = `relative_strength_${norm}`;
    const evidence = { symbolChangePercent: Number(instr.changePercent), marketAverageChangePercent: Number(Number(avg).toFixed(2)), relativeStrengthPercent: Number(Number(rel).toFixed(2)), generatedAt: (now instanceof Date ? now : new Date()).toISOString() } as any;
    const sig = { id, type: 'RELATIVE_STRENGTH', origin: 'MARKET_QUOTES_AGGREGATE', direction: dir, severity: 'INFO', title: 'Relative Strength', description: 'Symbol vs market average', symbols: [String(instr.symbol).toUpperCase()], evidence } as any;
    return sig;
  }catch(_){ return null; }
}

// Helper: simple evaluation rules (module-scope so tests can import)
export function evaluateHoldingActionPublic(h:any, q:any){
  const avg = Number(h.averagePrice || 0);
  const price = (q && (typeof q.priceSek === 'number' ? q.priceSek : (typeof q.price === 'number' ? q.price : null))) || (h.currentPrice||null);
  if (!price || !avg) return { action: 'HOLD', reason: 'No sufficient data', score: 0 };
  // stop-loss if price dropped 5% or more
  if (price <= avg * 0.95) return { action: 'SELL', reason: 'Stop-loss triggered', score: -100 };
  // negative exit if price dropped 2% or more
  if (price <= avg * 0.98) return { action: 'SELL', reason: 'Negative exit signal', score: -50 };
  return { action: 'HOLD', reason: 'No exit signal', score: 0 };
}

export function decideBuySignalFromLastRef(usePrice: number, lastRef: number | null){
  if (!lastRef || !usePrice) return { buySignal: false, reason: 'No prior evaluation' };
  if (usePrice <= lastRef * 0.99) return { buySignal: true, reason: 'Price dipped 1% vs last reference' };
  return { buySignal: false, reason: 'No dip' };
}

// Exported helper: pick up to two supporting market signal ids of distinct types for a given symbol and desired action
export function pickSupportingSignalIds(marketSignals: any, symbol: string | undefined, desiredAction: 'BUY'|'SELL'){
  try{
    if (!marketSignals || !Array.isArray(marketSignals.signals) || marketSignals.signals.length === 0) return [];
    const sigs = marketSignals.signals as any[];
    const sym = symbol ? String(symbol).toUpperCase() : null;
    // Determine which signals actually support the symbol and desired action
    const supporting: any[] = [];
    for (const s of sigs){
      if (!s || !s.id || !s.type) continue;
      let supports = false;
      // Symbol-specific signals
      if (Array.isArray((s as any).symbols) && sym){
        const listed = (s as any).symbols.map((x:any)=> String(x).toUpperCase());
        if (listed.includes(sym)){
          // If the signal carries an explicit direction field (e.g. TECHNICAL_MOMENTUM), prefer it
          if ((s as any).direction){
            const dir = String((s as any).direction).toUpperCase();
            if (dir === 'BULLISH' && desiredAction === 'BUY') supports = true;
            if (dir === 'BEARISH' && desiredAction === 'SELL') supports = true;
            // do not infer further from evidence when explicit direction present
            if (supports) { supporting.push(s); continue; }
          }
          // If we have explicit evidence.changePercent for this symbol, use its sign
          if (s.evidence && typeof s.evidence.changePercent === 'number'){
            if (desiredAction === 'BUY' && s.evidence.changePercent > 0) supports = true;
            if (desiredAction === 'SELL' && s.evidence.changePercent < 0) supports = true;
          } else {
            // infer from type: LEADER -> BUY, LAGGARD -> SELL; otherwise cannot infer
            if (String(s.type).toUpperCase() === 'LEADER' && desiredAction === 'BUY') supports = true;
            if (String(s.type).toUpperCase() === 'LAGGARD' && desiredAction === 'SELL') supports = true;
          }
        }
      }
      // Global signals (no symbol list)
      if (!supports && (!Array.isArray((s as any).symbols) || (s as any).symbols.length === 0)){
        const t = String(s.type).toUpperCase();
        if (t === 'MARKET_TREND'){
          // Expect evidence.marketSentiment only; do not fallback to id text
          const msent = s.evidence && s.evidence.marketSentiment ? String(s.evidence.marketSentiment).toUpperCase() : null;
          if (msent){ if (desiredAction === 'BUY' && msent === 'BULLISH') supports = true; if (desiredAction === 'SELL' && msent === 'BEARISH') supports = true; }
        } else if (t === 'MARKET_BREADTH'){
          // Use advancing/declining counts if present
          const adv = s.evidence && typeof s.evidence.advancing === 'number' ? s.evidence.advancing : undefined;
          const dec = s.evidence && typeof s.evidence.declining === 'number' ? s.evidence.declining : undefined;
          if (typeof adv === 'number' && typeof dec === 'number'){
            if (desiredAction === 'BUY' && adv > dec) supports = true;
            if (desiredAction === 'SELL' && dec > adv) supports = true;
          }
        }
      }
      if (supports) supporting.push(s);
    }

    // Prefer symbol-specific supporting signals first, then global ones; choose up to two distinct types
    const symbolSpecific = supporting.filter(s => Array.isArray((s as any).symbols) && (s as any).symbols.length > 0);
    const global = supporting.filter(s => !Array.isArray((s as any).symbols) || (s as any).symbols.length === 0);
    const ordered = symbolSpecific.concat(global);
    const chosen: any[] = [];
    const seenTypes = new Set<string>();
    for (const s of ordered){ if (!seenTypes.has(String(s.type))){ chosen.push(s); seenTypes.add(String(s.type)); if (chosen.length >= 2) break; } }
    return chosen.map(s=> String(s.id));
  }catch(_){ return []; }
}

// Build compact supporting signal metadata for audits.
// Returns sanitized { signalIds, supportingSignals } given a list of chosen ids and the full marketSignals payload.
export function buildSupportingSignalAuditMetadata(chosenIds: any[] | undefined, marketSignals: any){
  try{
    const ids = Array.isArray(chosenIds) ? Array.from(new Set(chosenIds.map((x:any)=> String(x)))) : [];
    const available = marketSignals && Array.isArray(marketSignals.signals) ? marketSignals.signals : [];
    const supporting: Array<{id:string;type:string;origin:string}> = [];
    for (const id of ids){
      try{
        const obj = available.find((s:any)=> s && String(s.id) === String(id));
        if (!obj || !obj.id) continue;
        const entry = { id: String(obj.id), type: String(obj.type || ''), origin: String(obj.origin || '') };
        if (!supporting.some(ss => ss.id === entry.id)) supporting.push(entry);
      }catch(_){ continue; }
    }
    return { signalIds: ids, supportingSignals: supporting };
  }catch(_){ return { signalIds: [], supportingSignals: [] }; }
}

// Sanitize Decision Intelligence snapshot for inclusion in runtime state / UI
export function sanitizeDecisionIntelligenceForState(snap: any){
  try{
    if (!snap || typeof snap !== 'object') return null;
    const allowed: any = {
      cycleId: snap.cycleId || null,
      symbol: snap.symbol || null,
      generatedAt: snap.generatedAt || null,
      direction: snap.direction || null,
      bullishScore: typeof snap.bullishScore === 'number' ? snap.bullishScore : null,
      bearishScore: typeof snap.bearishScore === 'number' ? snap.bearishScore : null,
      hasConflict: !!snap.hasConflict,
      hasIndependentBullishSupport: !!snap.hasIndependentBullishSupport,
      hasIndependentBearishSupport: !!snap.hasIndependentBearishSupport,
      analysisQuality: snap.analysisQuality || null,
      strongestBullish: snap.strongestBullish || null,
      strongestBearish: snap.strongestBearish || null,
      selectedSupportingSignals: Array.isArray(snap.selectedSupportingSignals) ? snap.selectedSupportingSignals.map((s:any)=> ({ id: s.id, type: s.type, origin: s.origin })) : [],
      warnings: Array.isArray(snap.warnings) ? snap.warnings.slice(0,10) : [],
      reasoning: Array.isArray(snap.reasoning) ? snap.reasoning.slice(0,5) : [],
      schemaVersion: snap.schemaVersion || null,
      source: snap.source || null
    };
    // include sanitized shadow decision when present
    try{
      if (snap && typeof snap.contextAwareShadowDecision === 'object' && snap.contextAwareShadowDecision !== null){
        const s = snap.contextAwareShadowDecision as any;
        const sanitizedShadow: any = {
          schemaVersion: s.schemaVersion || null,
          source: s.source || null,
          symbol: s.symbol || null,
          observedAt: s.observedAt || null,
          generatedAt: s.generatedAt || null,
          actualAction: s.actualAction || null,
          actualConfidence: typeof s.actualConfidence === 'number' ? s.actualConfidence : null,
          shadowAction: s.shadowAction || null,
          shadowConfidence: typeof s.shadowConfidence === 'number' ? s.shadowConfidence : null,
          actionChanged: !!s.actionChanged,
          confidenceDelta: typeof s.confidenceDelta === 'number' ? s.confidenceDelta : null,
          contextAlignment: s.contextAlignment || null,
          intervention: s.intervention || null,
          supportingReasons: Array.isArray(s.supportingReasons) ? s.supportingReasons.slice(0,5) : [],
          conflictingReasons: Array.isArray(s.conflictingReasons) ? s.conflictingReasons.slice(0,5) : [],
          warnings: Array.isArray(s.warnings) ? s.warnings.slice(0,5) : []
        };
        allowed.contextAwareShadowDecision = sanitizedShadow;
      }
    }catch(_){ }
    return allowed;
  }catch(_){ return null; }
}

// Build compact trade feedback summary from auditStore (if any). Returns undefined when none.
export async function computeTradeFeedbackSummary(auditStore: any){
  try{
    const audits = await auditStore.list();
    if (!Array.isArray(audits) || audits.length === 0) return undefined;
    const rows: Array<{ pnlSek:number; pnlPercent:number; verdict:string; ts:string }> = [];
    for (const a of audits){
      if (!a || typeof a !== 'object') continue;
      const raw = (a as Record<string, unknown>)['raw'] ?? a;
      if (!raw || typeof raw !== 'object') continue;
      const evaluation = (raw as Record<string, unknown>)['evaluation'] as Record<string, unknown> | undefined;
      if (!evaluation || typeof evaluation !== 'object') continue;
      const tr = evaluation['tradeReview'] as Record<string, unknown> | undefined;
      if (!tr || typeof tr !== 'object') continue;
      // Use createTradeFeedback to normalize/validate each found trade review entry
      try{
        const execId = (tr['executionId'] || tr['executionId']) as unknown as string;
        const pnlSek = Number(tr['pnlSek']);
        const pnlPercent = Number(tr['pnlPercent']);
        const winner = Boolean(tr['winner']);
        const tf = createTradeFeedback({ executionId: execId ?? '', pnlSek, pnlPercent, winner });
        const ts = (a as Record<string, unknown>)['timestamp'] || (raw as Record<string, unknown>)['timestamp'] || '';
        rows.push({ pnlSek: tf.pnlSek, pnlPercent: tf.pnlPercent, verdict: tf.verdict, ts: String(ts) });
      }catch(_){ /* skip invalid review entries */ }
    }
    if (rows.length === 0) return undefined;
    const wins = rows.filter(r => r.verdict === 'STRONG_WIN' || r.verdict === 'WIN').length;
    const avgPnl = rows.reduce((s,r)=> s + r.pnlSek, 0) / rows.length;
    rows.sort((a,b)=> (a.ts || '') > (b.ts || '') ? 1 : -1);
    const last = rows[rows.length-1];

    // Build per-signal summary using existing helper which respects decision.signals and dedup rules
    let bySignal: Array<{ signalId: string; evaluatedCount: number; winRate: number; avgPnlSek: number }> = [];
    try{
      const sigs = summarizeFeedbackBySignal(audits as any);
      if (Array.isArray(sigs) && sigs.length > 0){
        bySignal = sigs.map(s=> ({ signalId: s.signalId, evaluatedCount: s.evaluatedCount, winRate: s.winRate, avgPnlSek: s.avgPnlSek }));
      }
    }catch(_){ bySignal = []; }

    return { winRate: wins / rows.length, avgPnlSek: avgPnl, evaluatedCount: rows.length, lastVerdict: last.verdict, bySignal };
  }catch(_){ return undefined; }
}

class InMemoryAuditStore {
  entries: AuditEntry[] = [];
  async append(e: AuditEntry){
    // Ensure stored audit IDs are unique even if producer generated identical ids
    const baseId = e.id || `audit_${Date.now()}`;
    let uniqueId = baseId;
    let suffix = 1;
    while (this.entries.find(x => x.id === uniqueId)){
      uniqueId = `${baseId}_${suffix++}`;
    }
    const toStore = { ...e, id: uniqueId } as AuditEntry;
    this.entries.push(toStore);
  }
  async list(){
    // Ensure that stored entries have unique ids (fix pre-existing duplicates)
    const seen = new Set<string>();
    for (let i = 0; i < this.entries.length; i++){
      const e = this.entries[i];
      let id = e.id || `audit_${i}`;
      if (seen.has(id)){
        let suffix = 1;
        let newId = `${id}_${suffix}`;
        while (seen.has(newId)){
          suffix++;
          newId = `${id}_${suffix}`;
        }
        this.entries[i] = { ...e, id: newId } as AuditEntry;
        id = newId;
      }
      seen.add(id);
    }
    return this.entries.slice().reverse();
  }
}

// File-backed audit store: persists audit entries to a JSON file under src/data
class FileAuditStore {
  private entries: any[] = [];
  private path: string;
  constructor(filePath: string){
    this.path = filePath;
    try{
      if (fs.existsSync(this.path)){
        const raw = fs.readFileSync(this.path, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.entries = parsed;
      }
    }catch(e){
      this.entries = [];
    }
  }

  private makeSummary(e: any){
    const decision = e.decision || (Array.isArray(e.decisions) && e.decisions[0]) || null;
    const exec = e.execution || (Array.isArray(e.executed) && e.executed[0] && (e.executed[0].result || e.executed[0].execution)) || null;
    const portfolioBefore = e.portfolioBefore || e.before || null;
    const portfolioAfter = e.portfolioAfter || e.after || null;
    const holdingBefore = portfolioBefore && Array.isArray(portfolioBefore.holdings) ? portfolioBefore.holdings : null;
    const holdingAfter = portfolioAfter && Array.isArray(portfolioAfter.holdings) ? portfolioAfter.holdings : null;
    return {
      cycleId: (e && (e as any).cycleId) ? (e as any).cycleId : (e && e.id) ? e.id : null,
      decisionId: decision && decision.id ? decision.id : null,
      symbol: decision && (decision.symbol || decision.instrumentId) || null,
      action: decision && decision.action ? decision.action : null,
      confidence: decision && typeof decision.confidence === 'number' ? decision.confidence : null,
      referencePrice: decision && typeof decision.referencePrice === 'number' ? decision.referencePrice : null,
      quoteTimestamp: decision && (decision.generatedAt || null),
      // Prefer an explicit `risk` object on the decision/execution if present. Reuse as-is.
      risks: (decision && (decision as any).risk) ? (decision as any).risk : (exec && (exec as any).risk) ? (exec as any).risk : (decision && (decision.risks || decision.reasoning)) || null,
      executionStatus: exec && exec.status ? exec.status : (exec ? 'EXECUTED' : null),
      executedPrice: exec && typeof exec.executedPrice === 'number' ? exec.executedPrice : null,
      quantity: exec && typeof exec.quantity === 'number' ? exec.quantity : null,
      notional: exec && typeof exec.notional === 'number' ? exec.notional : null,
      fee: exec && typeof exec.fee === 'number' ? exec.fee : null,
      cashBefore: portfolioBefore && typeof portfolioBefore.availableCash === 'number' ? portfolioBefore.availableCash : null,
      cashAfter: portfolioAfter && typeof portfolioAfter.availableCash === 'number' ? portfolioAfter.availableCash : null,
      holdingBefore,
      holdingAfter,
      createdAt: e.timestamp || new Date().toISOString(),
    };
  }

  private persistSync(){
    try{
      const dir = path.dirname(this.path);
      try{ fs.mkdirSync(dir, { recursive: true }); }catch(e){}
      const tmp = `${this.path}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2), 'utf-8');
      try{ fs.renameSync(tmp, this.path); }catch(e){ fs.writeFileSync(this.path, JSON.stringify(this.entries, null, 2), 'utf-8'); }
    }catch(e){ console.error('FileAuditStore persist failed', e); }
  }

  async append(e: AuditEntry){
    const baseId = e.id || `audit_${Date.now()}`;
    let uniqueId = baseId; let suffix = 1;
    while (this.entries.find((x:any) => x && x.raw && x.raw.id === uniqueId)) uniqueId = `${baseId}_${suffix++}`;
    const entryWithId = { ...e, id: uniqueId } as any;
    const summary = this.makeSummary(entryWithId);
    const toStore = { id: uniqueId, timestamp: entryWithId.timestamp || new Date().toISOString(), summary, raw: entryWithId };
    this.entries.push(toStore);
    this.persistSync();
  }

  async list(){
    return this.entries.slice().reverse();
  }
}

function createInMemoryPortfolioAdapter(initialCash: number){
  const PORTFOLIO_PATH = path.join(process.cwd(), 'src', 'data', 'portfolio.json');

  // initialize state from file if exists, otherwise default
  let state: Portfolio = {
    id: 'demo', baseCurrency: 'SEK', totalValue: initialCash, availableCash: initialCash, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: []
  };

  try{
    if (fs.existsSync(PORTFOLIO_PATH)){
      const raw = fs.readFileSync(PORTFOLIO_PATH, 'utf-8');
      try{
        const parsed = JSON.parse(raw);
        // basic validation
        if (parsed && typeof parsed.availableCash === 'number') state = parsed;
        else {
          // write default if parsed is invalid
          fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(state, null, 2), 'utf-8');
        }
      }catch(e){
        console.error('portfolio.json parse error, resetting to default', e);
        fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(state, null, 2), 'utf-8');
      }
    } else {
      // create file from default
      try{ fs.mkdirSync(path.dirname(PORTFOLIO_PATH), { recursive: true }); }catch(e){}
      fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(state, null, 2), 'utf-8');
    }
  }catch(e){
    console.error('Failed to initialize portfolio persistence', e);
  }

  function persist(){
    try{ fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(state, null, 2), 'utf-8'); }catch(e){ console.error('Failed to persist portfolio', e); }
  }

  return {
    getPortfolio: async ()=> JSON.parse(JSON.stringify(state)),
    applyExecution: async (exec: SimulatedExecution)=>{
      const nextPortfolio = computeNextPortfolioState(state, exec);
      state = nextPortfolio;
      persist();
      return JSON.parse(JSON.stringify(state));
    }
  };
}

// initialize runtime
const AUDIT_PATH = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
// choose audit store using same env used for portfolio store configuration
const _store = (process.env && process.env.PAPER_TRADER_PORTFOLIO_STORE) || '';
const auditStore = _store === 'supabase' ? new SupabaseAuditAdapter() : new FileAuditStore(AUDIT_PATH);
export function createRuntimePortfolioAdapter(){
  const store = (process.env && process.env.PAPER_TRADER_PORTFOLIO_STORE) || '';
  if (store === 'supabase'){
    const rawId = (process.env && process.env.PAPER_TRADER_PORTFOLIO_ID) || '';
    const portfolioId = (typeof rawId === 'string' ? rawId.trim() : '') || 'demo';
    return createSupabasePortfolioAdapter(portfolioId);
  }
  return createInMemoryPortfolioAdapter(START_CAPITAL);
}

const portfolioAdapter = createRuntimePortfolioAdapter();

// export FileAuditStore for focused tests
export { FileAuditStore };

// --- Test helpers (exported for unit tests) ---
let injectedCycleTrader: any | undefined = undefined;
export function __setTestTrader(t:any){
  try{ (runtime as any).trader = t; }catch(e){ }
  injectedCycleTrader = t;
}

// Return any injected per-cycle trader (module-scoped so vi.resetModules() clears it)
function getInjectedCycleTrader(): any | undefined { return injectedCycleTrader; }

export function __setTestPortfolio(adapter:any){
  try{ (runtime as any).portfolioAdapter = adapter; }catch(e){}
}

export async function __appendTestAudits(entries: any[]){
  try{
    for (const e of entries){ await auditStore.append(e); }
  }catch(e){ }
}

// Clear persisted/in-memory audit entries for test isolation.
export async function __clearAudits(){
  try{
    // If underlying store exposes an entries array (FileAuditStore or InMemoryAuditStore), clear it
    try{
      if ((auditStore as any) && Array.isArray((auditStore as any).entries)){
        (auditStore as any).entries = [];
      }
    }catch(_){ }

    // If store provides a persistSync method (file-backed), persist empty state
    try{ if ((auditStore as any) && typeof (auditStore as any).persistSync === 'function') (auditStore as any).persistSync(); }catch(_){ }

    // If store exposes an async clear() helper, call it
    try{ if ((auditStore as any) && typeof (auditStore as any).clear === 'function') await (auditStore as any).clear(); }catch(_){ }
  }catch(_){ }
}

// Test helper: expose raw audit entries for verification
export async function __listAudits(){
  try{ const all = await auditStore.list(); return Array.isArray(all) ? all : []; }catch(_){ return []; }
}

// Test helper: expose internal runtime for assertions in unit tests


const config: PaperTraderConfig = {
  enabled: true,
  minimumBuyConfidence: 75,
  minimumSellConfidence: 75,
  maxPositionPercent: 0.10,
  maxOrderValueSek: 10_000,
  feesBps: 10,
  slippageBps: 5,
  cooldownMs: 60_000,
  maxTradesPerCycle: 1,
};

let trader = createPaperTrader({ portfolioAdapter, auditStore, config });

const runtime: RuntimeState = {
  startCapital: START_CAPITAL,
  enabled: config.enabled || false,
  trader: trader,
  portfolioAdapter,
  auditStore,
  latestDecision: null,
  latestCycle: null,
  latestMarketNewsActivity: undefined,
  lastUpdated: nowIso(),
  autonomousEnabled: true,
  latestDecisionIntelligenceBySymbol: {},
  latestHistoricalMarketContextBySymbol: {},
  forexReadiness: null,
  externalIntelligenceReadiness: null,
  forexAutonomyArmed: false,
  forexLaunchControl: null,
  latestForexCycleStatus: null,
  forexNoTradeSummary: null,
  // scheduler is represented by the global singleton; do not duplicate state here
};

export function setForexAutonomyArmed(armed: boolean){
  try{ runtime.forexAutonomyArmed = !!armed; }catch(_){ }
}

export function getForexAutonomyArmed(){
  try{ return !!runtime.forexAutonomyArmed; }catch(_){ return false; }
}

// Scheduler singleton stored at module scope to survive hot reloads in dev
type SchedulerState = {
  timerId: NodeJS.Timeout | null;
  inProgress: boolean;
  lastRunAt: number | null;
  intervalMs: number;
  // diagnostics persisted on the singleton
  lastAutomaticRunStatus?: 'success' | 'skipped' | 'error' | null;
  lastAutomaticRunMessage?: string | null;
  lastAutomaticEvaluationCount?: number | null;
  lastAutomaticAuditCountBefore?: number | null;
  lastAutomaticAuditCountAfter?: number | null;
  // optional diagnostics when lock acquisition or automatic run is skipped
  lastAutomaticLockDiagnostics?: any | null;
  // dynamic callback that can be replaced on hot-reload without replacing timer
  runTick?: (() => Promise<void>) | null;
};

// Global keyed singleton to survive module reloads in the same Node process
const GLOBAL_SCHEDULER_KEY = '__ATLAS_PAPER_TRADER_SCHEDULER__';

declare global {
  // Attach a typed scheduler to globalThis for stable ownership across HMR
  var __ATLAS_PAPER_TRADER_SCHEDULER__: SchedulerState | undefined;
}

function getGlobalScheduler(): SchedulerState {
  const g = globalThis as any;
  if (g.__ATLAS_PAPER_TRADER_SCHEDULER__ && typeof g.__ATLAS_PAPER_TRADER_SCHEDULER__ === 'object'){
    return g.__ATLAS_PAPER_TRADER_SCHEDULER__ as SchedulerState;
  }
  const initial: SchedulerState = { timerId: null, inProgress: false, lastRunAt: null, intervalMs: 60_000, runTick: null, lastAutomaticRunStatus: null, lastAutomaticRunMessage: null, lastAutomaticEvaluationCount: null, lastAutomaticAuditCountBefore: null, lastAutomaticAuditCountAfter: null } as SchedulerState;
  try{ g.__ATLAS_PAPER_TRADER_SCHEDULER__ = initial; }catch(_){ /* ignore in restricted envs */ }
  return initial;
}
export function getSchedulerState(){ return getGlobalScheduler(); }

// Autopilot decision helper: determines whether an automatic analysis should run next.
// Uses existing market-session helper `getNextNYOpenInstant` and scheduler state.
export function decideAutopilotRun(opts?: { now?: string | Date }){
  const now = opts && opts.now ? new Date(opts.now) : new Date();
  const sched = getGlobalScheduler();
  const market = getNextNYOpenInstant(now);
  let marketOpen = market.open === true;
  // Extra guard: ensure weekend instants in NY timezone are treated as closed
  try{
    const wk = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
    if (wk === 'Sat' || wk === 'Sun') marketOpen = false;
  }catch(_){ }

  // Determine if a cycle is currently running
  const alreadyRunning = Boolean(sched.inProgress === true);

  // Determine cooldown using configured cooldownMs and lastRunAt
  const cooldownMs = (config && typeof config.cooldownMs === 'number') ? config.cooldownMs : 0;
  const lastRunAt = typeof sched.lastRunAt === 'number' ? sched.lastRunAt : (sched.lastRunAt ? Number(new Date(sched.lastRunAt)) : null);
  let cooldownActive = false;
  let cooldownUntil: number | null = null;
  if (lastRunAt && cooldownMs > 0){
    const elapsed = Date.now() - lastRunAt;
    if (elapsed < cooldownMs){ cooldownActive = true; cooldownUntil = lastRunAt + cooldownMs; }
  }

  // Decide next run
  let shouldRun = false;
  let nextRunAt: Date | null = null;
  let reason = '';

  if (alreadyRunning){
    shouldRun = false; reason = 'Cycle already in progress';
    nextRunAt = new Date(Date.now() + 1000 * 60); // suggest short retry
  } else if (!marketOpen){
    shouldRun = false; reason = 'Market closed';
    // market may be typed as { open: true } | { open: false; nextOpenInstant: Date }
    if ((market as any) && (market as any).nextOpenInstant) nextRunAt = new Date((market as any).nextOpenInstant);
    else nextRunAt = null;
  } else if (cooldownActive){
    shouldRun = false; reason = 'Cooldown active';
    nextRunAt = cooldownUntil ? new Date(cooldownUntil) : null;
  } else {
    shouldRun = true; reason = 'Market open and ready'; nextRunAt = null;
  }

  return { shouldRun, nextRunAt, reason, marketOpen, cooldownActive, alreadyRunning } as any;
}

// Asset-aware session helper: determines whether a given instrument is tradable now
// Rules:
// - STOCK: uses NY market open check (same as decideAutopilotRun)
// - FOREX: 24/5, closed Fri 22:00 UTC -> Sun 22:00 UTC (inclusive)
// - COMMODITY: same 24/5 simplified rule as Forex (paper-trading simplification)
// - unknown: fallback to STOCK behaviour
export function isInstrumentTradableNow(instr: any, now?: Date){
  try{
    const t = now instanceof Date ? now : new Date();
    const type = instr && instr.assetType ? String(instr.assetType).toUpperCase() : 'STOCK';
    if (type === 'FOREX' || type === 'COMMODITY'){
      // Determine UTC day/hours for 24/5 rule
      const day = t.getUTCDay(); // 0=Sun .. 6=Sat
      const hour = t.getUTCHours();
      // Closed on Saturday
      if (day === 6) return false;
      // Sunday before 22:00 UTC closed
      if (day === 0 && hour < 22) return false;
      // Friday at or after 22:00 UTC closed
      if (day === 5 && hour >= 22) return false;
      return true; // otherwise open
    }
    // STOCK/unknown -> reuse NY market helper
    try{
      const ny = getNextNYOpenInstant(t);
      let open = ny && (ny as any).open === true;
      try{ const wk = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(t); if (wk === 'Sat' || wk === 'Sun') open = false; }catch(_){ }
      return !!open;
    }catch(_){ return false; }
  }catch(_){ return false; }
}

// Helper to check whether any non-stock instrument is currently eligible (market-wise)
export function anyNonStockInstrumentsEligible(now?: Date){
  try{
    // use module-scoped TRADABLE_INSTRUMENTS
    if (Array.isArray(TRADABLE_INSTRUMENTS)){
      return TRADABLE_INSTRUMENTS.some(i => {
        const enabled = (i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true);
        if (!enabled) return false;
        const t = now instanceof Date ? now : new Date();
        const type = i.assetType ? String(i.assetType).toUpperCase() : 'STOCK';
        if (type === 'STOCK') return false;
        return isInstrumentTradableNow(i, t);
      });
    }
    return false;
  }catch(_){ return false; }
}

// Implementation used as the dynamic runTick that can be swapped on hot-reload
async function runAutomaticCycleImplementation(){
    const sched = getGlobalScheduler();
  // If another run is in progress at the scheduler level, return early
  if (sched.inProgress) return { ran: false, reason: 'already_running' } as any;

  // Ask autopilot whether we should run now
  let decision: any = null;
  try{ decision = decideAutopilotRun(); }catch(_){ decision = null; }
  if (decision && !decision.shouldRun){
    // Compute per-instrument eligibility now; allow run only if at least one
    // enabled instrument is tradable now. This replaces the previous anyNonStock
    // bypass with a complete per-symbol eligibility check.
    try{
      const now = new Date();
      const eligible = Array.isArray(TRADABLE_INSTRUMENTS) ? TRADABLE_INSTRUMENTS.filter(i => {
        const enabled = (i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true);
        if (!enabled) return false;
        return isInstrumentTradableNow(i, now);
      }) : [];
      if (!eligible || eligible.length === 0){
        sched.lastAutomaticRunStatus = 'skipped';
        sched.lastAutomaticRunMessage = decision.reason || 'skipped by autopilot';
        try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
        return { ran: false, reason: sched.lastAutomaticRunMessage, nextRunAt: decision.nextRunAt || null } as any;
      }
      // otherwise continue with run but record diagnostic
      sched.lastAutomaticRunMessage = 'Continuing run for eligible instruments despite global market closed';
    }catch(e){
      sched.lastAutomaticRunStatus = 'skipped';
      sched.lastAutomaticRunMessage = decision.reason || 'skipped by autopilot';
      try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
      return { ran: false, reason: sched.lastAutomaticRunMessage, nextRunAt: decision.nextRunAt || null } as any;
    }
  }

  // Acquire distributed lock to ensure single execution across processes
  const GLOBAL_RUN_CYCLE_LOCK_KEY = 'paper-trader:cycle:default';
  const LOCK_TTL_SECONDS = 900; // 15 minutes default (see run-cycle-lock.ts)
  let ownerToken: string | null = null;
  try{
    // Create a local attempt token for diagnostic correlation (not a secret)
    const attemptOwnerToken = (()=>{ try{ if (typeof (global as any).crypto !== 'undefined' && typeof (global as any).crypto.randomUUID === 'function') return (global as any).crypto.randomUUID(); }catch(_){ } return `t_${Date.now()}_${Math.random().toString(36).slice(2,9)}` })();
    const lockRes = await acquireRunCycleLockWithOwner(GLOBAL_RUN_CYCLE_LOCK_KEY, LOCK_TTL_SECONDS);
    const lockBackend = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ? 'upstash' : 'local';
    const lockFullKey = `atlas:paper-trader:run-cycle:${GLOBAL_RUN_CYCLE_LOCK_KEY}`;

    if (lockRes.status === 'DUPLICATE'){
      sched.lastAutomaticRunStatus = 'skipped'; sched.lastAutomaticRunMessage = 'duplicate_lock';
      try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
      // attach machine-readable lock diagnostics for troubleshooting
      const diag = {
        skipReasonCode: 'DUPLICATE_LOCK',
        skipStage: 'run_cycle_lock',
        lockBackend,
        lockKey: lockFullKey,
        lockTtlMs: Number(LOCK_TTL_SECONDS) * 1000,
        lockOwnerId: (lockRes as any).ownerToken || attemptOwnerToken,
        lockDeniedAt: new Date().toISOString(),
      } as any;
      try{ sched.lastAutomaticLockDiagnostics = diag; }catch(_){ }
      try{ console.debug && console.debug('runAutomaticCycleImplementation: duplicate lock', diag); }catch(_){ }
      return { ran: false, reason: 'duplicate_lock', duplicate: true, ...diag } as any;
    }
    if (lockRes.status === 'UNAVAILABLE'){
      sched.lastAutomaticRunStatus = 'skipped'; sched.lastAutomaticRunMessage = 'lock_unavailable';
      try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
      const diag = {
        skipReasonCode: 'LOCK_UNAVAILABLE',
        skipStage: 'run_cycle_lock',
        lockBackend,
        lockKey: lockFullKey,
        lockTtlMs: Number(LOCK_TTL_SECONDS) * 1000,
        lockOwnerId: (lockRes as any).ownerToken || null,
        lockDeniedAt: new Date().toISOString(),
      } as any;
      try{ sched.lastAutomaticLockDiagnostics = diag; }catch(_){ }
      return { ran: false, reason: 'lock_unavailable', ...diag } as any;
    }
    ownerToken = (lockRes as any).ownerToken || null;
  }catch(e){ sched.lastAutomaticRunStatus = 'skipped'; sched.lastAutomaticRunMessage = 'lock_error'; try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; } const diag = { skipReasonCode: 'LOCK_ERROR', skipStage: 'run_cycle_lock', lockBackend: (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ? 'upstash' : 'local', lockKey: `atlas:paper-trader:run-cycle:${GLOBAL_RUN_CYCLE_LOCK_KEY}`, lockTtlMs: Number(LOCK_TTL_SECONDS) * 1000, lockOwnerId: null, lockDeniedAt: new Date().toISOString() }; try{ const s = getGlobalScheduler(); s.lastAutomaticLockDiagnostics = diag; }catch(_){ } return { ran: false, reason: 'lock_error', ...diag } as any; }

  // mark running
  sched.inProgress = true;
  // initialize diagnostics
  sched.lastAutomaticRunStatus = null;
  sched.lastAutomaticRunMessage = null;
  sched.lastAutomaticEvaluationCount = null;
  sched.lastAutomaticAuditCountBefore = null;
  sched.lastAutomaticAuditCountAfter = null;

  const startedAt = new Date().toISOString();
  let cycleResult: any = null;
  let cycleError: any = null;
  try{
    // snapshot audit counts before run
    let beforeList: any[] = [];
    try{ beforeList = await auditStore.list(); }catch(_){ beforeList = []; }
    const beforeCount = Array.isArray(beforeList) ? beforeList.length : 0;
    const beforeEvalCount = Array.isArray(beforeList) ? beforeList.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION').length : 0;

    // Evaluate launch control before executing the manual cycle when invoked by scheduler
    let tickCycleId: string | null = null;
    try{
        tickCycleId = `auto_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
        const fr = runtime.forexReadiness || null;
        const schedState = getGlobalScheduler();
        // compute real daily counters for launch control
        const daily = await buildDailyTradingSummary({ auditStore, now: new Date() }).catch(()=> ({ executedTradeCount: 0, realizedPnLSek: 0, dailyLossSek: 0, dateKey: new Date().toISOString(), timezone: 'Europe/Stockholm' }));
        const maxTradesPerDay = typeof DEFAULT_PAPER_AUTO_MANDATE.maxTradesPerDay === 'number' && isFinite(DEFAULT_PAPER_AUTO_MANDATE.maxTradesPerDay) ? DEFAULT_PAPER_AUTO_MANDATE.maxTradesPerDay : 9999;
        const pct = typeof DEFAULT_PAPER_AUTO_MANDATE.maxDailyLossPercent === 'number' && isFinite(DEFAULT_PAPER_AUTO_MANDATE.maxDailyLossPercent) ? DEFAULT_PAPER_AUTO_MANDATE.maxDailyLossPercent : 0;
        const dailyLossLimitSek = Math.round(((runtime && typeof runtime.startCapital === 'number' ? runtime.startCapital : START_CAPITAL) * (pct/100)) * 100) / 100;
        const lc = buildForexLaunchControlState({
          now: new Date(),
          forexReadiness: fr,
          autonomousEnabled: !!runtime.autonomousEnabled,
          schedulerEnabled: !!runtime.autonomousEnabled,
          cycleLocked: !!schedState.inProgress,
          tradesToday: typeof daily.executedTradeCount === 'number' ? daily.executedTradeCount : 0,
          maxTradesPerDay,
          dailyLossSek: typeof daily.dailyLossSek === 'number' ? daily.dailyLossSek : 0,
          dailyLossLimitSek,
          isArmed: !!runtime.forexAutonomyArmed,
          cycleRunning: false,
        });
      // persist defensive copy for telemetry
      try{ runtime.forexLaunchControl = JSON.parse(JSON.stringify(lc)); }catch(_){ runtime.forexLaunchControl = lc as any; }
      // emit a lightweight audit for launch control check
      try{ await auditStore.append({ kind: 'FOREX_LAUNCH_CONTROL', cycleId: tickCycleId, raw: Object.assign({}, lc, { executionMode: runtime.forexAutonomyArmed ? 'EXECUTION_ALLOWED' : 'DIAGNOSTIC_ONLY' }), createdAt: new Date().toISOString() } as any); }catch(_){ }

      // If not safe to start cycle and there are eligible forex instruments, skip run
      if (!lc.isSafeToStartCycle){
        // determine whether any non-stock instrument eligible would be forex
        const now = new Date();
        const eligibleForex = Array.isArray(TRADABLE_INSTRUMENTS) ? TRADABLE_INSTRUMENTS.filter(i => {
          const enabled = (i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true);
          if (!enabled) return false;
          const type = i.assetType ? String(i.assetType).toUpperCase() : 'STOCK';
          if (type === 'STOCK') return false;
          return isInstrumentTradableNow(i, now);
        }) : [];
        // if any forex-like instruments eligible, skip
        if (eligibleForex && eligibleForex.length > 0){
          cycleResult = { skipped: true, code: 'launch_control_blocked', reason: lc.blockingReasons, cycleId: tickCycleId } as any;
          // persist lastForexCycleStatus for telemetry
          try{ runtime.latestForexCycleStatus = { cycleId: tickCycleId, status: 'SKIPPED', executionMode: 'DIAGNOSTIC_ONLY', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), analyzedPairCount: 0, executionCandidateCount: 0, executedTradeCount: 0, blockingReasons: lc.blockingReasons.slice() }; }catch(_){ }
        }
      }
    }catch(e){ /* non-fatal; continue trying to run */ }

    try{ if (!cycleResult) cycleResult = await runManualPaperTradingCycle({ allowWhenScheduler: true, cycleId: tickCycleId || undefined } as any); }catch(e:any){ cycleError = e; }

    // snapshot after run
    let afterList: any[] = [];
    try{ afterList = await auditStore.list(); }catch(_){ afterList = []; }
    const afterCount = Array.isArray(afterList) ? afterList.length : 0;
    const afterEvalCount = Array.isArray(afterList) ? afterList.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION').length : 0;

    // determine evaluationCount: prefer explicit result property if present
    let evalCount: number | null = null;
    try{ if (cycleResult && typeof (cycleResult as any).evaluationCount === 'number') evalCount = (cycleResult as any).evaluationCount; }catch(_){ evalCount = null; }
    if (evalCount === null) evalCount = afterEvalCount - beforeEvalCount;

    // determine status and message
    if (cycleError){
      sched.lastAutomaticRunStatus = 'error';
      sched.lastAutomaticRunMessage = cycleError && cycleError.message ? String(cycleError.message) : String(cycleError);
    } else if (cycleResult && cycleResult.skipped){
      sched.lastAutomaticRunStatus = 'skipped'; sched.lastAutomaticRunMessage = cycleResult.code || String(cycleResult.reason || 'skipped');
    } else {
      sched.lastAutomaticRunStatus = 'success'; sched.lastAutomaticRunMessage = null;
    }

    sched.lastAutomaticAuditCountBefore = beforeCount;
    sched.lastAutomaticAuditCountAfter = afterCount;
    sched.lastAutomaticEvaluationCount = typeof evalCount === 'number' ? evalCount : null;

  }catch(e:any){
    try{ sched.lastAutomaticRunStatus = 'error'; sched.lastAutomaticRunMessage = String(e && e.message ? e.message : e); }catch(_){ }
  }finally{
    // record finish time and clear inProgress so next interval can run
    try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
    // best-effort release lock
    try{ if (ownerToken) await releaseRunCycleLock(GLOBAL_RUN_CYCLE_LOCK_KEY, ownerToken); }catch(_){ }
    sched.inProgress = false;
    const completedAt = new Date().toISOString();
    return { ran: true, reason: sched.lastAutomaticRunMessage || 'completed', startedAt, completedAt, nextRunAt: null, cycleResult: (typeof cycleResult !== 'undefined' ? cycleResult : null), errorCode: (cycleError ? (cycleError && cycleError.message ? String(cycleError.message) : String(cycleError)) : null) } as any;
  }
}

function startAutonomousScheduler(intervalMs?: number){
  const sched = getGlobalScheduler();
  if (typeof intervalMs === 'number') sched.intervalMs = intervalMs;
  if (sched.timerId) return; // already running
  // schedule periodic runs using a stable wrapper that calls the dynamic runTick.
  // The wrapper does not capture the run implementation; it calls the current `runTick` and
  // attaches an error handler so rejections from a swapped runTick are recorded as diagnostics.
  sched.timerId = setInterval(()=>{
    try{
      const s = getGlobalScheduler();
      const p = s.runTick && s.runTick();
      if (p && typeof (p as any).catch === 'function'){
        (p as any).catch((err:any) => {
          try{ s.lastAutomaticRunStatus = 'error'; s.lastAutomaticRunMessage = String(err && err.message ? err.message : err); }catch(_){ }
          try{ s.lastRunAt = Date.now(); }catch(_){ s.lastRunAt = null; }
        });
      }
    }catch(e){
      try{ const s = getGlobalScheduler(); s.lastAutomaticRunStatus = 'error'; s.lastAutomaticRunMessage = String((e as any) && (e as any).message ? (e as any).message : e); s.lastRunAt = Date.now(); }catch(_){ }
    }
  }, sched.intervalMs);
}

function stopAutonomousScheduler(){
  const sched = getGlobalScheduler();
  if (sched.timerId){ clearInterval(sched.timerId); sched.timerId = null; }
}


export async function getPaperTradingState(){
  // GET must be read-only: do not start scheduler, trigger cycles, or mutate scheduler state here.
  const p = await portfolioAdapter.getPortfolio();
  const allAudits = await auditStore.list();
  // By default show only audits related to the latestDecision (final outcome) to keep Activity Feed focused.
  let audits = allAudits;
  try{
    if (runtime.latestDecision && runtime.latestDecision.id){
      const decId = runtime.latestDecision.id;
      const filtered = allAudits.filter((a:any)=>{
        try{
          if (a && a.raw && a.raw.decision && a.raw.decision.id === decId) return true;
          if (a && a.summary && a.summary.decisionId === decId) return true;
        }catch(e){}
        return false;
      });
      if (filtered && filtered.length>0) audits = filtered;
      else {
        // fallback: show latest EXECUTION if present, otherwise show the most recent REJECT
        const exec = allAudits.find((a:any)=> a && a.raw && a.raw.kind === 'EXECUTION');
        if (exec) audits = [exec];
        else audits = allAudits.slice(0,1);
      }
    }
  }catch(_){ audits = allAudits; }

  // Attempt to fetch live normalized quotes for holdings to compute mark-to-market
  let quotes: any[] | null = null;
  let quoteFetchOk = false;
  let quoteFetchMessage: string | null = null;
  try{
    const mod = await import('../market-data/quotes-service');
    if (mod && typeof mod.getNormalizedQuotes === 'function'){
      const res = await mod.getNormalizedQuotes();
      if (res && Array.isArray(res.quotes)){
        quotes = res.quotes;
        quoteFetchOk = true;
      } else {
        quoteFetchOk = false;
        quoteFetchMessage = 'No quotes returned';
      }
    }
  }catch(e:any){ quoteFetchOk = false; quoteFetchMessage = String(e?.message || e); }

  // Map quotes by symbol and instrumentId for easy lookup
  const quoteBySymbol = new Map<string, any>();
  const quoteById = new Map<string, any>();
  if (quotes){
    for (const q of quotes){
      if (q && q.symbol) quoteBySymbol.set(String(q.symbol).toUpperCase(), q);
      if (q && q.instrumentId) quoteById.set(String(q.instrumentId).toLowerCase(), q);
    }
  }

  // Compute holdings mark-to-market using fetched quotes when available; otherwise keep last known price
  const holdings = (p.holdings || []).map((h:any) => {
    try{
      const symbol = (h.symbol || '').toString().toUpperCase();
      const qty = Number(h.quantity || 0);
      const avg = Number(h.averagePrice || 0);
      let currentPrice = typeof h.currentPrice === 'number' ? h.currentPrice : undefined;

      // Prefer SEK-normalized price (priceSek) when present, otherwise price
      const q = (quotes && quoteBySymbol.get(symbol)) || null;
      if (q){
        if (typeof q.priceSek === 'number' && Number.isFinite(q.priceSek) && q.priceSek > 0) currentPrice = q.priceSek;
        else if (typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0 && (q.currency === 'SEK' || !q.currency)) currentPrice = q.price;
      }

      // If still undefined, try instrumentId lookup if holding has instrumentId
      if ((currentPrice === undefined || currentPrice === null) && h.instrumentId && quotes){
        const q2 = quoteById.get(String(h.instrumentId).toLowerCase());
        if (q2){ if (typeof q2.priceSek === 'number') currentPrice = q2.priceSek; else if (typeof q2.price === 'number') currentPrice = q2.price; }
      }

      // If no fresh price available, keep stored currentPrice (do not crash)
      const usePrice = (typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0) ? currentPrice : (typeof h.currentPrice === 'number' ? h.currentPrice : null);

      const marketValue = usePrice !== null ? Math.round(qty * usePrice * 100)/100 : (typeof h.marketValue === 'number' ? h.marketValue : 0);
      const invested = Math.round(qty * avg * 100)/100;
      const unrealizedPnl = usePrice !== null ? Math.round(((usePrice - avg) * qty) * 100)/100 : 0;
      const unrealizedPnlPct = (avg > 0 && usePrice !== null) ? Math.round(((usePrice / avg - 1) * 100) * 100)/100 : 0;

      return { ...h, currentPrice: usePrice, marketValue, invested, unrealizedPnl, unrealizedPnlPct };
    }catch(_){ return h; }
  });

  // Aggregates
  const totalInvested = holdings.reduce((s:any,h:any) => s + (Number(h.invested) || 0), 0);
  const totalMarketValue = holdings.reduce((s:any,h:any) => s + (Number(h.marketValue) || 0), 0);
  const totalUnrealized = holdings.reduce((s:any,h:any) => s + (Number(h.unrealizedPnl) || 0), 0);

  const computedTotalValue = Math.round(((p.availableCash || 0) + totalMarketValue) * 100)/100;

  const out: any = {
    enabled: runtime.enabled,
    mode: 'PAPER',
    startCapital: runtime.startCapital,
    availableCash: p.availableCash,
    holdings,
    totalInvested: Math.round(totalInvested * 100)/100,
    totalValue: computedTotalValue,
    totalMarketValue: Math.round(totalMarketValue * 100)/100,
    totalUnrealized: Math.round(totalUnrealized * 100)/100,
    totalReturnSek: Math.round((computedTotalValue - runtime.startCapital) * 100)/100,
    totalReturnPercent: Math.round(((computedTotalValue / runtime.startCapital - 1) * 100) * 100)/100,
    latestDecision: runtime.latestDecision || null,
    latestCycle: runtime.latestCycle || null,
    auditEntries: audits,
    lastUpdated: runtime.lastUpdated,
  };

  // Expose scheduler state explicitly for API consumers
  // Read scheduler state directly from the global singleton to avoid out-of-sync copies after hot reload.
  try{
    const sched = getGlobalScheduler();
    out.autonomousEnabled = !!runtime.autonomousEnabled;
    out.schedulerRunning = !!sched.timerId;
    out.cycleInProgress = !!sched.inProgress;
    out.intervalMs = sched.intervalMs;
    out.lastAutomaticRunAt = sched.lastRunAt ? new Date(sched.lastRunAt).toISOString() : null;
    out.nextAutomaticRunAt = sched.lastRunAt ? new Date(sched.lastRunAt + sched.intervalMs).toISOString() : null;
    out.lastAutomaticRunStatus = sched.lastAutomaticRunStatus || null;
    out.lastAutomaticRunMessage = sched.lastAutomaticRunMessage || null;
    out.lastAutomaticEvaluationCount = typeof sched.lastAutomaticEvaluationCount === 'number' ? sched.lastAutomaticEvaluationCount : null;
    out.lastAutomaticAuditCountBefore = typeof sched.lastAutomaticAuditCountBefore === 'number' ? sched.lastAutomaticAuditCountBefore : null;
    out.lastAutomaticAuditCountAfter = typeof sched.lastAutomaticAuditCountAfter === 'number' ? sched.lastAutomaticAuditCountAfter : null;
    out.lastAutomaticLockDiagnostics = sched.lastAutomaticLockDiagnostics || null;
  }catch(e){
    out.autonomousEnabled = !!runtime.autonomousEnabled;
    out.schedulerRunning = false;
    out.cycleInProgress = false;
    out.intervalMs = null;
    out.lastAutomaticRunAt = null;
    out.nextAutomaticRunAt = null;
  }

  // Include quote fetch diagnostics when fetch failed
  if (!quoteFetchOk){ out.quoteFetch = { ok: false, message: quoteFetchMessage || 'Quote fetch failed, using stored prices' }; }
  else { out.quoteFetch = { ok: true }; }
    // Expose latest sanitized Decision Intelligence per symbol for UI
    try{
      const rawMap = runtime.latestDecisionIntelligenceBySymbol || {};
      const safeMap: Record<string, any> = {};
      for (const k of Object.keys(rawMap || {})){
        try{ const v = (rawMap as any)[k]; if (v) safeMap[k] = sanitizeDecisionIntelligenceForState(v); }catch(_){ }
      }
      out.latestDecisionIntelligenceBySymbol = safeMap;
    }catch(_){ out.latestDecisionIntelligenceBySymbol = {}; }
    // Expose latest sanitized Fundamental Intelligence per symbol for UI
    try{
      const rawMapF = runtime.latestFundamentalIntelligenceBySymbol || {};
      const safeFund: Record<string, any> = {};
      for (const k of Object.keys(rawMapF || {})){
        try{ const v = (rawMapF as any)[k]; if (!v) continue; safeFund[k] = { snapshot: v.snapshot ? { schemaVersion: v.snapshot.schemaVersion, source: v.snapshot.source, symbol: v.snapshot.symbol, fetchedAt: v.snapshot.fetchedAt, dataStatus: v.snapshot.dataStatus, availableCategories: Array.isArray(v.snapshot.availableCategories) ? v.snapshot.availableCategories.slice() : [], missingCapabilities: Array.isArray(v.snapshot.missingCapabilities) ? v.snapshot.missingCapabilities.slice() : [], } : null, quality: v.quality ? { level: v.quality.level, score: v.quality.score, positiveFactors: Array.isArray(v.quality.positiveFactors) ? v.quality.positiveFactors.slice() : [], negativeFactors: Array.isArray(v.quality.negativeFactors) ? v.quality.negativeFactors.slice() : [], warnings: Array.isArray(v.quality.warnings) ? v.quality.warnings.slice(0,10) : [] } : null }; }catch(_){ }
      }
      out.latestFundamentalIntelligenceBySymbol = safeFund;
    }catch(_){ out.latestFundamentalIntelligenceBySymbol = {}; }
      // Expose latest sanitized Historical Market Context per symbol for UI/state
      try{
        const rawMapH = runtime.latestHistoricalMarketContextBySymbol || {};
        const safeHist: Record<string, HistoricalMarketContextSnapshot> = {};
        for (const k of Object.keys(rawMapH || {})){
          try{
            const v = (rawMapH as Record<string, any>)[k]; if (!v) continue;
            safeHist[k] = {
              schemaVersion: v.schemaVersion,
              source: v.source,
              symbol: v.symbol,
              observedAt: v.observedAt,
              generatedAt: v.generatedAt,
              observationCount: v.observationCount,
              hasVolume: v.hasVolume,
              dataQuality: v.dataQuality,
              missingCapabilities: Array.isArray(v.missingCapabilities) ? v.missingCapabilities.slice() : [],
              shortTrend: v.shortTrend,
              mediumTrend: v.mediumTrend,
              longTrend: v.longTrend,
              trendAgreement: v.trendAgreement,
              volatilityState: v.volatilityState,
              momentumPersistence: v.momentumPersistence,
              currentDrawdownPercent: typeof v.currentDrawdownPercent === 'number' ? v.currentDrawdownPercent : null,
              maxDrawdownPercent: typeof v.maxDrawdownPercent === 'number' ? v.maxDrawdownPercent : null,
              recoveryPercent: typeof v.recoveryPercent === 'number' ? v.recoveryPercent : null,
              rangePosition: typeof v.rangePosition === 'number' ? v.rangePosition : null,
              volumeTrend: v.volumeTrend,
              warnings: Array.isArray(v.warnings) ? v.warnings.slice() : []
            };
          }catch(_){ }
        }
        out.latestHistoricalMarketContextBySymbol = safeHist;
      }catch(_){ out.latestHistoricalMarketContextBySymbol = {}; }
        // Expose latest sanitized Market Regime Intelligence per symbol for UI/state
        try{
          const rawMapR = runtime.latestMarketRegimeIntelligenceBySymbol || {};
          const safeReg: Record<string, any> = {};
          for (const k of Object.keys(rawMapR || {})){
            try{
              const v = (rawMapR as Record<string, any>)[k]; if (!v) continue;
              safeReg[k] = {
                schemaVersion: v.schemaVersion,
                source: v.source,
                symbol: v.symbol,
                observedAt: v.observedAt,
                generatedAt: v.generatedAt,
                primaryRegime: v.primaryRegime,
                volatilityRegime: v.volatilityRegime,
                riskRegime: v.riskRegime,
                confidence: typeof v.confidence === 'number' ? v.confidence : 0,
                strength: v.strength,
                quality: v.quality,
                supportingSignals: Array.isArray(v.supportingSignals) ? v.supportingSignals.slice() : [],
                conflictingSignals: Array.isArray(v.conflictingSignals) ? v.conflictingSignals.slice() : [],
                reasoning: Array.isArray(v.reasoning) ? v.reasoning.slice(0,5) : [],
                warnings: Array.isArray(v.warnings) ? v.warnings.slice(0,10) : []
              };
            }catch(_){ }
          }
          out.latestMarketRegimeIntelligenceBySymbol = safeReg;
        }catch(_){ out.latestMarketRegimeIntelligenceBySymbol = {}; }
  // Expose external intelligence readiness (diagnostic-only)
  try{
    const rir = require('./external-intelligence-readiness');
    try{
      const built = rir.buildCurrentExternalIntelligenceReadiness({ env: process.env, runtime: runtime });
      try{ runtime.externalIntelligenceReadiness = JSON.parse(JSON.stringify(built)); }catch(_){ runtime.externalIntelligenceReadiness = built; }
      out.externalIntelligenceReadiness = runtime.externalIntelligenceReadiness ? JSON.parse(JSON.stringify(runtime.externalIntelligenceReadiness)) : null;
    }catch(e){ out.externalIntelligenceReadiness = null; }
  }catch(_){ out.externalIntelligenceReadiness = null; }
  // Expose latest market news activity from the most recent CYCLE_INTELLIGENCE_SNAPSHOT audit (if any)
  try{
    let latestActivity: MarketNewsActivity | undefined = undefined;
    if (Array.isArray(allAudits)){
      for (const a of allAudits){
        try{
          const raw = a && (a as any).raw ? (a as any).raw : a;
          if (raw && raw.kind === 'CYCLE_INTELLIGENCE_SNAPSHOT' && raw.marketNewsActivity){ latestActivity = raw.marketNewsActivity; break; }
        }catch(_){ }
      }
    }
    out.latestMarketNewsActivity = latestActivity;
    try{ runtime.latestMarketNewsActivity = latestActivity; }catch(_){ }
  }catch(_){ out.latestMarketNewsActivity = undefined; }

  // Expose forex autonomy controls and diagnostics (defensive copies)
  try{
    out.forexAutonomyArmed = !!runtime.forexAutonomyArmed;
  }catch(_){ out.forexAutonomyArmed = false; }
  try{ out.forexLaunchControl = runtime.forexLaunchControl ? JSON.parse(JSON.stringify(runtime.forexLaunchControl)) : null; }catch(_){ out.forexLaunchControl = null; }
  try{ out.latestForexCycleStatus = runtime.latestForexCycleStatus ? JSON.parse(JSON.stringify(runtime.latestForexCycleStatus)) : null; }catch(_){ out.latestForexCycleStatus = null; }
  try{ out.forexNoTradeSummary = runtime.forexNoTradeSummary ? JSON.parse(JSON.stringify(runtime.forexNoTradeSummary)) : null; }catch(_){ out.forexNoTradeSummary = null; }
  try{
    const checklist = buildForexLaunchChecklist({ readiness: runtime.forexReadiness || null, launchControl: runtime.forexLaunchControl || null, tradesToday: 0, maxTradesPerDay: (runtime.forexLaunchControl && (runtime.forexLaunchControl as any).maxTradesPerDay) ? (runtime.forexLaunchControl as any).maxTradesPerDay : 9999, dailyLossSek: 0, dailyLossLimitSek: Number.POSITIVE_INFINITY, runtimeInitialized: true, previousCycleHealthy: true });
    out.forexLaunchChecklist = checklist ? JSON.parse(JSON.stringify(checklist)) : null;
  }catch(_){ out.forexLaunchChecklist = null; }

  return out;
}

export async function getPerformanceSummary(){
  // Read all audits and extract valid TradeEvaluation objects from EVALUATION entries
  try{
    const all = await auditStore.list();
    const evals: any[] = [];
    for (const item of Array.isArray(all) ? all : []){
      try{
        const raw = (item && (item as any).raw) ? (item as any).raw : item;
        if (!raw || raw.kind !== 'EVALUATION') continue;
        // possible locations: raw.evaluation or raw.execution.evaluation
        const candidate = raw.evaluation || (raw.execution && raw.execution.evaluation) || null;
        if (!candidate) continue;
        const pnlSek = Number(candidate.pnlSek);
        const pnlPercent = Number(candidate.pnlPercent);
        const winner = candidate.winner === true || candidate.winner === false ? Boolean(candidate.winner) : null;
        if (!Number.isFinite(pnlSek) || !Number.isFinite(pnlPercent) || typeof winner !== 'boolean') continue;
        evals.push({ pnlSek, pnlPercent, winner });
      }catch(_){ continue; }
    }
    return calculatePerformance(evals as any);
  }catch(_){
    return calculatePerformance([]);
  }
}

export async function getPerformanceProfile(){
  try{
    const summary = await getPerformanceSummary();
    const reflection = evaluatePerformanceReflection(summary);
    return { summary, reflection };
  }catch(_){
    // On error, return an insufficient-data style profile
    const summary = await getPerformanceSummary();
    const reflection = evaluatePerformanceReflection(summary);
    return { summary, reflection };
  }
}

async function fetchQuotes(){
  // Prefer calling the server-side normalization function directly when available
  try{
    const mod = await import('../market-data/quotes-service');
    if (mod && typeof mod.getNormalizedQuotes === 'function'){
      const out = await mod.getNormalizedQuotes();
      return out && Array.isArray(out.quotes) ? out.quotes : null;
    }
  }catch(e){ /* ignore and try HTTP fallback */ }
  // Next fallback: call provider directly from lib/market-data (server-side)
  try{
    const prov = (await import('../../lib/market-data')).default;
    if (prov && typeof prov.getQuotes === 'function'){
      // Ask provider for common demo instruments
      const ids = ['nvidia','microsoft','apple'];
      const fetched = await prov.getQuotes(ids);
      if (Array.isArray(fetched) && fetched.length>0){
        // Map to minimal quote shape expected by runtime
        return fetched.map((f:any)=> ({ symbol: f.symbol || (f.providerSymbol||'').toUpperCase(), price: (f.price===undefined||f.price===null)? null : Number(f.price) }));
      }
    }
  }catch(e){ /* ignore */ }

  try{
    // HTTP fallback - use relative path (do not hardcode localhost)
    const res = await fetch('/api/market-data/quotes');
    if (!res.ok) return null;
    const data = await res.json();
    return data && Array.isArray(data.quotes) ? data.quotes : null;
  }catch(e){ return null; }
}

export async function runManualPaperTradingCycle(opts?: { allowWhenScheduler?: boolean, overrideUniverse?: { quotes?: any[], portfolio?: any, fundamentals?: Record<string, any> }, getPerformanceProfileOverride?: ()=>Promise<any> }){
  // Prevent overlapping with automatic scheduler when called externally
  try{
    const sched = getGlobalScheduler();
    if (sched.inProgress && !opts?.allowWhenScheduler) return { skipped: true, code: 'SCHEDULER_IN_PROGRESS' } as any;
  }catch(e){}

  // Per-run cycle id for correlation (one-per-cycle)
  const suppliedCycleId = (opts && (opts as any).cycleId) ? (opts as any).cycleId : null;
  const cycleId = suppliedCycleId || `cycle_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  const cycleStartMs = Date.now();
  // Helper to attach optional market news intelligence summary to a snapshot
  const attachMarketNewsSummary = (snapshot: any) => {
    try{
      const maybeNews = opts && opts.overrideUniverse && (opts.overrideUniverse as any).marketNewsSnapshot;
      if (!maybeNews) return;
      // Use the centralized creator to produce the exact saved summary shape.
      const summary = createMarketNewsIntelligenceSummary(maybeNews as any, Date.now());
      snapshot.marketNewsIntelligenceSummary = summary as MarketNewsIntelligenceSummary;
    }catch(_){ }
  };
  // Helper to attach market news fields to an audit object based on snapshot
  const attachMarketNewsAuditFields = (auditObj: any, snapshot: any) => {
    try{
      if (!snapshot || !(snapshot as any).marketNewsIntelligenceSummary) return;
      auditObj.marketNewsIntelligenceSummary = (snapshot as any).marketNewsIntelligenceSummary;
      try{ auditObj.marketNewsActivity = createMarketNewsActivity((snapshot as any).marketNewsIntelligenceSummary); }catch(_){ }
    }catch(_){ }
  };
  // Local AuditStore wrapper that injects cycleId into every appended entry without mutating caller object
  const cycleAuditStore: import('./types').AuditStore = {
    append: async (entry: import('./types').AuditEntry) => {
      // Build a sanitized payload copy and ensure supporting signal metadata follows the decision
      const payload: any = Object.assign({}, entry, { cycleId });
      try{
        const helper = (p: any) : { signalIds: string[]; supportingSignals: Array<{id:string;type:string;origin:string}> } => {
          const res = { signalIds: [] as string[], supportingSignals: [] as Array<{id:string;type:string;origin:string}> };
          try{
            const sigIds = Array.isArray(p.decision && p.decision.signals) ? p.decision.signals.map((x:any)=> String(x)) : [];
            res.signalIds = sigIds;
            if (sigIds.length === 0) return res;
            // Try to locate a marketSignals payload on the audit object in a few common places
            const ms = (p.marketSignals && Array.isArray(p.marketSignals.signals) ? p.marketSignals.signals : (p.meta && p.meta.marketSignals && Array.isArray(p.meta.marketSignals.signals) ? p.meta.marketSignals.signals : (p.decision && p.decision.marketSignals && Array.isArray(p.decision.marketSignals.signals) ? p.decision.marketSignals.signals : [])));
            const existingSupporting = Array.isArray(p.supportingSignals) ? p.supportingSignals : (Array.isArray(p.decision && p.decision.supportingSignals) ? p.decision.supportingSignals : []);
            const candidatesPool = Array.isArray(ms) ? ms.concat(existingSupporting) : Array.isArray(existingSupporting) ? existingSupporting : [];
            for (const id of sigIds){
              const found = candidatesPool.find((s:any)=> s && String(s.id) === String(id));
              if (found && found.id){
                const entrySig = { id: String(found.id), type: String(found.type || ''), origin: String(found.origin || '') };
                if (!res.supportingSignals.some(ss => ss.id === entrySig.id)) res.supportingSignals.push(entrySig);
              }
            }
            return res;
          }catch(_){ return res; }
        };
        const meta = helper(payload);
        // Attach supportingSignals only when we have at least one matching metadata entry
        if (Array.isArray(meta.signalIds) && meta.signalIds.length > 0){
          // Ensure decision.signals exists and is deduped & ordered
          try{ payload.decision = payload.decision || {}; payload.decision.signals = Array.from(new Set(meta.signalIds)); }catch(_){ }
          if (Array.isArray(meta.supportingSignals) && meta.supportingSignals.length > 0){ payload.supportingSignals = meta.supportingSignals; }
        }
      }catch(_){ /* Do not fail audit append on metadata construction errors */ }
      return auditStore.append(payload as import('./types').AuditEntry);
    },
    list: auditStore.list.bind(auditStore),
  };

  // Local per-run daily start value (undefined for file-backed/default runtime)
  let cycleDailyStartValue: number | undefined = undefined;

  // Initialize latestForexCycleStatus for this run (RUNNING or DIAGNOSTIC_ONLY)
  try{
    // Compute daily counters so launch control can decide whether execution is allowed
    const summary = await buildDailyTradingSummary({ auditStore, now: new Date() }).catch(()=> ({ executedTradeCount: 0, realizedPnLSek: 0, dailyLossSek: 0, dateKey: new Date().toISOString(), timezone: 'Europe/Stockholm' }));
    const maxTradesPerDay = typeof DEFAULT_PAPER_AUTO_MANDATE.maxTradesPerDay === 'number' && isFinite(DEFAULT_PAPER_AUTO_MANDATE.maxTradesPerDay) ? DEFAULT_PAPER_AUTO_MANDATE.maxTradesPerDay : 9999;
    const pct = typeof DEFAULT_PAPER_AUTO_MANDATE.maxDailyLossPercent === 'number' && isFinite(DEFAULT_PAPER_AUTO_MANDATE.maxDailyLossPercent) ? DEFAULT_PAPER_AUTO_MANDATE.maxDailyLossPercent : 0;
    const dailyLossLimitSek = Math.round(((runtime && typeof runtime.startCapital === 'number' ? runtime.startCapital : START_CAPITAL) * (pct/100)) * 100) / 100;
    const lc = buildForexLaunchControlState({ now: new Date(), forexReadiness: runtime.forexReadiness || null, autonomousEnabled: !!runtime.autonomousEnabled, schedulerEnabled: !!runtime.autonomousEnabled, cycleLocked: false, tradesToday: typeof summary.executedTradeCount === 'number' ? summary.executedTradeCount : 0, maxTradesPerDay, dailyLossSek: typeof summary.dailyLossSek === 'number' ? summary.dailyLossSek : 0, dailyLossLimitSek, isArmed: !!runtime.forexAutonomyArmed, cycleRunning: false });
    const executionMode = (runtime.forexAutonomyArmed && lc.isSafeToExecuteOrders) ? 'EXECUTION_ALLOWED' : 'DIAGNOSTIC_ONLY';
    runtime.latestForexCycleStatus = { cycleId, status: 'RUNNING', executionMode, startedAt: new Date().toISOString(), completedAt: null, analyzedPairCount: 0, executionCandidateCount: 0, executedTradeCount: 0, blockingReasons: [] };
  }catch(_){ }

  // Build simple deterministic demo decision set
  // Determine eligible instruments for this cycle using per-instrument session rules.
  const nowForCycle = new Date();

  // Fetch quotes early so we can treat instruments with fresh market data as eligible
  // even when a simple time-based rule would mark the market closed.
  // Only use provider-fetched quotes for early eligibility checks. When callers
  // provide `overrideUniverse.quotes` (typically tests), respect the configured
  // time-based rules and do not short-circuit eligibility based on the override
  // payload.
  const _earlyQuotes = (opts && opts.overrideUniverse && Array.isArray(opts.overrideUniverse.quotes)) ? null : await fetchQuotes();

  // Determine eligible instruments for this cycle using module-scoped TRADABLE_INSTRUMENTS.
  const eligibleInstruments = Array.isArray(TRADABLE_INSTRUMENTS) ? TRADABLE_INSTRUMENTS.filter(i => {
    const enabled = (i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true);
    if (!enabled) return false;
    // If this is a FOREX/COMMODITY instrument and we have a fresh quote, prefer that
    // over the simple time-based session check. This allows recently-fetched
    // market data to drive eligibility during edge cases (e.g. just before/after
    // session boundaries or when provider data indicates liquidity).
    try{
      const type = i && i.assetType ? String(i.assetType).toUpperCase() : 'STOCK';
      if ((type === 'FOREX' || type === 'COMMODITY') && Array.isArray(_earlyQuotes)){
        const sym = (i.providerSymbol || i.id || '').toUpperCase();
        const normSym = String(sym).replace(/[^A-Z0-9]/g, '');
        const q = _earlyQuotes.find((qq:any) => {
          const candidate = String((qq.symbol||qq.providerSymbol||'')).toUpperCase();
          const normCandidate = candidate.replace(/[^A-Z0-9]/g, '');
          return normCandidate === normSym;
        });
        if (q){
          const price = q.price ?? q.priceSek ?? q.priceUsd ?? q.priceUSD ?? q.lastPrice;
          if (price !== undefined && price !== null) return true;
        }
      }
    }catch(_){ }
    return isInstrumentTradableNow(i, nowForCycle);
  }) : [];

  // If nothing is eligible this cycle, skip early to avoid unnecessary work.
  if (!eligibleInstruments || eligibleInstruments.length === 0){
    const now = nowIso();
    runtime.latestDecision = { id: `skip_${now}`, action: 'HOLD', reason: 'NO_ELIGIBLE_INSTRUMENTS' } as any;
    runtime.latestCycle = { processedCandidates: 0, executed: 0, rejects: 0, skipped: true } as any;
    try{ runtime.latestForexCycleStatus = { cycleId, status: 'SKIPPED', executionMode: 'DIAGNOSTIC_ONLY', startedAt: now, completedAt: now, analyzedPairCount: 0, executionCandidateCount: 0, executedTradeCount: 0, blockingReasons: ['NO_ELIGIBLE_INSTRUMENTS'] }; }catch(_){ }
    runtime.lastUpdated = now;
    return { skipped: true, code: 'NO_ELIGIBLE_INSTRUMENTS' } as any;
  }

  // For BUY candidates, analyze the configured watchlist (filtered by eligible instruments)
  const symbols = getWatchlistSymbols(eligibleInstruments);
  const quotes = opts && opts.overrideUniverse && Array.isArray(opts.overrideUniverse.quotes) ? opts.overrideUniverse.quotes : await fetchQuotes();

  // --- RUNTIME QUOTES SNAPSHOT (transient diagnostic for cycle troubleshooting) ---
  try{
    const fetchedAt = new Date().toISOString();
    const quotesIsArray = Array.isArray(quotes);
    const maxCount = Array.isArray(TRADABLE_INSTRUMENTS) ? TRADABLE_INSTRUMENTS.length : 0;
    const limited: any[] = [];
    if (Array.isArray(quotes)){
      for (let i = 0; i < Math.min(quotes.length, maxCount); i++){
        const q = quotes[i] || {};
        limited.push({
          symbol: q.symbol ?? null,
          instrumentId: q.instrumentId ?? null,
          providerSymbol: q.providerSymbol ?? null,
          price: (typeof q.price === 'number' ? q.price : (typeof q.priceSek === 'number' ? q.priceSek : null)),
          timestamp: q.marketTimestamp ?? q.timestamp ?? null,
          isStale: (typeof q.isStale === 'boolean') ? q.isStale : !!q.isStale
        });
      }
    }

    // NVDA probe: attempt to find NVDA within the limited set and report which key matched
    const nvdaTarget = 'NVDA';
    let nvdaProbe: any = { found: false, matchedBy: 'none', symbol: null, instrumentId: 'nvidia', providerSymbol: 'NVDA', price: null, timestamp: null, quoteAgeSeconds: null, isStale: null };
    for (const q of limited){
      try{
        const sym = q.symbol ? String(q.symbol).toUpperCase() : null;
        const iid = q.instrumentId ? String(q.instrumentId).toUpperCase() : null;
        const pSym = q.providerSymbol ? String(q.providerSymbol).toUpperCase() : null;
        if (sym === nvdaTarget){ nvdaProbe = { found: true, matchedBy: 'symbol', symbol: q.symbol, instrumentId: q.instrumentId, providerSymbol: q.providerSymbol, price: q.price, timestamp: q.timestamp, quoteAgeSeconds: q.timestamp ? Math.round((Date.now() - Date.parse(String(q.timestamp))) / 1000) : null, isStale: q.isStale }; break; }
        if (iid === nvdaTarget){ nvdaProbe = { found: true, matchedBy: 'instrumentId', symbol: q.symbol, instrumentId: q.instrumentId, providerSymbol: q.providerSymbol, price: q.price, timestamp: q.timestamp, quoteAgeSeconds: q.timestamp ? Math.round((Date.now() - Date.parse(String(q.timestamp))) / 1000) : null, isStale: q.isStale }; break; }
        if (pSym === nvdaTarget){ nvdaProbe = { found: true, matchedBy: 'providerSymbol', symbol: q.symbol, instrumentId: q.instrumentId, providerSymbol: q.providerSymbol, price: q.price, timestamp: q.timestamp, quoteAgeSeconds: q.timestamp ? Math.round((Date.now() - Date.parse(String(q.timestamp))) / 1000) : null, isStale: q.isStale }; break; }
      }catch(e){ /* ignore per-quote probe errors */ }
    }

    const snap = { kind: 'RUNTIME_QUOTES_SNAPSHOT', cycleId, fetchedAt, quotesIsArray, quoteCount: limited.length, quotes: limited, nvda: nvdaProbe };
    try{
      await cycleAuditStore.append({ kind: 'RECEIVED', id: `runtime_snapshot_${Date.now()}`, timestamp: fetchedAt, snapshot: snap, meta: { automatic: true } } as any);
    }catch(e){ /* swallow */ }
  }catch(e){ /* do not impact runtime when diagnostics fail */ }
  // Build and attach forex readiness snapshot for this cycle (defensive copy)
  try{
    const readiness = buildForexReadinessState({ now: nowForCycle, instruments: TRADABLE_INSTRUMENTS, quotes: (quotes && Array.isArray(quotes)) ? quotes : [] });
    try{ runtime.forexReadiness = JSON.parse(JSON.stringify(readiness)); }catch(_){ runtime.forexReadiness = readiness as any; }
  }catch(_){ runtime.forexReadiness = null; }
  // Build per-cycle instruments array and macro snapshot/signals once to reuse for BUY/SELL
  let cycleMacroSnapshot: any = undefined;
  let cycleMacroSignals: any[] | undefined = undefined;
  let cycleSectorSummaries: any[] | undefined = undefined;
  try{
    const instrumentsForMacro: any[] = Array.isArray(quotes) ? (quotes as any[]).map((q:any)=> ({ instrumentId: q.instrumentId, symbol: q.symbol, name: q.name, providerSymbol: q.providerSymbol, price: (typeof q.priceSek === 'number' ? q.priceSek : (typeof q.price === 'number' ? q.price : null)), change: q.change, changePercent: q.changePercent, dataStatus: q.dataStatus, isStale: q.isStale, marketTimestamp: q.marketTimestamp })) : [];
    // Build local snapshot from instruments (GOLD/OIL)
    const localSnapshot = buildMacroSnapshotFromInstruments(instrumentsForMacro, new Date().toISOString());
    // Build sector summaries once per cycle
    try{ cycleSectorSummaries = buildSectorStrengthSummaries(instrumentsForMacro, new Date().toISOString()); }catch(_){ cycleSectorSummaries = undefined; }
    // Fetch supported macro indicators (VIX/DXY/US10Y) once per cycle
    try{
      const macroFetch = await import('./macro-signals');
      const fetched = await macroFetch.fetchMacroSnapshot();
        // merge fetched values into local snapshot without overwriting local GOLD/OIL
        cycleMacroSnapshot = Object.assign({}, localSnapshot, fetched.snapshot);
        // attach macro data status and diagnostics to the cycle snapshot
        try{
          // Ensure we include local-derived availability (e.g. GOLD/OIL) when fetched results
          // only cover VIX/DXY/US10Y. Merge defaults so keys exist for all indicators.
          const defaultsStatus = { vix: 'UNSUPPORTED', dxy: 'UNSUPPORTED', us10y: 'UNSUPPORTED', oil: (localSnapshot && typeof (localSnapshot as any).oil === 'number') ? 'OK' : 'MISSING' } as any;
          const defaultsDiag = { vix: { configured: false, status: 'UNSUPPORTED', hasValue: false, hasTimestamp: false, isFresh: false }, dxy: { configured: false, status: 'UNSUPPORTED', hasValue: false, hasTimestamp: false, isFresh: false }, us10y: { configured: false, status: 'UNSUPPORTED', hasValue: false, hasTimestamp: false, isFresh: false }, oil: { configured: false, status: (localSnapshot && typeof (localSnapshot as any).oil === 'number') ? 'OK' : 'MISSING', hasValue: !!(localSnapshot && typeof (localSnapshot as any).oil === 'number'), hasTimestamp: false, isFresh: !!(localSnapshot && typeof (localSnapshot as any).oil === 'number') } } as any;
          const mergedStatus = Object.assign({}, defaultsStatus, (fetched && fetched.statusByIndicator) ? fetched.statusByIndicator : {});
          const mergedDiag = Object.assign({}, defaultsDiag, (fetched && fetched.diagnosticsByIndicator) ? fetched.diagnosticsByIndicator : {});
          (cycleMacroSnapshot as any).macroDataStatus = { fetchedAt: fetched.fetchedAt, statusByIndicator: mergedStatus, diagnosticsByIndicator: mergedDiag };
        }catch(_){ (cycleMacroSnapshot as any).macroDataStatus = { fetchedAt: fetched.fetchedAt, statusByIndicator: fetched.statusByIndicator, diagnosticsByIndicator: fetched.diagnosticsByIndicator }; }
        cycleMacroSignals = buildMacroSignals(cycleMacroSnapshot as any);

        // Emit a single sanitized macro snapshot audit per cycle. This audit MUST NOT
        // include provider symbols, raw provider payloads, API keys, URLs or secrets.
        try{
          const snap = cycleMacroSnapshot as any;
          const now = new Date().toISOString();
          const snapshotAudit = {
            kind: 'MACRO_DATA_SNAPSHOT',
            id: `macro_snapshot_${cycleId}`,
            timestamp: now,
            cycleId,
            fetchedAt: (snap && snap.macroDataStatus && snap.macroDataStatus.fetchedAt) ? snap.macroDataStatus.fetchedAt : now,
            statusByIndicator: (snap && snap.macroDataStatus && snap.macroDataStatus.statusByIndicator) ? snap.macroDataStatus.statusByIndicator : undefined,
            diagnosticsByIndicator: (snap && snap.macroDataStatus && snap.macroDataStatus.diagnosticsByIndicator) ? snap.macroDataStatus.diagnosticsByIndicator : undefined,
            // snapshotAvailability: indicate which indicators have valid values (boolean map)
            snapshotAvailability: {
              vix: snap && typeof snap.vix === 'number',
              dxy: snap && typeof snap.dxy === 'number',
              us10y: snap && typeof snap.us10y === 'number',
              gold: snap && typeof snap.gold === 'number',
              oil: snap && typeof snap.oil === 'number'
            },
            // compact signals: include only id, type, origin, direction, strength, isPlaceholder
            signals: Array.isArray(cycleMacroSignals) ? cycleMacroSignals.map((s:any) => ({ id: s && s.id ? s.id : null, type: s && s.type ? s.type : null, origin: s && s.origin ? s.origin : null, direction: s && s.direction ? s.direction : null, strength: (s && (typeof s.strength === 'number' ? s.strength : undefined)), isPlaceholder: Boolean(s && s.isPlaceholder) })) : [],
            meta: { automatic: true }
          } as any;
          try{ await cycleAuditStore.append(snapshotAudit as any); }catch(_){ }
        }catch(_){ }
    }catch(e){
      // fallback to local-only snapshot if fetch fails
      cycleMacroSnapshot = localSnapshot;
      cycleMacroSignals = buildMacroSignals(cycleMacroSnapshot as any);
    }
  }catch(_){ cycleMacroSnapshot = undefined; cycleMacroSignals = undefined; }
  // Build per-cycle intraday resolver and fetch intraday contexts for analyzed symbols (diagnostic-only)
  const intradayResolver = createPerCycleIntradayResolver({ getIntraday: (s, interval, lim) => {
    try{ const prov = getMarketDataProvider(); if (typeof (prov as any).getIntradayCandles === 'function') return (prov as any).getIntradayCandles(s, interval, lim); return Promise.reject(new Error('NO_INTRADAY_SUPPORT')); }catch(e){ return Promise.reject(e); }
  }, updateState: (s, r) => {
    try{ if (!runtime.latestIntradayMarketContextBySymbol) runtime.latestIntradayMarketContextBySymbol = {}; runtime.latestIntradayMarketContextBySymbol[String(s).toUpperCase()] = r; }catch(_){ }
  } });

  // For initial diagnostic pass fetch 15min intraday context for watchlist symbols present
  try{
    if (Array.isArray(symbols) && symbols.length > 0){
      for (const sym of symbols){
        try{ // only schedule, do not await to avoid blocking; store promise to map via resolver
          intradayResolver.resolve({ symbol: sym, interval: '15min', limit: 64 }).catch(()=>{});
        }catch(_){ }
      }
    }
  }catch(_){ }
  // Per-cycle diagnostics collected for each evaluated symbol
  const diagnosticsBySymbol = new Map<string, any>();
  function ensureDiag(sym: string){
    const s = String(sym || '').toUpperCase();
    if (!diagnosticsBySymbol.has(s)) diagnosticsBySymbol.set(s, { symbol: s, quoteFound: false, quoteAgeSeconds: null, marketOpen: null, signal: null, confidence: null, decision: null, rejectionReason: null, eligibleForExecution: false, executionAttempted: false, executed: false });
    return diagnosticsBySymbol.get(s);
  }
  function getQuoteAgeSeconds(q:any){ try{ if (!q) return null; const ts = q.timestamp || q.time || q.t || q.ts || q.lastUpdated || q.updatedAt || null; if (!ts) return null; const d = new Date(ts); if (isNaN(d.getTime())) return null; return Math.round((Date.now() - d.getTime())/1000); }catch(_){ return null; } }
  // Plan actions: first evaluate existing holdings, then consider buy candidates
  const candidates: any[] = [];
  let evaluationCount = 0;
  const evaluatedSymbols = new Set<string>();
  // snapshot evaluation count before run so we can compute actual appended evaluations
  let _beforeEvalCount = 0;
  try{ const _beforeList = await auditStore.list(); _beforeEvalCount = Array.isArray(_beforeList) ? _beforeList.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION').length : 0; }catch(_){ _beforeEvalCount = 0; }
  const portfolio = opts && opts.overrideUniverse && opts.overrideUniverse.portfolio ? opts.overrideUniverse.portfolio : await portfolioAdapter.getPortfolio();

  // If using Supabase-backed portfolio store, ensure persistent daily start before creating trader
  try{
    const store = (process.env && process.env.PAPER_TRADER_PORTFOLIO_STORE) || '';
    if (store === 'supabase'){
      const rawId = (process.env && process.env.PAPER_TRADER_PORTFOLIO_ID) || '';
      const portfolioId = (typeof rawId === 'string' ? rawId.trim() : '') || 'demo';
      // ensureDailyStart may throw; per requirements let it bubble and abort cycle
      const dr = await ensureDailyStart({ portfolioId });
      // capture per-run daily start value for cycleTrader and recreate trader with explicit dailyStartValue
      cycleDailyStartValue = typeof dr.startValue === 'number' ? dr.startValue : undefined;
      trader = createPaperTrader({ portfolioAdapter, auditStore, config, dailyStartValue: cycleDailyStartValue });
      runtime.trader = trader;
    }
  }catch(e){
    throw e;
  }
  // Create a per-run trader that uses the cycleAuditStore for engine-produced audits.
  // This trader is local to the run, does not mutate runtime.trader or any global state,
  // and shares portfolioAdapter, config and any dailyStartValue with the existing trader.
  const injected = getInjectedCycleTrader();
  const cycleTrader = injected || createPaperTrader({
    portfolioAdapter,
    auditStore: cycleAuditStore,
    config,
    dailyStartValue: cycleDailyStartValue
  });
  // Fetch performance profile once per cycle. If an override is provided use it (tests),
  // otherwise call the regular `getPerformanceProfile`. If it fails, continue without reflection.
  let profile: any = null;
  try{
    if (opts && typeof opts.getPerformanceProfileOverride === 'function'){
      profile = await opts.getPerformanceProfileOverride();
    } else {
      profile = await getPerformanceProfile();
    }
  }catch(_){ profile = null; }
  const perCycleReflection = profile && profile.reflection ? profile.reflection : undefined;
  // Build an initial per-cycle AdaptiveDecisionContext (victorReview unknown at start)
  let adaptiveDecisionContext: any = buildAdaptiveDecisionContext(profile, null);
  const plannedSymbols = new Set<string>();
  // Per-cycle in-memory promise-map to dedupe historical calls within a single cycle.
  // Store Promises (not resolved data) so concurrent requests for the same symbol
  // share the same provider call. This map ONLY lives for the duration of the
  // cycle and is not a long-lived cache. The provider's own cache remains the
  // only long-lived cache.
  const historicalRequestsBySymbol = new Map<string, Promise<any>>();
  const analysisResultsBySymbol = new Map<string, Promise<any>>();

  // Helper: fetch historical closes once per symbol (promise dedupe) and run analyzePriceSeries once.
  async function fetchAndAnalyze(symbol: string){
    const sym = String(symbol).toUpperCase();
    if (!analysisResultsBySymbol.has(sym)){
      const p = (async ()=>{
        try{
          if (!historicalRequestsBySymbol.has(sym)){
            const provider = new TwelveDataMarketDataProvider();
            const histP = provider.getHistoricalDailyCloses(sym, 30);
            historicalRequestsBySymbol.set(sym, histP);
          }
          const hist = await historicalRequestsBySymbol.get(sym);
          const techMeta: any = { technicalAnalysisMode: 'observe-only' };
          if (hist && Array.isArray(hist.closes)){
            const analysis = analyzePriceSeries ? analyzePriceSeries(hist.closes) : null;
            techMeta.technicalAnalysisStatus = analysis ? 'success' : 'unavailable';
            techMeta.technicalTrend = analysis ? analysis.trend : null;
            techMeta.technicalMomentumPercent = analysis ? analysis.momentumPercent : null;
            techMeta.technicalVolatilityPercent = analysis ? analysis.volatilityPercent : null;
            techMeta.technicalScore = analysis ? analysis.technicalScore : null;
            techMeta.technicalSignal = analysis ? analysis.signal : null;
            techMeta.technicalReasons = analysis ? analysis.reasons : null;
            techMeta.historicalDataPoints = hist.closes.length;
            techMeta.historicalFirstDate = Array.isArray(hist.dates) && hist.dates.length ? hist.dates[0] : null;
            techMeta.historicalLastDate = Array.isArray(hist.dates) && hist.dates.length ? hist.dates[hist.dates.length-1] : null;
            techMeta.historicalSource = hist.source || null;
          } else {
            techMeta.technicalAnalysisStatus = 'unavailable';
            techMeta.technicalAnalysisErrorCode = 'INSUFFICIENT_HISTORY';
            techMeta.technicalAnalysisErrorMessage = 'No historical closes available';
          }
          return techMeta;
        }catch(e:any){
          const techMeta: any = { technicalAnalysisMode: 'observe-only' };
          techMeta.technicalAnalysisStatus = 'unavailable';
          techMeta.technicalAnalysisErrorCode = e && e.code ? e.code : 'PROVIDER_ERROR';
          techMeta.technicalAnalysisErrorMessage = e && e.message ? e.message : String(e);
          return techMeta;
        }
      })();
      analysisResultsBySymbol.set(sym, p);
    }
    return analysisResultsBySymbol.get(sym) as Promise<any>;
  }

  // Helper: fetch raw historical series (deduped per-cycle). Returns provider-normalized object
  async function getHistoricalForSymbol(symbol: string){
    const sym = String(symbol).toUpperCase();
    if (!historicalRequestsBySymbol.has(sym)){
      try{
        const provider = new TwelveDataMarketDataProvider();
        const histP = provider.getHistoricalDailyCloses(sym, 100);
        historicalRequestsBySymbol.set(sym, histP);
      }catch(e){
        // If provider creation fails, store a rejected promise to avoid retries
        historicalRequestsBySymbol.set(sym, Promise.reject(e));
      }
    }
    return historicalRequestsBySymbol.get(sym) as Promise<any>;
  }

  // Per-cycle cache for built historical market contexts (one build per symbol per cycle)
  const historicalMarketContextBySymbol = new Map<string, Promise<any>>();

  // Build or return cached historical market context for a symbol. Uses existing per-cycle
  // `historicalRequestsBySymbol` to avoid extra provider calls. Appends a sanitized audit
  // snapshot once per symbol and updates runtime.latestHistoricalMarketContextBySymbol.
  async function getOrBuildHistoricalMarketContext(symbol: string){
    const sym = String(symbol).toUpperCase();
    if (!sym) return null;
    if (historicalMarketContextBySymbol.has(sym)) return historicalMarketContextBySymbol.get(sym) as Promise<any>;
    const p = (async ()=>{
      try{
        const mod = await import('./historical-market-context');
        const hist = await getHistoricalForSymbol(sym).catch(()=>null);
        if (!hist || !Array.isArray(hist.closes) || !Array.isArray(hist.dates)){
          const ctx = mod.buildHistoricalMarketContext({ symbol: sym, closes: [], dates: [], volumes: [], now: new Date() });
          // Mark provider-unavailable so downstream contracts can distinguish a provider failure
          try{ if (Array.isArray(ctx.warnings) && !ctx.warnings.includes('HISTORICAL_PROVIDER_UNAVAILABLE')) ctx.warnings.push('HISTORICAL_PROVIDER_UNAVAILABLE'); }catch(_){ }
          try{ if (Array.isArray(ctx.missingCapabilities) && !ctx.missingCapabilities.includes('HISTORICAL_PROVIDER')) ctx.missingCapabilities.push('HISTORICAL_PROVIDER'); }catch(_){ }
          try{ const audit = Object.assign({ id: `historical_${sym}_${cycleId}`, timestamp: new Date().toISOString() }, mod.buildHistoricalContextAuditPayload(cycleId, ctx)); await cycleAuditStore.append(audit as AuditEntry); }catch(_){ }
          try{ runtime.latestHistoricalMarketContextBySymbol = runtime.latestHistoricalMarketContextBySymbol || {}; runtime.latestHistoricalMarketContextBySymbol[sym] = mod.sanitizeContextForState(ctx); }catch(_){ }
          return ctx;
        }
        // Build using available fields; volumes optional
        const input = { symbol: sym, closes: hist.closes, dates: hist.dates, volumes: Array.isArray(hist.volumes) ? hist.volumes : undefined, fetchedAt: hist.fetchedAt || hist.fetchedAtAt || undefined, now: new Date() };
        const ctx = mod.buildHistoricalMarketContext(input);
        // Append sanitized audit (best-effort)
        try{ const audit = Object.assign({ id: `historical_${sym}_${cycleId}`, timestamp: new Date().toISOString() }, mod.buildHistoricalContextAuditPayload(cycleId, ctx)); await cycleAuditStore.append(audit as AuditEntry); }catch(_){ }
        try{ runtime.latestHistoricalMarketContextBySymbol = runtime.latestHistoricalMarketContextBySymbol || {}; runtime.latestHistoricalMarketContextBySymbol[sym] = mod.sanitizeContextForState(ctx); }catch(_){ }
        return ctx;
      }catch(e){
        try{ historicalRequestsBySymbol.delete(sym); }catch(_){ }
        return null;
      }
    })();
    historicalMarketContextBySymbol.set(sym, p);
    return p;
  }

  // Per-cycle cache for built signal packages (dedupe building of market-structure + related signals)
  const signalsBySymbol = new Map<string, Promise<any[]>>();
  // Per-cycle cache for confluence summaries
  const confluenceBySymbol = new Map<string, Promise<any>>();
  // Per-cycle cache for market regime intelligence (build from per-cycle historical context when needed)
  const marketRegimeIntelligenceBySymbol = new Map<string, Promise<any>>();
  // Per-cycle cache for context-aware shadow decision
  const contextAwareShadowDecisionBySymbol = new Map<string, Promise<any>>();
  // Track pending candidate action for symbol during per-symbol processing so appendAudit can use it
  const pendingDecisionActionBySymbol = new Map<string, 'BUY'|'SELL'|'HOLD'|'UNKNOWN'>();
  // Per-cycle cache for fundamental intelligence packages (used by resolver)
  const fundamentalBySymbol = new Map<string, Promise<any>>();
  const perCycleFundResolver = createPerCycleFundamentalResolver({ fetchFundamental: async ({ symbol }: any) => await fetchAndBuildFundamentalIntelligence({ symbol, now: new Date().toISOString() }).catch(()=>null), instruments: TRADABLE_INSTRUMENTS, timeoutMs: 3000, appendAudit: async (res:any) => {/* noop here, append below */}, updateState: (s:string, r:any) => { try{ runtime.latestFundamentalIntelligenceBySymbol = runtime.latestFundamentalIntelligenceBySymbol || {}; runtime.latestFundamentalIntelligenceBySymbol[s] = { snapshot: r.snapshot, quality: r.quality }; }catch(_){ } } });

  // Per-cycle decision intelligence resolver (created once per cycle)
  let decisionIntelligenceResolver: any = null;

  // Helper: build or return cached confluence summary for a symbol
  async function getOrBuildConfluence(symbol: string, marketSignals: any, ts?: string){
    const sym = String(symbol).toUpperCase();
    if (!sym) return null;
    if (confluenceBySymbol.has(sym)) return confluenceBySymbol.get(sym) as Promise<any>;
    const p = (async ()=>{
      try{
        // Ensure historical market context is built first (per requirement)
        try{ await getOrBuildHistoricalMarketContext(sym); }catch(_){ }
        const mod = await import('./signal-confluence');
        const summary = mod.buildSignalConfluenceSummary(sym, marketSignals, ts || new Date().toISOString());
        // also compute quality once and attach to summary object for reuse
        try{ const quality = mod.buildAnalysisQualitySummary(summary); (summary as any)._analysisQuality = quality; }catch(_){ }
        return summary;
      }catch(_){ return null; }
    })();
    confluenceBySymbol.set(sym, p);
    return p;
  }

  // Create per-cycle decision intelligence resolver
  try{
    const qc = await import('./signal-confluence');
    decisionIntelligenceResolver = qc.createPerCycleDecisionIntelligenceResolver({ cycleId, generatedAt: new Date().toISOString(), buildSummary: async (sym:string, marketSignals?: any) => {
      // Use existing per-cycle confluence builder (deduped)
      const s = await getOrBuildConfluence(sym, marketSignals, new Date().toISOString());
      return s as any;
    }, buildQuality: qc.buildAnalysisQualitySummary, buildReasoning: qc.buildConfluenceReasoning, appendAudit: async (payload:any) => {
      // append a sanitized DECISION_INTELLIGENCE_SNAPSHOT audit and update runtime state
      try{
        // Enrich payload with market-context diagnostics when available (diagnostic-only)
        try{
          const primary = Object.assign({}, payload, { kind: 'DECISION_INTELLIGENCE_SNAPSHOT', schemaVersion: qc.DECISION_INTELLIGENCE_SCHEMA_VERSION, source: qc.DECISION_INTELLIGENCE_SOURCE });
          const sym = primary && primary.symbol ? String(primary.symbol).toUpperCase() : null;
          // Attempt to reuse per-cycle caches rather than calling providers
          let histCtx: any = null;
          try{
            // Use only per-cycle cached historical context; do NOT fallback to runtime.latest* (could be stale)
            if (sym && historicalMarketContextBySymbol.has(sym)){
              histCtx = await (historicalMarketContextBySymbol.get(sym) as Promise<any>).catch(()=>null);
            } else {
              histCtx = null;
            }
          }catch(_){ histCtx = null; }
          let mrCtx: any = null;
          try{
            // Build or reuse per-cycle market regime intelligence using per-cycle historical context only
            if (sym){
              if (marketRegimeIntelligenceBySymbol.has(sym)){
                mrCtx = await marketRegimeIntelligenceBySymbol.get(sym as string)!.catch(()=>null);
              } else {
                const p = (async ()=>{
                  try{
                    if (!histCtx) return null;
                    const mod = await import('./market-regime-intelligence');
                    const built = mod.buildMarketRegimeIntelligence({ symbol: sym, historicalContext: histCtx, now: new Date() });
                    return built;
                  }catch(_){ return null; }
                })();
                marketRegimeIntelligenceBySymbol.set(sym, p);
                mrCtx = await p.catch(()=>null);
              }
            }
          }catch(_){ mrCtx = null; }
          // Determine action hint if available from pendingDecisionActionBySymbol
          const actionHint = sym && pendingDecisionActionBySymbol.has(sym) ? pendingDecisionActionBySymbol.get(sym) : 'UNKNOWN';
          try{
            if (typeof qc.buildDecisionMarketContextDiagnostics === 'function'){
              try{ const diag = qc.buildDecisionMarketContextDiagnostics({ action: (actionHint as any) || 'UNKNOWN', confidence: null, historicalContext: histCtx || null, marketRegime: mrCtx || null }); if (diag) (primary as any).marketContextDiagnostics = diag; }catch(_){ }
            }
          }catch(_){ }
          try{ await cycleAuditStore.append(primary); }catch(_){ }
          try{ if (sym){ runtime.latestDecisionIntelligenceBySymbol = runtime.latestDecisionIntelligenceBySymbol || {}; runtime.latestDecisionIntelligenceBySymbol[sym] = sanitizeDecisionIntelligenceForState(primary); } }catch(_){ }
        }catch(_){ }
      }catch(_){ }
      // Fetch and append fundamental intelligence audit (best-effort, per-cycle cached) via resolver
      try{
        const sym = String(payload && payload.symbol || '').toUpperCase();
        if (!sym) return;
        // Use resolver: only STOCK and analyzed symbols will be fetched
        const res = await perCycleFundResolver.resolve({ cycleId, symbol: sym, analyzed: true });
        if (!res || !res.snapshot) return;
        const snap = res.snapshot;
        const audit = {
          kind: 'FUNDAMENTAL_INTELLIGENCE_SNAPSHOT',
          id: `fundamental_${sym}_${cycleId}`,
          timestamp: new Date().toISOString(),
          cycleId,
          schemaVersion: 1,
          source: 'TWELVE_DATA_FUNDAMENTALS',
          symbol: sym,
          fetchedAt: snap.fetchedAt,
          dataStatus: snap.dataStatus,
          availableCategories: Array.isArray(snap.availableCategories) ? snap.availableCategories.slice() : [],
          missingCapabilities: Array.isArray(snap.missingCapabilities) ? snap.missingCapabilities.slice() : [],
          quality: { level: res.quality && res.quality.level ? res.quality.level : null, score: typeof res.quality?.score === 'number' ? res.quality.score : null, positiveFactors: Array.isArray(res.quality?.positiveFactors) ? res.quality.positiveFactors.slice() : [], negativeFactors: Array.isArray(res.quality?.negativeFactors) ? res.quality.negativeFactors.slice() : [], warnings: Array.isArray(res.quality?.warnings) ? res.quality.warnings.slice(0,10) : [] },
          selectedMetrics: (function(){ const m:any = {}; const s = snap as any; if (typeof s.profitability?.revenueGrowthPercent === 'number') m.revenueGrowthPercent = s.profitability.revenueGrowthPercent; if (typeof s.profitability?.netIncomeGrowthPercent === 'number') m.netIncomeGrowthPercent = s.profitability.netIncomeGrowthPercent; if (typeof s.profitability?.operatingMarginPercent === 'number') m.operatingMarginPercent = s.profitability.operatingMarginPercent; if (typeof s.profitability?.netMarginPercent === 'number') m.netMarginPercent = s.profitability.netMarginPercent; if (typeof s.financialHealth?.debtToEquity === 'number') m.debtToEquity = s.financialHealth.debtToEquity; if (typeof s.financialHealth?.currentRatio === 'number') m.currentRatio = s.financialHealth.currentRatio; if (typeof s.cashFlow?.freeCashFlow === 'number') m.freeCashFlow = s.cashFlow.freeCashFlow; if (typeof s.cashFlow?.freeCashFlowMarginPercent === 'number') m.freeCashFlowMarginPercent = s.cashFlow.freeCashFlowMarginPercent; if (typeof s.valuation?.trailingPe === 'number') m.trailingPe = s.valuation.trailingPe; if (typeof s.valuation?.forwardPe === 'number') m.forwardPe = s.valuation.forwardPe; if (typeof s.earnings?.epsGrowthPercent === 'number') m.epsGrowthPercent = s.earnings.epsGrowthPercent; return m; })(),
          meta: { automatic: true }
        } as any;
        try{ await cycleAuditStore.append(audit); }catch(_){ }
      }catch(_){ }
      // Also append a legacy SIGNAL_CONFLUENCE_SNAPSHOT built from the cached summary (marked legacy)
      try{
        const sym = String(payload && payload.symbol || '').toUpperCase();
        if (sym){
          const summary = await getOrBuildConfluence(sym, undefined, payload.generatedAt || undefined);
          if (summary){
            try{
              const legacy = qc.buildConfluenceAuditPayload(cycleId, summary, payload && payload.reasoning ? payload.reasoning : undefined) as any;
              legacy.legacy = true;
              legacy.supersededBy = 'DECISION_INTELLIGENCE_SNAPSHOT';
              if (!legacy.id) legacy.id = `legacy_confluence_${sym}_${Date.now()}`;
              if (!legacy.timestamp) legacy.timestamp = new Date().toISOString();
              try{ await cycleAuditStore.append(legacy); }catch(_){ }
            }catch(_){ }
          }
        }
      }catch(_){ }
    } });
  }catch(_){ decisionIntelligenceResolver = null; }

  // Create per-cycle shadow resolver using per-cycle getters and diagnostics builder
  const contextAwareShadowResolver = createPerCycleContextAwareShadowResolver({
    getHistoricalSnapshot: async (s:string) => { try{ if (historicalMarketContextBySymbol.has(s)) return await (historicalMarketContextBySymbol.get(s) as Promise<any>).catch(()=>null); return null; }catch(_){ return null; } },
    getMarketRegimeSnapshot: async (s:string) => { try{ if (marketRegimeIntelligenceBySymbol.has(s)) return await (marketRegimeIntelligenceBySymbol.get(s) as Promise<any>).catch(()=>null); return null; }catch(_){ return null; } },
    buildDiagnostics: ({ action, confidence, historicalContext, marketRegime }: any) => {
      try{ const qc = require('./signal-confluence'); return qc.buildDecisionMarketContextDiagnostics({ action: action || 'UNKNOWN', confidence: typeof confidence === 'number' ? confidence : null, historicalContext: historicalContext || null, marketRegime: marketRegime || null }); }catch(_){ return null; }
    }
  });

  // Build (once per symbol per cycle) the ordered list of signals to append.
  async function buildSignalsForSymbol(opts: { symbol: string; instEntry?: any; instruments?: any[]; prices?: number[]; volumes?: number[]; techMeta?: any; sectorSummaries?: any; macros?: any[] }){
    const sym = String(opts.symbol || '').toUpperCase();
    if (!sym) return [];
    if (signalsBySymbol.has(sym)) return signalsBySymbol.get(sym) as Promise<any[]>;
    const p = (async ()=>{
      const out: any[] = [];
      try{
        const { instEntry, instruments, prices: pIn, volumes: vIn, techMeta, sectorSummaries, macros } = opts;
        // Normalize arrays (do not mutate originals)
        const prices = Array.isArray(pIn) ? pIn.slice() : (instEntry && Array.isArray(instEntry.prices) ? instEntry.prices.slice() : (instEntry && typeof instEntry.price === 'number' ? [instEntry.price] : []));
        const volumes = Array.isArray(vIn) ? vIn.slice() : (instEntry && Array.isArray(instEntry.volumes) ? instEntry.volumes.slice() : []);

        // 1-4: Technical momentum, Relative Strength, Sector Strength (these are observation-only and safe to build first)
        try{ if (techMeta){ const techSig = createTechnicalSignalIfFresh(techMeta, sym, new Date(), TECHNICAL_MOMENTUM_MAX_AGE_DAYS); if (techSig) out.push(techSig); } }catch(_){ }
        try{ const instrEntry = Array.isArray(instruments) ? instruments.find((ii:any)=> String(ii.symbol).toUpperCase() === sym) : instEntry; const relSig = createRelativeStrengthSignalForInstrument(instrEntry, instruments || [], new Date()); if (relSig) out.push(relSig); }catch(_){ }
        try{ const sectorSig = createSectorStrengthSignalForInstrument({ symbol: sym }, sectorSummaries, new Date().toISOString()); if (sectorSig) out.push(sectorSig); }catch(_){ }

        // 5-7: Volume, Trend Quality, Supply/Demand (market-structure builders)
        try{ const vs = buildVolumeSignal(sym, volumes, prices); if (vs) out.push(vs); }catch(_){ }
        try{ const tq = buildTrendQualitySignal(sym, prices); if (tq) out.push(tq); }catch(_){ }
        try{ const sd = buildSupportResistanceSignal(sym, prices); if (sd) out.push(sd); }catch(_){ }

        // 8: Macro signals appended last
        try{ if (Array.isArray(macros)){ for (const m of macros){ if (m && m.id && !out.some(o=> String(o.id) === String(m.id))) out.push(m); } } }catch(_){ }
      }catch(_){ }
      return out;
    })();
    signalsBySymbol.set(sym, p);
    return p;
  }

  // Helper to build meta object for appendEvaluation that may include fundamentalAnalysis
  const getMetaForSymbol = (symbol: string, techMeta: any) => {
    const meta: any = { automatic: true, technicalAnalysis: techMeta };
    try{
      if (opts && opts.overrideUniverse && opts.overrideUniverse.fundamentals && opts.overrideUniverse.fundamentals[symbol]){
        meta.fundamentalAnalysis = opts.overrideUniverse.fundamentals[symbol];
      }
    }catch(_){ }
    return meta;
  };

  // Helper: pick up to two supporting market signal ids of distinct types for a given symbol and desired action
  // pickSupportingSignalIds is implemented at module scope and exported above

  // use module-scope helpers exported for tests

  // Evaluate existing holdings first
  if (Array.isArray(portfolio.holdings)){
    for (const h of portfolio.holdings){
      const symbol = (h.symbol||'').toUpperCase();
      const q = quotes && Array.isArray(quotes) ? quotes.find((x:any)=> {
        try{
          const sym = (x && x.symbol) ? String(x.symbol).toUpperCase() : null;
          const iid = (x && x.instrumentId) ? String(x.instrumentId).toUpperCase() : null;
          const pSym = (x && x.providerSymbol) ? String(x.providerSymbol).toUpperCase() : null;
          const normalize = (s: string| null) => s ? String(s).toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
          const nSymbol = normalize(symbol);
          return (sym && (sym === symbol || normalize(sym) === nSymbol)) || (iid && (iid === symbol || normalize(iid) === nSymbol)) || (pSym && (pSym === symbol || normalize(pSym) === nSymbol));
        }catch(e){ return false; }
      }) : null;
      const evalRes = evaluateHoldingActionPublic(h,q);
      // diagnostics for this holding
      try{
        const d = ensureDiag(symbol);
        d.quoteFound = !!q;
        d.quoteAgeSeconds = getQuoteAgeSeconds(q);
        try{ d.marketOpen = !!(getNextNYOpenInstant(new Date()).open); }catch(_){ d.marketOpen = null; }
        d.signal = evalRes && evalRes.action ? evalRes.action : null;
        d.confidence = 0;
      }catch(_){ }
      // count this symbol as evaluated once per cycle (holdings always count)
      if (!evaluatedSymbols.has(symbol)){
        evaluatedSymbols.add(symbol);
        evaluationCount++;
      }
      // Attach centralized technical analysis (observe-only) using historical daily closes
      let _techMeta_for_holding: any = null;
      try{

        _techMeta_for_holding = await fetchAndAnalyze(symbol);
        try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${symbol}_${Date.now()}`, symbol, action: evalRes.action, confidence: 0, referencePrice: q && (q.priceSek||q.price) || h.currentPrice, generatedAt: nowIso() }, reason: { action: evalRes.action, reason: evalRes.reason, score: evalRes.score }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(symbol, _techMeta_for_holding) } as any, cycleAuditStore); }catch(e){}
      }catch(_){
        try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${symbol}_${Date.now()}`, symbol, action: evalRes.action, confidence: 0, referencePrice: q && (q.priceSek||q.price) || h.currentPrice, generatedAt: nowIso() }, reason: { action: evalRes.action, reason: evalRes.reason, score: evalRes.score }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(symbol, { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: 'PROVIDER_ERROR', technicalAnalysisErrorMessage: 'Fetch failed' }) } as any, cycleAuditStore); }catch(_){ }
      }
      if (evalRes.action === 'SELL'){
          plannedSymbols.add(symbol);
          // Ask Decision Engine for final decision (include per-cycle reflection)
          try{
            // If we have technical meta, try to compute an expected return estimate and forward it to the decision engine
            let expectedReturnForDecision: number | undefined = undefined;
            try{
              if (_techMeta_for_holding && _techMeta_for_holding.technicalMomentumPercent !== undefined){
                const techEngine = { status: _techMeta_for_holding.technicalAnalysisStatus || null, score: typeof _techMeta_for_holding.technicalScore === 'number' ? _techMeta_for_holding.technicalScore : undefined, signal: _techMeta_for_holding.technicalSignal || undefined, reasons: Array.isArray(_techMeta_for_holding.technicalReasons) ? _techMeta_for_holding.technicalReasons : undefined } as any;
                const fundEngine = (opts && opts.overrideUniverse && opts.overrideUniverse.fundamentals && opts.overrideUniverse.fundamentals[symbol]) ? opts.overrideUniverse.fundamentals[symbol] : null;
                const combined = combineAnalyses({ technical: techEngine, fundamental: fundEngine });
                const estimate = estimateExpectedReturn({ momentumPercent: _techMeta_for_holding.technicalMomentumPercent, confidence: combined && typeof combined.confidence === 'number' ? combined.confidence : NaN });
                if (estimate && typeof estimate.expectedReturnPercent === 'number' && Number.isFinite(estimate.expectedReturnPercent)) expectedReturnForDecision = estimate.expectedReturnPercent;
              }
            }catch(_){ /* ignore estimate failures and proceed without expectedReturnPercent for SELL */ }

            // Build typed marketSignals from available quotes/analysis and attach to DecisionEngine input
            let marketSignalsForDecision: any = undefined;
            try{
              const instruments: any[] = Array.isArray(quotes) ? (quotes as any[]).map((q:any)=> ({ instrumentId: q.instrumentId, symbol: q.symbol, name: q.name, price: (typeof q.priceSek === 'number' ? q.priceSek : (typeof q.price === 'number' ? q.price : null)), change: q.change, changePercent: q.changePercent, dataStatus: q.dataStatus, isStale: q.isStale, marketTimestamp: q.marketTimestamp })) : [];
              const validInstruments = instruments.filter(i=> i.price !== null && i.changePercent !== null && i.dataStatus !== 'UNAVAILABLE');
              const instrumentCount = instruments.length;
              const advancing = instruments.filter(i=> typeof i.changePercent === 'number' && i.changePercent > 0).length;
              const declining = instruments.filter(i=> typeof i.changePercent === 'number' && i.changePercent < 0).length;
              const unchanged = instruments.filter(i=> typeof i.changePercent === 'number' && i.changePercent === 0).length;
              const unavailable = instruments.filter(i=> i.price === null || i.changePercent === null).length;
              const avg = validInstruments.length > 0 ? Number((validInstruments.reduce((s,n)=> s + (Number(n.changePercent)||0),0)/validInstruments.length).toFixed(2)) : 0;
              const strongest = validInstruments.length > 0 ? validInstruments.reduce((best,cur)=> (cur.changePercent > (best.changePercent||-Infinity) ? cur : best)) : null;
              const weakest = validInstruments.length > 0 ? validInstruments.reduce((worst,cur)=> (cur.changePercent < (worst.changePercent||Infinity) ? cur : worst)) : null;
              const warnings: string[] = [];
              if ((quotes || []).some((qq:any)=> qq.dataStatus === 'DELAYED')) warnings.push('Marknadsdata är fördröjd.');
              const summary = { instrumentCount, advancing, declining, unchanged, unavailable, averageChangePercent: avg };
              const ctx = { generatedAt: new Date().toISOString(), marketDataStatus: (validInstruments.length === instruments.length && instruments.length > 0) ? 'READY' : (validInstruments.length > 0 ? 'PARTIAL' : 'UNAVAILABLE'), summary, strongest, weakest, instruments, warnings } as any;
              try{ const analysis = analyzeMarket(ctx as any); marketSignalsForDecision = buildMarketSignals(ctx as any, analysis as any); }catch(_){ marketSignalsForDecision = undefined; }
              // Append TECHNICAL_MOMENTUM signal from historical price analysis when available
              try{
                const techSignalObj = createTechnicalSignalIfFresh(_techMeta_for_holding, symbol, new Date(), TECHNICAL_MOMENTUM_MAX_AGE_DAYS);
                if (techSignalObj && marketSignalsForDecision && Array.isArray(marketSignalsForDecision.signals)){
                  marketSignalsForDecision.signals.push(techSignalObj);
                }
              }catch(_){ }
              // Try to create and append a RELATIVE_STRENGTH signal using same fresh quotes universe
              try{
                if (marketSignalsForDecision && Array.isArray(marketSignalsForDecision.signals)){
                  const instrEntry = Array.isArray(instruments) ? instruments.find((ii:any)=> String(ii.symbol).toUpperCase() === String(symbol).toUpperCase()) : null;
                  const relSig = createRelativeStrengthSignalForInstrument(instrEntry, instruments, new Date());
                  if (relSig && !marketSignalsForDecision.signals.some((s:any)=> s && s.id === relSig.id)){
                    marketSignalsForDecision.signals.push(relSig);
                  }
                }
              }catch(_){ }
              // Try to create and append a RELATIVE_STRENGTH signal using same fresh quotes universe
              // (sector and macros will be appended via per-symbol build to preserve ordering)
              // Append market-structure and related signals once per symbol using per-cycle cache
              try{
                if (marketSignalsForDecision && Array.isArray(marketSignalsForDecision.signals)){
                  const inst = Array.isArray(instruments) ? instruments.find((ii:any)=> String(ii.symbol).toUpperCase() === String(symbol).toUpperCase()) : null;
                  let prices = Array.isArray((inst && inst.prices) ? inst.prices : []) ? inst.prices.slice() : (inst && typeof inst.price === 'number' ? [inst.price] : []);
                  let volumes = Array.isArray((inst && inst.volumes) ? inst.volumes : []) ? (inst.volumes as any[]).slice() : [];
                  // If no per-instrument series provided, fetch deduped per-cycle historical series
                  if ((!Array.isArray(prices) || prices.length < 2) || (!Array.isArray(volumes) || volumes.length === 0)){
                    try{
                      const hist = await getHistoricalForSymbol(symbol);
                      if (hist && Array.isArray(hist.closes) && hist.closes.length) prices = hist.closes.slice();
                      // provider does not return volumes in current implementation
                      if (hist && Array.isArray((hist as any).volumes) && (hist as any).volumes.length) volumes = (hist as any).volumes.slice();
                    }catch(_){ /* tolerate provider errors */ }
                  }
                  const built = await buildSignalsForSymbol({ symbol, instEntry: inst, instruments, prices, volumes, techMeta: _techMeta_for_holding, sectorSummaries: cycleSectorSummaries, macros: cycleMacroSignals });
                  for (const s of Array.isArray(built) ? built : []){
                    try{ if (s && s.id && !marketSignalsForDecision.signals.some((x:any)=> x && x.id === s.id)) marketSignalsForDecision.signals.push(s); }catch(_){ }
                  }
                }
              }catch(_){ }
            }catch(_){ marketSignalsForDecision = undefined; }

            const decInput = { portfolio: { availableCash: portfolio.availableCash, totalValue: portfolio.totalValue, holdings: portfolio.holdings }, decision: { side: 'SELL', symbol, quantity: h.quantity, referencePrice: q && (q.priceSek||q.price) || h.currentPrice }, todaysTradeCount: 0, performanceReflection: perCycleReflection, performanceProfile: profile || undefined, expectedReturnPercent: expectedReturnForDecision, tradeFeedbackSummary: await computeTradeFeedbackSummary(auditStore), adaptiveDecisionContext, marketSignals: marketSignalsForDecision } as any;
              // Ensure decision.signals references actual marketSignals ids (at least two distinct types when available)
            let _chosenSupportingSignalIdsForDecision: string[] | undefined = undefined;
            // Build analysis snapshot (resolve analysis) using per-cycle resolver if available
            try{
              if (decisionIntelligenceResolver){
                try{
                  const snap = await decisionIntelligenceResolver.resolveAnalysis({ symbol, marketSignals: marketSignalsForDecision });
                  try{ const d = ensureDiag(symbol); if (d) d.decisionIntelligence = { direction: snap.direction, bullishScore: snap.bullishScore, bearishScore: snap.bearishScore, hasConflict: snap.hasConflict, hasIndependentBullishSupport: snap.hasIndependentBullishSupport, hasIndependentBearishSupport: snap.hasIndependentBearishSupport, analysisQuality: snap.analysisQuality, selectedSupportingSignals: snap.selectedSupportingSignals, warnings: snap.warnings, reasoning: snap.reasoning }; }catch(_){ }
                }catch(_){ }
              } else {
                const confluence = await getOrBuildConfluence(symbol, marketSignalsForDecision, cycleId);
                try{ const d = ensureDiag(symbol); if (d) d.confluence = confluence; }catch(_){ }
              }
            }catch(_){ }
            try{
              const picked = pickSupportingSignalIds(marketSignalsForDecision, symbol, 'SELL');
              if (Array.isArray(picked) && picked.length > 0) {
                _chosenSupportingSignalIdsForDecision = Array.from(new Set(picked.map((id:any)=> String(id))));
                (decInput.decision as PaperTradeDecision).signals = _chosenSupportingSignalIdsForDecision;
              }
              // If we have >=2 supporting ids of distinct types and no expectedReturnPercent, set a conservative default
              try{
                const ids = Array.isArray((decInput.decision as any).signals) ? (decInput.decision as any).signals as string[] : [];
                const idToType = new Map((marketSignalsForDecision && Array.isArray(marketSignalsForDecision.signals) ? marketSignalsForDecision.signals : []).map((s:any)=> [String(s.id), String(s.type)]));
                const types = new Set(ids.map(id => idToType.get(String(id))));
                // Do not fabricate expectedReturnPercent; leave undefined if missing
              }catch(_){ }
            }catch(_){ }
            // Finalize intelligence snapshot with selected supporting ids (append audit once)
            try{
              if (decisionIntelligenceResolver){
                try{
                  try{ pendingDecisionActionBySymbol.set(String(symbol||'').toUpperCase(), 'SELL'); }catch(_){ }
                  const finalSnap = await decisionIntelligenceResolver.finalizeSnapshot({ symbol, selectedSupportingSignalIds: _chosenSupportingSignalIdsForDecision || [] });
                  try{ const d = ensureDiag(symbol); if (d) d.decisionIntelligence = { direction: finalSnap.direction, bullishScore: finalSnap.bullishScore, bearishScore: finalSnap.bearishScore, hasConflict: finalSnap.hasConflict, hasIndependentBullishSupport: finalSnap.hasIndependentBullishSupport, hasIndependentBearishSupport: finalSnap.hasIndependentBearishSupport, analysisQuality: finalSnap.analysisQuality, selectedSupportingSignals: finalSnap.selectedSupportingSignals, warnings: finalSnap.warnings, reasoning: finalSnap.reasoning }; }catch(_){ }
                  try{ pendingDecisionActionBySymbol.delete(String(symbol||'').toUpperCase()); }catch(_){ }
                }catch(_){ try{ pendingDecisionActionBySymbol.delete(String(symbol||'').toUpperCase()); }catch(_){ } }
              }
            }catch(_){ }
            const decRes = DecisionEngine.evaluateDecision(decInput);
            const candBase: PaperTradeDecision = { id: `sell_${symbol}_${Date.now()}`, symbol, action: 'SELL', confidence: decRes.confidence, referencePrice: q && (q.priceSek||q.price) || h.currentPrice, generatedAt: nowIso() } as any;
            const candExtras: any = { requestedNotionalSek: Math.round((h.quantity || 0) * (q && (q.priceSek||q.price) || h.currentPrice) || 0), tradeFeedbackEffect: (decRes as any).tradeFeedbackEffect, signalFeedbackEffect: (decRes as any).signalFeedbackEffect };
            const cand = Object.assign({}, candBase, candExtras) as any;
            // Persist selected supporting signal ids on candidate (if any)
            try{
              if (Array.isArray(_chosenSupportingSignalIdsForDecision) && _chosenSupportingSignalIdsForDecision.length > 0){
                (cand as PaperTradeDecision).signals = _chosenSupportingSignalIdsForDecision;
                try{
                  const meta = buildSupportingSignalAuditMetadata(_chosenSupportingSignalIdsForDecision, marketSignalsForDecision);
                  if (Array.isArray(meta.supportingSignals) && meta.supportingSignals.length > 0) (cand as any).supportingSignals = meta.supportingSignals;
                }catch(_){ }
              }
            }catch(_){ }
            // attach risk and reflection for auditability (reuse same reflection object)
            if (typeof expectedReturnForDecision === 'number') (cand as any).expectedReturnPercent = expectedReturnForDecision;
            cand.risk = decRes.risk;
            // If DecisionEngine returned a macroSummary, copy only the safe fields into the candidate audit
            try{ if (decRes && decRes.macroSummary && typeof decRes.macroSummary === 'object'){ const ms = decRes.macroSummary; (cand as any).macroSummary = { bullishStrength: ms.bullishStrength, bearishStrength: ms.bearishStrength, adjustment: ms.adjustment, signalCount: ms.signalCount }; } }catch(_){ }
            if (perCycleReflection) cand.performanceReflection = perCycleReflection;
            // Build market regime observation (observation-only, deterministic)
            try{
              const tech = _techMeta_for_holding || {} as any;
              const trendStrength = (typeof tech.technicalTrend === 'string') ? (tech.technicalTrend === 'UP' ? 0.8 : (tech.technicalTrend === 'DOWN' ? -0.8 : undefined)) : (typeof tech.technicalScore === 'number' ? Math.max(-1, Math.min(1, tech.technicalScore / 100)) : undefined);
              const momentum = typeof tech.technicalMomentumPercent === 'number' ? tech.technicalMomentumPercent : undefined;
              const volatility = typeof tech.technicalVolatilityPercent === 'number' ? (tech.technicalVolatilityPercent / 100) : undefined;
              const priceVsMovingAverage = typeof tech.priceVsMovingAverage === 'number' ? tech.priceVsMovingAverage : undefined;
              const volumeStrength = typeof tech.volumeStrength === 'number' ? tech.volumeStrength : undefined;
              try{ (cand as any).marketRegime = classifyMarketRegime({ trendStrength, momentum, volatility, priceVsMovingAverage, volumeStrength }); }catch(_){ /* classification must not fail cycle */ }
            }catch(_){ }

            // Enrich candidate with evidence objects built from available per-cycle info
            try{
              // collect recent audits for historical context (best-effort)
              const allAuditsForHist = Array.isArray(await auditStore.list()) ? await auditStore.list() : [];
              const completed = (allAuditsForHist || []).map((a:any)=> a && a.raw ? a.raw : a).filter(Boolean).map((r:any)=>{
                if (r.kind === 'TRADE_FEEDBACK' && r.feedback) return { symbol: r.feedback && r.feedback.symbol ? String(r.feedback.symbol).toUpperCase() : null, returnPercent: typeof r.feedback.pnlPercent === 'number' ? r.feedback.pnlPercent : (typeof r.feedback.returnPercent === 'number' ? r.feedback.returnPercent : null), marketRegime: r.feedback && r.feedback.marketRegime ? r.feedback.marketRegime : null, marketContextAdvice: r.feedback && r.feedback.marketContextAdvice ? r.feedback.marketContextAdvice : null } as any;
                if (r.kind === 'EVALUATION' && r.evaluation) return { symbol: r.evaluation && r.evaluation.symbol ? String(r.evaluation.symbol).toUpperCase() : null, returnPercent: typeof r.evaluation.returnPercent === 'number' ? r.evaluation.returnPercent : null, marketRegime: r.evaluation && r.evaluation.marketRegime ? r.evaluation.marketRegime : null, marketContextAdvice: r.evaluation && r.evaluation.marketContextAdvice ? r.evaluation.marketContextAdvice : null } as any;
                return null;
              }).filter(Boolean);

              const hist: HistoricalContext = buildHistoricalContext({ marketRegime: (cand as any).marketRegime, marketContextAdvice: (cand as any).marketContextAdvice, completedTradeEvaluations: completed });

              const drCandidate = { symbol: cand.symbol, action: cand.action, confidence: cand.confidence, marketRegime: (cand as any).marketRegime, marketContextAdvice: (cand as any).marketContextAdvice } as any;

              const expl = buildDecisionConfidenceExplanation({ decisionReason: drCandidate, marketRegime: (cand as any).marketRegime, marketContextAdvice: (cand as any).marketContextAdvice, historicalContext: hist, adaptiveDecisionContext }) as any;
              const ev: DecisionEvidence = buildDecisionEvidence({ decisionReason: drCandidate, marketRegime: (cand as any).marketRegime, marketContextAdvice: (cand as any).marketContextAdvice, historicalContext: hist, adaptiveDecisionContext, decisionConfidenceExplanation: expl });
              const ec: EvidenceConsistency = analyzeEvidenceConsistency({ decisionEvidence: ev });
              const sid: EvidenceInformedDecision = buildEvidenceInformedDecision({ currentAction: cand.action, currentConfidence: cand.confidence, decisionEvidence: ev, evidenceConsistency: ec });

              // Attach enriched objects on candidate passed to engine and audits
              (cand as any).historicalContext = hist;
              (cand as any).decisionConfidenceExplanation = expl;
              (cand as any).decisionEvidence = ev;
              (cand as any).evidenceConsistency = ec;
              (cand as any).evidenceInformedDecision = sid;
            }catch(_){ }

            candidates.push(cand);
            try{
              // Build and attach context-aware shadow decision for this candidate (diagnostic-only)
              (async ()=>{
                try{
                  const symU = String(symbol||'').toUpperCase(); if (!symU) return;
                  const shadow = await contextAwareShadowResolver.resolve({ symbol: symU, actualAction: cand.action, actualConfidence: cand.confidence });
                  const sanitizedShadow = sanitizeContextAwareShadowDecisionForState(shadow);
                  try{
                    runtime.latestDecisionIntelligenceBySymbol = runtime.latestDecisionIntelligenceBySymbol || {};
                    const existing = runtime.latestDecisionIntelligenceBySymbol[symU] || null;
                    if (existing && typeof existing === 'object') runtime.latestDecisionIntelligenceBySymbol[symU] = Object.assign({}, existing, { contextAwareShadowDecision: sanitizedShadow });
                    else runtime.latestDecisionIntelligenceBySymbol[symU] = { symbol: symU, contextAwareShadowDecision: sanitizedShadow };
                  }catch(_){ }
                }catch(_){ }
              })();
            }catch(_){ }
            try{ const d2 = ensureDiag(symbol); d2.decision = cand.action; d2.signal = d2.signal || 'SELL'; d2.confidence = typeof cand.confidence === 'number' ? cand.confidence : d2.confidence; }catch(_){ }
          }catch(e:any){
            // On decision engine error: append a REJECT audit and skip this candidate
            try{
              await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_dec_${symbol}_${Date.now()}`, symbol, action: 'SELL' }, reason: { code: 'DECISION_ENGINE_ERROR', message: String(e && e.message ? e.message : e) }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any);
            }catch(_){ }
            continue;
          }
      }
    }
  }

  // Now consider buy candidates from symbols list, skip those already planned for sell
  if (quotes && Array.isArray(quotes)){
    for (const s of symbols){
      if (plannedSymbols.has(s)) continue;
      const q = quotes.find((x:any)=>{
        try{
          const sym = (x && x.symbol) ? String(x.symbol).toUpperCase() : null;
          const iid = (x && x.instrumentId) ? String(x.instrumentId).toUpperCase() : null;
          const pSym = (x && x.providerSymbol) ? String(x.providerSymbol).toUpperCase() : null;
          return (sym && sym === s) || (iid && iid === s) || (pSym && pSym === s);
        }catch(e){ return false; }
      });
      if (!q){
        // record per-symbol quote missing as a REJECT but do not count as evaluation
        try{ await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_${s}_${Date.now()}`, symbol: s, action: 'UNKNOWN' }, reason: { code: 'QUOTE_MISSING', message: 'Quote missing for symbol' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
        try{ const dqm = ensureDiag(s); dqm.quoteFound = false; dqm.rejectionReason = 'QUOTE_MISSING'; }catch(_){ }
        continue;
      }
      const currency = q.currency || null;
      let sekPrice = (typeof q.priceSek === 'number' && Number.isFinite(q.priceSek) && q.priceSek > 0) ? q.priceSek : null;
      const rawPrice = (typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0) ? q.price : null;
      if (currency && String(currency).toUpperCase() !== 'SEK' && sekPrice === null){
        // Attempt deterministic conversion to SEK using provider for non-SEK quoted instruments
        try{
          const md = await import('../market-data');
          const provider = md && typeof md.getMarketDataProvider === 'function' ? md.getMarketDataProvider() : (md && md.default) || null;
          if (provider && typeof (provider as any).getFxRate === 'function'){
            const fromCur = String(currency).toUpperCase();
            const rawFx = await (provider as any).getFxRate(fromCur,'SEK');
            let rate: number | null = null;
            if (rawFx === null || rawFx === undefined) rate = null;
            else if (typeof rawFx === 'number') rate = Number(rawFx);
            else if (rawFx && typeof rawFx === 'object' && (rawFx.rate || rawFx.rate === 0)) rate = Number(rawFx.rate);
            if (rate && Number.isFinite(rate) && rate > 0 && rawPrice && Number.isFinite(Number(rawPrice))){
              sekPrice = Number(rawPrice) * Number(rate);
            }
          }
        }catch(e){ /* ignore */ }
      }
      const usePrice = sekPrice !== null ? sekPrice : rawPrice;
      if (!usePrice || usePrice <= 0){
        try{ await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_${s}_${Date.now()}`, symbol: s, action: 'UNKNOWN' }, reason: { code: 'QUOTE_INVALID', message: 'Invalid price from quote' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
        continue;
      }

      // Determine buy signal: only buy on dip vs last evaluation for this symbol (prevents random buys)
      // Find last evaluation audit for symbol
      const allAudits = await auditStore.list();
      const lastEval = allAudits.find((a:any)=> a && a.summary && a.summary.decisionId && String(a.summary.decisionId).toLowerCase().includes(String(s).toLowerCase())) || null;
      let buySignal = false; let signalReason = 'No prior evaluation';
      if (lastEval && lastEval.raw && lastEval.raw.decision && typeof lastEval.raw.decision.referencePrice === 'number'){
        const lastRef = Number(lastEval.raw.decision.referencePrice);
        if (usePrice <= lastRef * 0.99){ buySignal = true; signalReason = 'Price dipped 1% vs last reference'; }
      }

      if (buySignal){
        // perform observe-only technical analysis before adding candidate (do not alter buy decision)
        let _techMeta_for_buy: any = null;
        try{
            try{

              _techMeta_for_buy = await fetchAndAnalyze(s);
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Buy candidate observed', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(s, _techMeta_for_buy) } as any, cycleAuditStore); }catch(e){}
            }catch(e:any){
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Buy candidate observed', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(s, { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) }) } as any, cycleAuditStore); }catch(_){ }
            }
        }catch(e:any){
          // on history error, log unavailable status but continue
          try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Buy candidate observed', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) } } as any, cycleAuditStore); }catch(_){ }
        }
        try{
          // Compute expected return estimate from technical meta + combined analysis
          let estimateForBuy: any = null;
          try{
            if (_techMeta_for_buy && _techMeta_for_buy.technicalMomentumPercent !== undefined){
              const techEngine = { status: _techMeta_for_buy.technicalAnalysisStatus || null, score: typeof _techMeta_for_buy.technicalScore === 'number' ? _techMeta_for_buy.technicalScore : undefined, signal: _techMeta_for_buy.technicalSignal || undefined, reasons: Array.isArray(_techMeta_for_buy.technicalReasons) ? _techMeta_for_buy.technicalReasons : undefined } as any;
              const fundEngine = (opts && opts.overrideUniverse && opts.overrideUniverse.fundamentals && opts.overrideUniverse.fundamentals[s]) ? opts.overrideUniverse.fundamentals[s] : null;
              const combined = combineAnalyses({ technical: techEngine, fundamental: fundEngine });
              estimateForBuy = estimateExpectedReturn({ momentumPercent: _techMeta_for_buy.technicalMomentumPercent, confidence: combined && typeof combined.confidence === 'number' ? combined.confidence : NaN });
            }
          }catch(_){ estimateForBuy = null; }

          // If estimate is null, do not create BUY candidate or call decision engine for BUY
          if (!estimateForBuy){
            try{ await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_est_${s}_${Date.now()}`, symbol: s, action: 'BUY' }, reason: { code: 'EXPECTED_RETURN_MISSING', message: 'Expected return estimate unavailable' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
            continue;
          }

          // Build typed marketSignals from available quotes/analysis and attach to DecisionEngine input for BUY
          let marketSignalsForBuy: any = undefined;
          try{
            const instruments: any[] = Array.isArray(quotes) ? (quotes as any[]).map((q:any)=> ({ instrumentId: q.instrumentId, symbol: q.symbol, name: q.name, price: (typeof q.priceSek === 'number' ? q.priceSek : (typeof q.price === 'number' ? q.price : null)), change: q.change, changePercent: q.changePercent, dataStatus: q.dataStatus, isStale: q.isStale, marketTimestamp: q.marketTimestamp })) : [];
            const validInstruments = instruments.filter(i=> i.price !== null && i.changePercent !== null && i.dataStatus !== 'UNAVAILABLE');
            const instrumentCount = instruments.length;
            const advancing = instruments.filter(i=> typeof i.changePercent === 'number' && i.changePercent > 0).length;
            const declining = instruments.filter(i=> typeof i.changePercent === 'number' && i.changePercent < 0).length;
            const unchanged = instruments.filter(i=> typeof i.changePercent === 'number' && i.changePercent === 0).length;
            const unavailable = instruments.filter(i=> i.price === null || i.changePercent === null).length;
            const avg = validInstruments.length > 0 ? Number((validInstruments.reduce((s,n)=> s + (Number(n.changePercent)||0),0)/validInstruments.length).toFixed(2)) : 0;
            const strongest = validInstruments.length > 0 ? validInstruments.reduce((best,cur)=> (cur.changePercent > (best.changePercent||-Infinity) ? cur : best)) : null;
            const weakest = validInstruments.length > 0 ? validInstruments.reduce((worst,cur)=> (cur.changePercent < (worst.changePercent||Infinity) ? cur : worst)) : null;
            const warnings: string[] = [];
            if ((quotes || []).some((qq:any)=> qq.dataStatus === 'DELAYED')) warnings.push('Marknadsdata är fördröjd.');
            const summary = { instrumentCount, advancing, declining, unchanged, unavailable, averageChangePercent: avg };
            const ctx = { generatedAt: new Date().toISOString(), marketDataStatus: (validInstruments.length === instruments.length && instruments.length > 0) ? 'READY' : (validInstruments.length > 0 ? 'PARTIAL' : 'UNAVAILABLE'), summary, strongest, weakest, instruments, warnings } as any;
            try{ const analysis = analyzeMarket(ctx as any); marketSignalsForBuy = buildMarketSignals(ctx as any, analysis as any); }catch(_){ marketSignalsForBuy = undefined; }
              // Append TECHNICAL_MOMENTUM for buy candidates when technical meta is available
              try{
                const techSignalObj = createTechnicalSignalIfFresh(_techMeta_for_buy, s, new Date(), TECHNICAL_MOMENTUM_MAX_AGE_DAYS);
                if (techSignalObj && marketSignalsForBuy && Array.isArray(marketSignalsForBuy.signals)){
                  marketSignalsForBuy.signals.push(techSignalObj);
                }
              }catch(_){ }
              // Append RELATIVE_STRENGTH for BUY path using same instruments universe
              try{
                if (marketSignalsForBuy && Array.isArray(marketSignalsForBuy.signals)){
                  const instrEntry = Array.isArray(instruments) ? instruments.find((ii:any)=> String(ii.symbol).toUpperCase() === String(s).toUpperCase()) : null;
                  const relSig = createRelativeStrengthSignalForInstrument(instrEntry, instruments, new Date());
                  if (relSig && !marketSignalsForBuy.signals.some((ss:any)=> ss && ss.id === relSig.id)){
                    marketSignalsForBuy.signals.push(relSig);
                  }
                }
              }catch(_){ }
              // Append related market-structure and sector/macros via per-symbol build to preserve ordering
              try{
                if (marketSignalsForBuy && Array.isArray(marketSignalsForBuy.signals)){
                  const inst = Array.isArray(instruments) ? instruments.find((ii:any)=> String(ii.symbol).toUpperCase() === String(s).toUpperCase()) : null;
                  let prices = Array.isArray((inst && inst.prices) ? inst.prices : []) ? (inst.prices as any[]).slice() : (inst && typeof inst.price === 'number' ? [inst.price] : []);
                  let volumes = Array.isArray((inst && inst.volumes) ? inst.volumes : []) ? (inst.volumes as any[]).slice() : [];
                  if ((!Array.isArray(prices) || prices.length < 2) || (!Array.isArray(volumes) || volumes.length === 0)){
                    try{ const hist = await getHistoricalForSymbol(s); if (hist && Array.isArray(hist.closes) && hist.closes.length) prices = hist.closes.slice(); if (hist && Array.isArray((hist as any).volumes) && (hist as any).volumes.length) volumes = (hist as any).volumes.slice(); }catch(_){ }
                  }
                  const built = await buildSignalsForSymbol({ symbol: s, instEntry: inst, instruments, prices, volumes, techMeta: _techMeta_for_buy, sectorSummaries: cycleSectorSummaries, macros: cycleMacroSignals });
                  for (const ss of Array.isArray(built) ? built : []){ try{ if (ss && ss.id && !marketSignalsForBuy.signals.some((x:any)=> x && x.id === ss.id)) marketSignalsForBuy.signals.push(ss); }catch(_){ } }
                }
              }catch(_){ }
          }catch(_){ marketSignalsForBuy = undefined; }

          const decInput = { portfolio: { availableCash: portfolio.availableCash, totalValue: portfolio.totalValue, holdings: portfolio.holdings }, decision: { side: 'BUY', symbol: s, requestedNotionalSek: 8000, referencePrice: usePrice }, todaysTradeCount: 0, performanceReflection: perCycleReflection, performanceProfile: profile || undefined, expectedReturnPercent: estimateForBuy.expectedReturnPercent, tradeFeedbackSummary: await computeTradeFeedbackSummary(auditStore), adaptiveDecisionContext, marketSignals: marketSignalsForBuy } as any;
          // Ensure decision.signals references actual marketSignals ids (at least two distinct types when available)
            let _chosenSupportingSignalIdsForBuy: string[] | undefined = undefined;
            // Build confluence summary for BUY path (once per symbol per cycle)
            try{
              try{
                const confluence = await getOrBuildConfluence(s, marketSignalsForBuy, cycleId);
                try{ const d = ensureDiag(s); if (d) d.confluence = confluence; }catch(_){ }
                try{
                  if (confluence){
                    const auditObj: any = { kind: 'SIGNAL_CONFLUENCE_SNAPSHOT', cycleId, symbol: s, generatedAt: confluence.generatedAt, direction: confluence.direction, bullishScore: confluence.bullishScore, bearishScore: confluence.bearishScore, bullishSignalCount: confluence.bullishSignalCount, bearishSignalCount: confluence.bearishSignalCount, usableSignalCount: confluence.usableSignalCount, placeholderCount: confluence.placeholderCount, distinctTypes: confluence.distinctTypes, distinctOrigins: confluence.distinctOrigins, hasIndependentBullishSupport: confluence.hasIndependentBullishSupport, hasIndependentBearishSupport: confluence.hasIndependentBearishSupport, hasConflict: confluence.hasConflict, strongestBullish: confluence.strongestBullish ? { id: confluence.strongestBullish.id, type: confluence.strongestBullish.type, origin: confluence.strongestBullish.origin, strength: confluence.strongestBullish.strength } : undefined, strongestBearish: confluence.strongestBearish ? { id: confluence.strongestBearish.id, type: confluence.strongestBearish.type, origin: confluence.strongestBearish.origin, strength: confluence.strongestBearish.strength } : undefined, warnings: Array.isArray(confluence.warnings) ? confluence.warnings.slice() : [] };
                    try{ await cycleAuditStore.append(auditObj as any); }catch(_){ }
                  }
                }catch(_){ }
              }catch(_){ }
            }catch(_){ }
            try{
              const picked = pickSupportingSignalIds(marketSignalsForBuy, s, 'BUY');
              if (Array.isArray(picked) && picked.length > 0){
                _chosenSupportingSignalIdsForBuy = Array.from(new Set(picked.map((id:any)=> String(id))));
                (decInput.decision as PaperTradeDecision).signals = _chosenSupportingSignalIdsForBuy;
              }
            // If we have >=2 supporting ids of distinct types and no expectedReturnPercent, set a conservative default
            try{
              const ids = Array.isArray((decInput.decision as any).signals) ? (decInput.decision as any).signals as string[] : [];
              const idToType = new Map((marketSignalsForBuy && Array.isArray(marketSignalsForBuy.signals) ? marketSignalsForBuy.signals : []).map((s:any)=> [String(s.id), String(s.type)]));
              const types = new Set(ids.map(id => idToType.get(String(id))));
              // Do not fabricate expectedReturnPercent; leave undefined if missing
            }catch(_){ }
          }catch(_){ }
          const decRes = DecisionEngine.evaluateDecision(decInput);
          const candBase: PaperTradeDecision = { id: `buy_${s}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, symbol: s, action: 'BUY', confidence: decRes.confidence, referencePrice: usePrice, generatedAt: nowIso() } as any;
          const candExtras: any = { reasoning: ['Buy-on-dip'], requestedNotionalSek: 8000, tradeFeedbackEffect: (decRes as any).tradeFeedbackEffect, signalFeedbackEffect: (decRes as any).signalFeedbackEffect };
          const cand = Object.assign({}, candBase, candExtras) as any;
          // Persist chosen supporting signal ids on candidate (if any)
          try{
            if (Array.isArray(_chosenSupportingSignalIdsForBuy) && _chosenSupportingSignalIdsForBuy.length > 0){
              (cand as PaperTradeDecision).signals = _chosenSupportingSignalIdsForBuy;
              try{
                const available = Array.isArray(marketSignalsForBuy && marketSignalsForBuy.signals) ? marketSignalsForBuy.signals : [];
                const supporting = [] as Array<{id:string;type:string;origin:string}>;
                for (const id of _chosenSupportingSignalIdsForBuy){
                  const obj = available.find((s2:any)=> s2 && String(s2.id) === String(id));
                  if (obj && obj.id){
                    const entry = { id: String(obj.id), type: String(obj.type || ''), origin: String(obj.origin || '') };
                    if (!supporting.some(ss => ss.id === entry.id)) supporting.push(entry);
                  }
                }
                if (supporting.length > 0) (cand as any).supportingSignals = supporting;
              }catch(_){ }
            }
          }catch(_){ }
          // persist estimate on candidate for auditability
          if (estimateForBuy && typeof estimateForBuy.expectedReturnPercent === 'number') (cand as any).expectedReturnPercent = estimateForBuy.expectedReturnPercent;
          cand.risk = decRes.risk;
          // If DecisionEngine returned a macroSummary, copy only the safe fields into the candidate audit
          try{ if (decRes && decRes.macroSummary && typeof decRes.macroSummary === 'object'){ const ms = decRes.macroSummary; (cand as any).macroSummary = { bullishStrength: ms.bullishStrength, bearishStrength: ms.bearishStrength, adjustment: ms.adjustment, signalCount: ms.signalCount }; } }catch(_){ }
          if (perCycleReflection) cand.performanceReflection = perCycleReflection;
          // Attach market regime classification as observation-only metadata
          try{
            const tech = _techMeta_for_buy || {} as any;
            const trendStrength = (typeof tech.technicalTrend === 'string') ? (tech.technicalTrend === 'UP' ? 0.8 : (tech.technicalTrend === 'DOWN' ? -0.8 : undefined)) : (typeof tech.technicalScore === 'number' ? Math.max(-1, Math.min(1, tech.technicalScore / 100)) : undefined);
            const momentum = typeof tech.technicalMomentumPercent === 'number' ? tech.technicalMomentumPercent : undefined;
            const volatility = typeof tech.technicalVolatilityPercent === 'number' ? (tech.technicalVolatilityPercent / 100) : undefined;
            const priceVsMovingAverage = typeof tech.priceVsMovingAverage === 'number' ? tech.priceVsMovingAverage : undefined;
            const volumeStrength = typeof tech.volumeStrength === 'number' ? tech.volumeStrength : undefined;
            try{ (cand as any).marketRegime = classifyMarketRegime({ trendStrength, momentum, volatility, priceVsMovingAverage, volumeStrength }); }catch(_){ }
          }catch(_){ }
          candidates.push(cand);
          try{
            (async ()=>{
              try{
                const symU = String(s||'').toUpperCase(); if (!symU) return;
                const shadow = await contextAwareShadowResolver.resolve({ symbol: symU, actualAction: cand.action, actualConfidence: cand.confidence });
                const sanitizedShadow = sanitizeContextAwareShadowDecisionForState(shadow);
                try{ runtime.latestDecisionIntelligenceBySymbol = runtime.latestDecisionIntelligenceBySymbol || {}; const existing = runtime.latestDecisionIntelligenceBySymbol[symU] || null; if (existing && typeof existing === 'object') runtime.latestDecisionIntelligenceBySymbol[symU] = Object.assign({}, existing, { contextAwareShadowDecision: sanitizedShadow }); else runtime.latestDecisionIntelligenceBySymbol[symU] = { symbol: symU, contextAwareShadowDecision: sanitizedShadow }; }catch(_){ }
              }catch(_){ }
            })();
          }catch(_){ }
          try{ const d4 = ensureDiag(s); d4.decision = 'BUY'; d4.signal = d4.signal || 'BUY_CANDIDATE'; d4.confidence = typeof cand.confidence === 'number' ? cand.confidence : d4.confidence; d4.quoteFound = !!q; d4.quoteAgeSeconds = getQuoteAgeSeconds(q); }catch(_){ }
        }catch(e:any){
          // On decision engine error: append a REJECT audit and skip this candidate
          try{
            await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_dec_${s}_${Date.now()}`, symbol: s, action: 'BUY' }, reason: { code: 'DECISION_ENGINE_ERROR', message: String(e && e.message ? e.message : e) }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any);
          }catch(_){ }
          continue;
        }
      } else {
        if (!evaluatedSymbols.has(s)){
          evaluatedSymbols.add(s);
          evaluationCount++;
          // Observation-only path for symbols without buy signal: run technical analysis
          // and persist an EVALUATION audit so scheduler tests see the evaluation, but
          // opt-out of running the shadow outcome evaluator here (compute later via aggregator if needed).
          try{
            let _techMeta_for_buy_fallback: any = null;
            try{
              _techMeta_for_buy_fallback = await fetchAndAnalyze(s);
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Observed (no buy signal)', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(s, _techMeta_for_buy_fallback) } as any, cycleAuditStore, { evaluateShadowOutcome: false }); }catch(_){ }
            }catch(e:any){
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Observed (no buy signal)', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(s, { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) }) } as any, cycleAuditStore, { evaluateShadowOutcome: false }); }catch(_){ }
            }
          }catch(_){ /* tolerate any analysis errors */ }
        }
      }
    }
  }

  // If no candidates, produce HOLD
  if (!candidates.length){
    const now = nowIso();
    const hold = { id: `demo_hold_${now}`, symbol: 'NVDA', action: 'HOLD', confidence: 0, referencePrice: 0, generatedAt: now, reasoning: ['Saknar marknadsdata'] };
    runtime.latestDecision = hold as any;
    // Skip calling cycleTrader.handleDecision to avoid creating EVALUATIONs in zero-candidates flow
    // NOTE: `processedCandidates` = number of actionable BUY/SELL candidates processed
    runtime.latestCycle = { processedCandidates: 0, executed: 0, rejects: 1 } as any;
    runtime.lastUpdated = nowIso();
    const _rawList = await auditStore.list();
    const allAudits = Array.isArray(_rawList) ? _rawList : [];
    // Build adaptive context even when early-returning due to no candidates
    try{
      try{
        const cycleEntries3 = (allAudits || []).filter((a:any)=>{ try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; } });
        const tradeFeedbacks2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'TRADE_FEEDBACK') ? (a.raw.feedback || a.feedback || a.raw) : null).filter(Boolean);
        const outcomeEvaluations2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
        const learningSignals2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'LEARNING_SIGNAL') ? (a.raw.signal || a.signal || a.raw) : null).filter(Boolean);
        const decisionSummary = runtime && (runtime as any).latestCycle && (runtime as any).latestCycle.decisionSummary ? (runtime as any).latestCycle.decisionSummary : null;
        const victorReview2 = buildVictorReview(decisionSummary, tradeFeedbacks2, outcomeEvaluations2, learningSignals2, profile);
        const adaptiveContext2 = buildAdaptiveDecisionContext(profile, victorReview2);
        // set local per-cycle adaptiveDecisionContext for consistency
        adaptiveDecisionContext = adaptiveContext2;
        try{ await cycleAuditStore.append({ kind: 'ADAPTIVE_DECISION_CONTEXT', id: `adaptive_context_${cycleId}`, timestamp: nowIso(), context: adaptiveContext2, meta: { automatic: true } } as any); }catch(_){ }
        try{ runtime.latestCycle = { ...runtime.latestCycle, adaptiveDecisionContext: adaptiveContext2, victorReview: victorReview2 }; }catch(_){ }
        try{
          const snapshot3 = buildCycleIntelligenceSnapshot(decisionSummary, victorReview2, adaptiveContext2);
          try{ attachMarketNewsSummary(snapshot3); }catch(_){ }
          try{
            const auditObj: any = { kind: 'CYCLE_INTELLIGENCE_SNAPSHOT', id: `cycle_intel_${cycleId}`, timestamp: nowIso(), snapshot: snapshot3, meta: { automatic: true } };
            try{ attachMarketNewsAuditFields(auditObj, snapshot3); }catch(_){ }
            await cycleAuditStore.append(auditObj as any);
          }catch(_){ }
          try{ runtime.latestCycle = { ...runtime.latestCycle, cycleIntelligenceSnapshot: snapshot3 }; }catch(_){ }
        }catch(_){ }
      }catch(_){ }
    }catch(_){ }
    // Minimal: build and append DECISION_SUMMARY even when there are no candidates
    try{
    const all = allAudits;
    const cycleEntries = (all || []).filter((a)=>{ try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; } });
      const executedTrades = [];
      let rejectedTradesCount = 0;
      for (const e of cycleEntries){ const raw = e && e.raw ? e.raw : e; if (!raw) continue; if (raw.kind === 'EXECUTION' && raw.execution) executedTrades.push(raw.execution); if (raw.kind === 'REJECT') rejectedTradesCount++; }

      // reuse existing aggregator to compute shadowPerformanceSummary from stored EVALUATION audits
      let shadowPerformanceSummaryLocal = null;
      try{
        const outcomeEvaluationsLocal = (allAudits || []).filter((a)=>{ const raw = a && a.raw ? a.raw : a; try{ return raw && raw.kind === 'EVALUATION' && raw.cycleId !== cycleId; }catch(_){ return false; } }).map((a)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
        try{ shadowPerformanceSummaryLocal = aggregateShadowDecisionPerformance({ evaluations: outcomeEvaluationsLocal }); }catch(_){ shadowPerformanceSummaryLocal = null; }
      }catch(_){ shadowPerformanceSummaryLocal = null; }

      const diags = Array.from(diagnosticsBySymbol.values());
      const analyzedSymbols = diags.map((d)=> d && d.symbol).filter(Boolean);
      const eligibleSymbols = Array.isArray(eligibleInstruments) ? eligibleInstruments.map((i)=> (i.providerSymbol||i.id).toUpperCase()) : symbols || [];
      const skippedSymbols = diags.filter((d)=> d.rejectionReason === 'QUOTE_MISSING' || d.quoteFound === false).map((d)=> d.symbol).filter(Boolean);

      const summary = { cycleId, timestamp: nowIso(), analyzedSymbols, eligibleSymbols, skippedSymbols, decisions: [], executedTrades, rejectedTradesCount, confidenceAverage: null, topReason: null, riskBlocks: null, overallConclusion: 'NO_ACTION', marketSession: null, cycleDurationMs: Date.now() - cycleStartMs, skippedReasonsBySymbol: null, confidenceDistribution: null, strongestBullishReason: null, strongestBearishReason: null, cashBefore: null, cashAfter: null, portfolioValueBefore: null, portfolioValueAfter: null, decisionReasons: [], marketRegimeDistribution: null, dominantMarketRegime: null, shadowDecisionSummary: null, shadowPerformanceSummary: shadowPerformanceSummaryLocal };
      try{ await cycleAuditStore.append({ kind: 'DECISION_SUMMARY', id: `decision_summary_${cycleId}`, timestamp: nowIso(), summary, meta: { automatic: true } } as import('./types').AuditEntry); }catch(_){ }
      try{ runtime.latestCycle = { ...runtime.latestCycle, decisionSummary: summary }; }catch(_){ }
    }catch(_){ }
    return { ...runtime.latestCycle, evaluationCount };
  }

  // Select a single candidate to attempt execution this cycle (Watchlist Engine v1)
  const selected = selectBestCandidate(candidates);
  const candidatesToProcess = selected ? [selected] : [];
  // Try the selected candidate only. Maintain counters similar to previous behavior.
  let processed = 0; let executed = 0; let rejects = 0; let finalDecision: any = null;
  let executedBuy = 0; let executedSell = 0;
  for (const cand of candidatesToProcess){
    processed++;
    runtime.latestDecision = cand;
    // mark this symbol as evaluated once per cycle (if not already counted)
    const sSym = (cand && cand.symbol || '').toUpperCase();
    if (!evaluatedSymbols.has(sSym)){
      evaluatedSymbols.add(sSym);
      evaluationCount++;
    }

    // Append an EVALUATION audit that represents the strategy decision (observe-only)
    try{
        try{
              const techMetaForCand = await fetchAndAnalyze(sSym);
              await appendEvaluation({ kind: 'EVALUATION', decision: cand, evaluation: { tradeFeedbackEffect: (cand as any).tradeFeedbackEffect, signalFeedbackEffect: (cand as any).signalFeedbackEffect }, reason: { action: cand.action, reason: 'Strategy decision' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(sSym, techMetaForCand) } as any, cycleAuditStore);
      }catch(e:any){
        await appendEvaluation({ kind: 'EVALUATION', decision: cand, evaluation: { tradeFeedbackEffect: (cand as any).tradeFeedbackEffect, signalFeedbackEffect: (cand as any).signalFeedbackEffect }, reason: { action: cand.action, reason: 'Strategy decision' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(sSym, { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) }) } as any, cycleAuditStore);
      }
    }catch(_){ }

    // decide whether to attempt execution based on per-cycle limits
    const side = (cand.action || '').toUpperCase();
    const allowExec = (side === 'BUY' && executedBuy < 1) || (side === 'SELL' && executedSell < 1) || (side !== 'BUY' && side !== 'SELL');

    // record eligibility in diagnostics
    try{ const dd = ensureDiag(sSym); dd.decision = cand.action; dd.confidence = typeof cand.confidence === 'number' ? cand.confidence : dd.confidence; dd.eligibleForExecution = !!allowExec; }catch(_){ }

    if (!allowExec){
      // append a REJECT audit indicating cycle-level execution limit
      try{
        await cycleAuditStore.append({ kind: 'REJECT', decision: cand, reason: { code: 'CYCLE_LIMIT', message: 'Per-cycle execution limit reached' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any);
      }catch(_){ }
      try{ const dd = ensureDiag(sSym); if (!dd.rejectionReason) dd.rejectionReason = 'CYCLE_LIMIT'; }catch(_){ }
      rejects++;
      // continue to next candidate (do not break)
      continue;
    }

    // Capture portfolio snapshot before attempting execution so we can compute cost-basis
    const beforeExecutionPortfolio = await portfolioAdapter.getPortfolio();
    // Apply adaptive confidence policy using the per-cycle adaptiveDecisionContext
    try{
      const adaptiveCtx = adaptiveDecisionContext || null;
      const origConf = typeof cand.confidence === 'number' ? cand.confidence : 0;
      try{ (cand as any).originalConfidence = origConf; }catch(_){ }
      try{ (cand as any).confidence = applyAdaptiveConfidencePolicy(origConf, adaptiveCtx); }catch(_){ }
    }catch(_){ }
    // Enforcement: block Forex executions when cycle is DIAGNOSTIC_ONLY
    try{
      const inst = Array.isArray(TRADABLE_INSTRUMENTS) ? TRADABLE_INSTRUMENTS.find(i => {
        try{ const prov = String(i.providerSymbol || i.id || '').toUpperCase(); const sym = String(cand.symbol || '').toUpperCase(); return prov === sym || (i.id && String(i.id).toUpperCase() === sym); }catch(_){ return false; }
      }) : null;
      const isForexInstr = inst && inst.assetType && String(inst.assetType).toUpperCase().includes('FOREX');
      const mode = runtime.latestForexCycleStatus && runtime.latestForexCycleStatus.executionMode ? runtime.latestForexCycleStatus.executionMode : 'DIAGNOSTIC_ONLY';
      if (isForexInstr && mode === 'DIAGNOSTIC_ONLY'){
        // Append a REJECT audit for blocked Forex candidate and continue (no broker, no simulation)
        try{ await cycleAuditStore.append({ kind: 'REJECT', decision: cand, reason: { code: 'FOREX_DIAGNOSTIC_ONLY', message: 'Forex execution suppressed in diagnostic-only mode' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
        try{ const dd = ensureDiag(sSym); if (dd) { dd.executionAttempted = false; dd.rejectionReason = 'FOREX_DIAGNOSTIC_ONLY'; } }catch(_){ }
        rejects++;
        continue;
      }
    }catch(_){ }
    const res = await cycleTrader.handleDecision(cand);
    try{ const dd = ensureDiag(sSym); dd.executionAttempted = true; }catch(_){ }
    if (res && res.accepted){
      try{ const dd = ensureDiag(sSym); dd.executed = true; dd.rejectionReason = null; }catch(_){ }
      // attempt to compute trade evaluation for SELLs that fully close a position
      try{
        const exec: SimulatedExecution | null = (res.execution || res.transaction) || null;
        if (exec && String((exec as any).side || cand.action).toUpperCase() === 'SELL'){
          // fetch portfolio after execution to detect closure
          const afterExecutionPortfolio = await portfolioAdapter.getPortfolio();
          const sym = String(cand.symbol || '').toUpperCase();
          const stillHolding = Array.isArray(afterExecutionPortfolio.holdings) && afterExecutionPortfolio.holdings.find((h:any)=> String(h.symbol||'').toUpperCase() === sym);
          if (!stillHolding){
            // position closed: compute cost-basis from beforeExecutionPortfolio
            const beforeHolding = Array.isArray(beforeExecutionPortfolio.holdings) ? beforeExecutionPortfolio.holdings.find((h:any)=> String(h.symbol||'').toUpperCase() === sym) : null;
            const entryPrice = beforeHolding && typeof beforeHolding.averagePrice === 'number' ? Number(beforeHolding.averagePrice) : null;
            const exitPrice = typeof (exec as any).executedPrice === 'number' ? Number((exec as any).executedPrice) : null;
            const qty = typeof (exec as any).quantity === 'number' ? Number((exec as any).quantity) : null;
            if (entryPrice !== null && exitPrice !== null && qty !== null){
              // Prefer an existing evaluation object on the execution if it looks valid; otherwise compute a fallback
              let evaluation: any = null;
              try{
                const existing = (exec as any).evaluation;
                if (existing && typeof existing.pnlSek === 'number' && typeof existing.pnlPercent === 'number' && (existing.winner === true || existing.winner === false)){
                  evaluation = existing;
                }
              }catch(_){ /* ignore */ }
              if (!evaluation){
                evaluation = evaluateTrade({ entryPrice, exitPrice, quantity: qty, totalFees: exec.fee ?? 0 });
                try{ (exec as any).evaluation = evaluation; }catch(_){ }
              }
              // Attempt to resolve a single-entry BUY for a safe TradeReview
              try{
                const audits = await auditStore.list();
                let portfolioId = '';
                if (beforeExecutionPortfolio && typeof beforeExecutionPortfolio === 'object' && beforeExecutionPortfolio !== null){
                  const asRec = beforeExecutionPortfolio as Record<string, unknown>;
                  const idVal = asRec['id'];
                  if (typeof idVal === 'string') portfolioId = idVal;
                }
                const entry = resolveSingleEntryForReview({ audits, portfolioId, symbol: sym, soldQuantity: qty });
                if (entry){
                  const exitTs = nowIso();
                  const holdingMinutes = Math.max(0, Math.floor((new Date(exitTs).getTime() - new Date(entry.entryTimestamp).getTime()) / 60000));
                  const review = buildTradeReview({
                    executionId: entry.executionId,
                    symbol: sym,
                    entryPrice: entry.entryPrice,
                    exitPrice: exitPrice,
                    quantity: qty,
                    totalFees: exec.fee ?? 0,
                    holdingMinutes,
                    confidenceAtEntry: entry.confidenceAtEntry,
                    createdAt: exitTs,
                  });
                  try{ if (evaluation && typeof evaluation === 'object') (evaluation as Record<string, unknown>).tradeReview = review; }catch(_){ }
                }
              }catch(_){ /* tolerate resolver failures silently */ }
              // find the appended EXECUTION audit in the FileAuditStore and mutate its raw.execution to include the same evaluation object (reuse reference)
              try{
                const entries = (auditStore as any).entries as any[] | undefined;
                if (Array.isArray(entries)){
                  for (let i = entries.length - 1; i >= 0; i--){
                    const it = entries[i];
                    if (it && it.raw && it.raw.kind === 'EXECUTION' && it.raw.execution && it.raw.execution.id === exec.id){
                      try{ (it.raw.execution as any).evaluation = evaluation; }catch(_){ }
                      break;
                    }
                  }
                }
              }catch(_){ }
              // append a dedicated EVALUATION audit that reuses the same evaluation object
              try{
                await cycleAuditStore.append({ kind: 'EVALUATION', decision: cand, execution: exec, evaluation, portfolioBefore: beforeExecutionPortfolio, portfolioAfter: afterExecutionPortfolio, timestamp: nowIso(), meta: { automatic: true } } as any);
              }catch(_){ }
            }
          }
        }
      }catch(_){ }
      // record executed side counts but continue processing other symbols
      if (cand.action === 'BUY') executedBuy++;
      if (cand.action === 'SELL') executedSell++;
      executed = executedBuy + executedSell > 0 ? executedBuy + executedSell : executed;
      finalDecision = cand;
      // continue to next candidate (do not break)
      continue;
    }
    // rejected by trader: record and continue
    try{ const dd = ensureDiag(sSym); const code = res && (res.code || res.message) ? String(res.code || res.message).toUpperCase() : 'REJECTED';
      // map to prioritized primary blocker
      const priority = ['QUOTE_MISSING','STALE_QUOTE','MARKET_CLOSED','LOW_CONFIDENCE','RISK_LIMIT','POSITION_LIMIT','DAILY_LOSS_LIMIT','BROKER_REJECT','EXECUTION_DISABLED','CYCLE_LIMIT'];
      let mapped = null;
      if (code) mapped = code.replace(/[^A-Z0-9_]/g,'_');
      if (mapped){
        // prefer known mapping
        for (const p of priority){ if (mapped.includes(p)) { dd.rejectionReason = p; break; } }
        if (!dd.rejectionReason) dd.rejectionReason = mapped;
      } else { if (!dd.rejectionReason) dd.rejectionReason = 'REJECTED'; }
    }catch(_){ }
    rejects++;
    continue;
  }

  // NOTE: `processedCandidates` = number of actionable BUY/SELL candidates processed
  runtime.latestCycle = { processedCandidates: processed, executed, rejects } as any;
  runtime.latestDecision = finalDecision || candidates[candidates.length-1];
  runtime.lastUpdated = nowIso();
  // Build and append diagnostics summary for this automatic cycle (best-effort)
  try{
    const diags = Array.from(diagnosticsBySymbol.values());
    const analyzed = diags.length || evaluationCount || 0;
    const eligible = diags.filter((d:any)=> d.eligibleForExecution).length;
    const executedCount = diags.filter((d:any)=> d.executed).length;
    const blockerCounts: Record<string, number> = {};
    for (const d of diags){ const b = d.rejectionReason || 'NONE'; blockerCounts[b] = (blockerCounts[b]||0) + 1; }
    const diagnosticsAudit = { kind: 'AUTOPILOT_DIAGNOSTICS', diagnostics: { analyzed, eligible, executed: executedCount, blockers: blockerCounts, perSymbol: diags }, timestamp: nowIso(), meta: { automatic: true } } as any;
    // Build a compact Decision Summary derived from cycle-local information.
    try{
      // Gather cycle-scoped audit entries to extract executions and rejects
      const allAudits = Array.isArray(await auditStore.list()) ? await auditStore.list() : [];
      const cycleEntries = (allAudits || []).filter((a:any)=>{
        try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; }
      });
      const executedTrades = [] as any[];
      let rejectedTradesCount = 0;
      const reasonCounts: Record<string, number> = {};
      for (const e of cycleEntries){ const raw = e && e.raw ? e.raw : e; if (!raw) continue; if (raw.kind === 'EXECUTION' && raw.execution){ executedTrades.push(raw.execution); } if (raw.kind === 'REJECT') { rejectedTradesCount++; const rc = raw.reason && raw.reason.code ? String(raw.reason.code) : (raw.reason && raw.reason.message ? String(raw.reason.message) : 'REJECT'); reasonCounts[rc] = (reasonCounts[rc]||0) + 1; } }

      // placeholder for tradeFeedbacks (populated after decisionReasons built)
      const tradeFeedbacks: any[] = [];
      // Pre-compute outcome evaluations for this cycle and aggregate shadow performance
      let shadowPerformanceSummaryLocal: any = null;
      try{
        const allAudits = Array.isArray(await auditStore.list()) ? await auditStore.list() : [];
        const outcomeEvaluationsLocal = (allAudits || []).map((a:any)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
        try{ const agg = (await import('./shadow-decision-performance-aggregator')).default({ evaluations: outcomeEvaluationsLocal }); shadowPerformanceSummaryLocal = agg; }catch(_){ shadowPerformanceSummaryLocal = null; }
      }catch(_){ shadowPerformanceSummaryLocal = null; }

      // Compute topReason
      let topReason: string | null = null;
      try{ const entries = Object.entries(reasonCounts).sort((a,b)=> b[1]-a[1]); if (entries.length) topReason = entries[0][0]; }catch(_){ topReason = null; }

      const analyzedSymbols = diags.map((d:any)=> d.symbol).filter(Boolean);
      const eligibleSymbols = Array.isArray(eligibleInstruments) ? eligibleInstruments.map((i:any)=> (i.providerSymbol||i.id).toUpperCase()) : symbols || [];
      const skippedSymbols = diags.filter((d:any)=> d.rejectionReason === 'QUOTE_MISSING' || d.quoteFound === false).map((d:any)=> d.symbol).filter(Boolean);
      // skippedReasonsBySymbol: aggregate per-symbol rejection reasons from diagnostics and rejects
      const skippedReasonsBySymbol: Record<string,string[]> = {};
      for (const d of diags){ try{ if (d && d.symbol && d.rejectionReason) { const s = String(d.symbol).toUpperCase(); skippedReasonsBySymbol[s] = skippedReasonsBySymbol[s] || []; skippedReasonsBySymbol[s].push(String(d.rejectionReason)); } }catch(_){ } }
      for (const e of cycleEntries){ try{ const raw = e && e.raw ? e.raw : e; if (raw && raw.kind === 'REJECT' && raw.decision && raw.decision.symbol){ const s = String(raw.decision.symbol).toUpperCase(); const rc = raw.reason && raw.reason.code ? String(raw.reason.code) : (raw.reason && raw.reason.message ? String(raw.reason.message) : 'REJECT'); skippedReasonsBySymbol[s] = skippedReasonsBySymbol[s] || []; skippedReasonsBySymbol[s].push(rc); } }catch(_){ } }
      const decisionsForSummary = Array.isArray(candidates) ? candidates.map((c:any)=> ({ id: c.id, symbol: c.symbol, action: c.action, confidence: typeof c.confidence === 'number' ? c.confidence : undefined, expectedReturnPercent: (c as any).expectedReturnPercent ?? null, risk: c.risk || null })) : [];
      const confidenceAverage = decisionsForSummary.length ? Math.round((decisionsForSummary.reduce((s:any,c:any)=> s + (typeof c.confidence === 'number' ? c.confidence : 0), 0) / decisionsForSummary.length) * 100) / 100 : null;
      // confidenceDistribution: simple buckets
      const confidenceDistribution: Record<string, number> = { '0-20':0,'21-40':0,'41-60':0,'61-80':0,'81-100':0 };
      for (const d of decisionsForSummary){ try{ const v = typeof d.confidence === 'number' ? d.confidence : 0; if (v <= 20) confidenceDistribution['0-20']++; else if (v <= 40) confidenceDistribution['21-40']++; else if (v <= 60) confidenceDistribution['41-60']++; else if (v <= 80) confidenceDistribution['61-80']++; else confidenceDistribution['81-100']++; }catch(_){ } }
      const riskBlocks: Record<string, number> = {};
      for (const c of decisionsForSummary){ try{ if (c.risk && c.risk.level){ const k = String(c.risk.level); riskBlocks[k] = (riskBlocks[k]||0) + 1; } }catch(_){ } }
      // strongest bullish/bearish reasons: pick top occurring reason keywords from evaluations/rejects
      const bullishCounts: Record<string, number> = {};
      const bearishCounts: Record<string, number> = {};
      for (const e of cycleEntries){ try{ const raw = e && e.raw ? e.raw : e; if (!raw) continue; const msg = raw.reason && raw.reason.message ? String(raw.reason.message) : (raw.reason && raw.reason.code ? String(raw.reason.code) : null); const summaryDecision = (raw.decision && raw.decision.action) ? String(raw.decision.action).toUpperCase() : null; if (msg){ const m = msg.toLowerCase(); if (m.includes('buy') || m.includes('dip') || m.includes('momentum') || m.includes('positive')) { bullishCounts[msg] = (bullishCounts[msg]||0) + 1; } if (m.includes('sell') || m.includes('stop-loss') || m.includes('negative') || m.includes('low_confidence') || m.includes('position_limit')) { bearishCounts[msg] = (bearishCounts[msg]||0) + 1; } if (summaryDecision === 'BUY') bullishCounts[msg] = (bullishCounts[msg]||0) + 1; if (summaryDecision === 'SELL') bearishCounts[msg] = (bearishCounts[msg]||0) + 1; } }catch(_){ } }
      let strongestBullishReason: string | null = null;
      try{ const be = Object.entries(bullishCounts).sort((a,b)=> b[1]-a[1]); if (be.length) strongestBullishReason = be[0][0]; }catch(_){ strongestBullishReason = null; }
      let strongestBearishReason: string | null = null;
      try{ const be = Object.entries(bearishCounts).sort((a,b)=> b[1]-a[1]); if (be.length) strongestBearishReason = be[0][0]; }catch(_){ strongestBearishReason = null; }
      const overallConclusion = (Array.isArray(executedTrades) && executedTrades.length>0) ? 'EXECUTED' : (rejectedTradesCount>0 ? 'REJECTED' : 'NO_ACTION');

      // marketSession from NY helper
      let marketSession: any = null;
      try{ const ny = getNextNYOpenInstant(nowForCycle); marketSession = { marketOpen: ny && (ny as any).open === true ? true : false, nextOpenInstant: (ny && (ny as any).nextOpenInstant) ? (ny as any).nextOpenInstant.toString() : null }; }catch(_){ marketSession = { marketOpen: null, nextOpenInstant: null }; }

      // cash/portfolio before/after: derive from portfolio and any execution audits
      let cashBefore: number | null = null; let cashAfter: number | null = null; let portfolioValueBefore: number | null = null; let portfolioValueAfter: number | null = null;
      try{
        if (portfolio && typeof portfolio.availableCash === 'number') { cashBefore = portfolio.availableCash; portfolioValueBefore = typeof portfolio.totalValue === 'number' ? portfolio.totalValue : null; }
        // find first execution entry with portfolioBefore/after
        const firstExecEntry = cycleEntries.find((a:any)=> { const r = a && a.raw ? a.raw : a; return r && r.kind === 'EXECUTION' && (r.portfolioBefore || r.portfolioAfter); });
        if (firstExecEntry){ const r = firstExecEntry.raw || firstExecEntry; if (r.portfolioBefore && typeof r.portfolioBefore.availableCash === 'number') cashBefore = r.portfolioBefore.availableCash; if (r.portfolioAfter && typeof r.portfolioAfter.availableCash === 'number') cashAfter = r.portfolioAfter.availableCash; if (r.portfolioBefore && typeof r.portfolioBefore.totalValue === 'number') portfolioValueBefore = r.portfolioBefore.totalValue; if (r.portfolioAfter && typeof r.portfolioAfter.totalValue === 'number') portfolioValueAfter = r.portfolioAfter.totalValue; }
        // fallback: if no after, set after = before
        if (cashAfter === null) cashAfter = cashBefore; if (portfolioValueAfter === null) portfolioValueAfter = portfolioValueBefore;
      }catch(_){ }

      // Build DecisionReason objects per evaluated symbol using diagnostics and candidates
      const decisionReasons: any[] = [];
      try{
        const symSet = new Set<string>(analyzedSymbols.concat(eligibleSymbols || []).map((s:any)=> String(s).toUpperCase()));
        for (const sym of Array.from(symSet)){
          const diag = diagnosticsBySymbol.get(String(sym).toUpperCase()) || {};
          const cand = (candidates || []).find((c:any)=> String(c.symbol||'').toUpperCase() === String(sym).toUpperCase());
          const rejectsForSym = (cycleEntries || []).filter((a:any)=>{ const r = a && a.raw ? a.raw : a; try{ return r && r.kind === 'REJECT' && r.decision && String(r.decision.symbol||'').toUpperCase() === String(sym).toUpperCase(); }catch(_){ return false; } });
          const riskWarnings: string[] = [];
          try{ if (cand && cand.risk && Array.isArray((cand.risk as any).reasons)) riskWarnings.push(...(cand.risk as any).reasons.map(String)); }catch(_){ }
          const supportingReasons: string[] = [];
          try{ if (diag && diag.signal) supportingReasons.push(String(diag.signal)); if (diag && diag.reason) supportingReasons.push(String(diag.reason)); if (cand && (cand as any).reason) supportingReasons.push(String((cand as any).reason)); }catch(_){ }
          const primaryReason = diag && diag.rejectionReason ? String(diag.rejectionReason) : (rejectsForSym.length ? (rejectsForSym[0].raw && rejectsForSym[0].raw.reason && rejectsForSym[0].raw.reason.code ? String(rejectsForSym[0].raw.reason.code) : String(rejectsForSym[0].raw.reason && rejectsForSym[0].raw.reason.message || 'REJECT')) : (cand && cand.action ? `Decision:${cand.action}` : null));
          const marketSessionReason = (diag && typeof diag.marketOpen === 'boolean') ? (diag.marketOpen ? 'MARKET_OPEN' : 'MARKET_CLOSED') : null;
          const rejectedByRiskEngine = !!(cand && cand.risk && cand.risk.allowed === false);
          const rejectedByMarketHours = !!(diag && diag.marketOpen === false);
          const rejectedByFreshness = !!(diag && (diag.quoteFound === false || diag.isStale));
          const rejectedByPositionLimits = rejectsForSym.some((r:any)=>{ try{ const code = r.raw && r.raw.reason && r.raw.reason.code ? String(r.raw.reason.code) : null; return code === 'POSITION_LIMIT' || code === 'INSUFFICIENT_CASH'; }catch(_){return false;} });
          const dr: any = { symbol: String(sym).toUpperCase(), action: cand && cand.action ? cand.action : (diag && diag.decision ? diag.decision : 'HOLD'), confidence: cand && typeof cand.confidence === 'number' ? cand.confidence : (diag && typeof diag.confidence === 'number' ? diag.confidence : null), primaryReason, supportingReasons: supportingReasons.length ? supportingReasons : null, riskWarnings: riskWarnings.length ? riskWarnings : null, marketSessionReason, rejectedByRiskEngine, rejectedByMarketHours, rejectedByFreshness, rejectedByPositionLimits };
            // Preserve candidate marketRegime observation when present (do not reclassify)
            try{ if (cand && (cand as any).marketRegime && typeof (cand as any).marketRegime === 'object'){ const mr = (cand as any).marketRegime; dr.marketRegime = { regime: mr.regime, confidence: mr.confidence, reasons: Array.isArray(mr.reasons) ? mr.reasons.slice() : (mr.reasons ? [String(mr.reasons)] : []), riskNote: mr.riskNote ?? null };
              try{ dr.marketContextAdvice = buildMarketContextAdvice({ marketRegime: dr.marketRegime, technicalScore: null, momentum: null, volatility: (mr && typeof mr.confidence === 'number') ? (mr.confidence >= 100 ? 1 : undefined) : undefined }); }catch(_){ }
              // best-effort: build historical context from available audits (observation-only)
              try{
                const allAuditsForHist = Array.isArray(allAudits) ? allAudits : [];
                const completed = allAuditsForHist.map((a:any)=> a && a.raw ? a.raw : a).filter(Boolean).map((r:any)=>{
                  // normalize potential evaluation/feedback records
                  if (r.kind === 'TRADE_FEEDBACK' && r.feedback){ return { symbol: r.feedback && r.feedback.symbol ? String(r.feedback.symbol).toUpperCase() : null, returnPercent: typeof r.feedback.pnlPercent === 'number' ? r.feedback.pnlPercent : (typeof r.feedback.returnPercent === 'number' ? r.feedback.returnPercent : null), marketRegime: r.feedback && r.feedback.marketRegime ? r.feedback.marketRegime : null, marketContextAdvice: r.feedback && r.feedback.marketContextAdvice ? r.feedback.marketContextAdvice : null } as any; }
                  if (r.kind === 'EVALUATION' && r.evaluation){ return { symbol: r.evaluation && r.evaluation.symbol ? String(r.evaluation.symbol).toUpperCase() : null, returnPercent: typeof r.evaluation.returnPercent === 'number' ? r.evaluation.returnPercent : null, marketRegime: r.evaluation && r.evaluation.marketRegime ? r.evaluation.marketRegime : null, marketContextAdvice: r.evaluation && r.evaluation.marketContextAdvice ? r.evaluation.marketContextAdvice : null } as any; }
                  return null;
                }).filter(Boolean);
                try{ dr.historicalContext = buildHistoricalContext({ marketRegime: dr.marketRegime, marketContextAdvice: dr.marketContextAdvice, completedTradeEvaluations: completed }); }catch(_){ }
                // Attach decision confidence explanation (observation-only)
                try{ const expl = buildDecisionConfidenceExplanation({ decisionReason: dr, marketRegime: dr.marketRegime, marketContextAdvice: dr.marketContextAdvice, historicalContext: dr.historicalContext, adaptiveDecisionContext }); if (expl) dr.decisionConfidenceExplanation = expl; }catch(_){ }
                try{ const ev = buildDecisionEvidence({ decisionReason: dr, marketRegime: dr.marketRegime, marketContextAdvice: dr.marketContextAdvice, historicalContext: dr.historicalContext, adaptiveDecisionContext, decisionConfidenceExplanation: dr.decisionConfidenceExplanation }); if (ev) dr.decisionEvidence = ev; }catch(_){ }
                try{ const ec = analyzeEvidenceConsistency({ decisionEvidence: dr.decisionEvidence }); if (ec) dr.evidenceConsistency = ec; }catch(_){ }
                try{ const sid = buildEvidenceInformedDecision({ currentAction: dr.action, currentConfidence: dr.confidence, decisionEvidence: dr.decisionEvidence, evidenceConsistency: dr.evidenceConsistency }); if (sid) dr.evidenceInformedDecision = sid; }catch(_){ }
              }catch(_){ }
            } }catch(_){ }
          decisionReasons.push(dr);
        }
      }catch(_){ }

      // Build TradeFeedback objects now that decisionReasons exist
      try{
        for (const ex of executedTrades){
          try{
            const tradeId = ex.id || (`exec_${Date.now()}`);
            const symbol = String(ex.symbol || '').toUpperCase();
            const reasonsForSymbol = (decisionReasons || []).filter((d:any)=> String(d.symbol||'').toUpperCase() === symbol);
            const candidate = (candidates || []).find((c:any)=> String(c.symbol||'').toUpperCase() === symbol) || null;
            const confidenceAtExecution = candidate && typeof candidate.confidence === 'number' ? candidate.confidence : (reasonsForSymbol[0] && typeof reasonsForSymbol[0].confidence === 'number' ? reasonsForSymbol[0].confidence : null);
            const expectedDirection = candidate && candidate.action ? candidate.action : null;
            const executedAt = ex.generatedAt || nowIso();
            const evaluationDueAt = new Date(new Date(executedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
            const tf = { cycleId, tradeId, symbol, action: ex.side || (candidate && candidate.action) || 'UNKNOWN', confidenceAtExecution, expectedDirection, executedPrice: ex.executedPrice ?? null, executedAt, evaluationStatus: 'PENDING', evaluationDueAt, decisionReasons: reasonsForSymbol.length ? reasonsForSymbol : null } as any;
            try{ await cycleAuditStore.append({ kind: 'TRADE_FEEDBACK', id: `trade_feedback_${tradeId}`, timestamp: nowIso(), feedback: tf, meta: { automatic: true } } as any); }catch(_){ }
          }catch(_){ }
        }
      }catch(_){ }

      // Compute marketRegime distribution and dominant regime deterministically
      let marketRegimeDistribution: Record<string, number> | null = null;
      let dominantMarketRegime: string | null = null;
      try{
        const dist: Record<string, number> = {};
        for (const d of decisionReasons){
          try{
            const mr = d && d.marketRegime && d.marketRegime.regime ? String(d.marketRegime.regime) : null;
            if (mr){ dist[mr] = (dist[mr] || 0) + 1; }
          }catch(_){ }
        }
        if (Object.keys(dist).length) marketRegimeDistribution = dist;
        if (marketRegimeDistribution){
          // priority tie-break list
          const priority = ['HIGH_VOLATILITY','UNCERTAIN','STRONG_DOWNTREND','WEAK_DOWNTREND','RANGE_BOUND','WEAK_UPTREND','STRONG_UPTREND'];
          // find regime with highest count; on ties, use priority
          let bestCount = -1; let best: string | null = null;
          for (const k of Object.keys(marketRegimeDistribution)){
            const c = marketRegimeDistribution[k] || 0;
            if (c > bestCount){ bestCount = c; best = k; }
            else if (c === bestCount && best !== null){
              // tie-break by priority order
              const curPriority = priority.indexOf(k) >= 0 ? priority.indexOf(k) : priority.length;
              const bestPriority = priority.indexOf(best) >= 0 ? priority.indexOf(best) : priority.length;
              if (curPriority < bestPriority) best = k;
            }
          }
          dominantMarketRegime = best;
        }
      }catch(_){ marketRegimeDistribution = null; dominantMarketRegime = null; }

      // Build shadow decision summary based on existing evidenceInformedDecision (observation-only)
      let shadowDecisionSummary: any = null;
      try{
        const evaluated = Array.isArray(decisionReasons) ? decisionReasons.filter((d:any)=> d && d.evidenceInformedDecision && d.evidenceInformedDecision.recommendedAction) : [];
        const evaluatedCount = evaluated.length;
        let agreementCount = 0;
        const recommendedActionDistribution: { BUY:number; SELL:number; HOLD:number } = { BUY:0, SELL:0, HOLD:0 };
        const disagreementByTransition: Record<string, number> = {};
        for (const d of evaluated){
          try{
            const actual = String(d.action || 'HOLD');
            const rec = String((d.evidenceInformedDecision && d.evidenceInformedDecision.recommendedAction) || 'HOLD');
            if (actual === rec) agreementCount++;
            else {
              const key = `${actual}->${rec}`;
              disagreementByTransition[key] = (disagreementByTransition[key] || 0) + 1;
            }
            if (rec === 'BUY' || rec === 'SELL' || rec === 'HOLD') recommendedActionDistribution[rec as keyof typeof recommendedActionDistribution]++;
          }catch(_){ }
        }
        const disagreementCount = evaluatedCount - agreementCount;
        const agreementRate = evaluatedCount === 0 ? 0 : Math.round((agreementCount / evaluatedCount) * 100);
        shadowDecisionSummary = { evaluatedCount, agreementCount, disagreementCount, agreementRate, recommendedActionDistribution, disagreementByTransition: Object.keys(disagreementByTransition).length ? disagreementByTransition : {} };
      }catch(_){ shadowDecisionSummary = null; }

      const summary = { cycleId, timestamp: nowIso(), analyzedSymbols, eligibleSymbols, skippedSymbols, decisions: decisionsForSummary, executedTrades, rejectedTradesCount, confidenceAverage, topReason, riskBlocks: Object.keys(riskBlocks).length ? riskBlocks : null, overallConclusion, marketSession, cycleDurationMs: Date.now() - cycleStartMs, skippedReasonsBySymbol: Object.keys(skippedReasonsBySymbol).length ? skippedReasonsBySymbol : null, confidenceDistribution: Object.keys(confidenceDistribution).length ? confidenceDistribution : null, strongestBullishReason, strongestBearishReason, cashBefore, cashAfter, portfolioValueBefore, portfolioValueAfter, decisionReasons: decisionReasons.length ? decisionReasons : null, marketRegimeDistribution, dominantMarketRegime, shadowDecisionSummary, shadowPerformanceSummary: shadowPerformanceSummaryLocal } as any;
      try{ await cycleAuditStore.append({ kind: 'DECISION_SUMMARY', id: `decision_summary_${cycleId}`, timestamp: nowIso(), summary, meta: { automatic: true } } as any); }catch(_){ }

      // expose on runtime for quick observation
      try{ runtime.latestCycle = { ...runtime.latestCycle, decisionSummary: summary }; }catch(_){ }

      // Build Victor Review and Adaptive Decision Context for the completed cycle
      try{
        // Extract cycle-scoped entries again (best-effort)
        const all = Array.isArray(await auditStore.list()) ? await auditStore.list() : [];
        const cycleEntries2 = (all || []).filter((a:any)=>{ try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; } });
        const tradeFeedbacks = cycleEntries2.map((a:any)=> (a && a.raw && a.raw.kind === 'TRADE_FEEDBACK') ? (a.raw.feedback || a.feedback || a.raw) : null).filter(Boolean);
        const outcomeEvaluations = cycleEntries2.map((a:any)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
        // previously computed shadowPerformanceSummary is included on `summary` during creation
        // learningSignals are not persisted by default; attempt to find any if tests push them
        const learningSignals = cycleEntries2.map((a:any)=> (a && a.raw && a.raw.kind === 'LEARNING_SIGNAL') ? (a.raw.signal || a.signal || a.raw) : null).filter(Boolean);

        // Build victor review using available objects and the earlier `profile` captured at cycle start
        const victorReview = buildVictorReview(summary, tradeFeedbacks, outcomeEvaluations, learningSignals, profile);
        // Append victor review as an audit entry (compact)
        try{ await cycleAuditStore.append({ kind: 'DECISION_SUMMARY', id: `victor_review_${cycleId}`, timestamp: nowIso(), victorReview, meta: { automatic: true } } as any); }catch(_){ }

        // Build adaptive decision context deterministically and keep it as per-cycle local
        adaptiveDecisionContext = buildAdaptiveDecisionContext(profile, victorReview);
        try{ await cycleAuditStore.append({ kind: 'ADAPTIVE_DECISION_CONTEXT', id: `adaptive_context_${cycleId}`, timestamp: nowIso(), context: adaptiveDecisionContext, meta: { automatic: true } } as any); }catch(_){ }

        // Attach to runtime.latestCycle for quick observation (do not rely on runtime for policy)
        try{ runtime.latestCycle = { ...runtime.latestCycle, adaptiveDecisionContext: adaptiveDecisionContext, victorReview }; }catch(_){ }
        try{
          const snapshot = buildCycleIntelligenceSnapshot(summary, victorReview, adaptiveDecisionContext);
          try{ attachMarketNewsSummary(snapshot); }catch(_){ }
          try{
            const auditObj: any = { kind: 'CYCLE_INTELLIGENCE_SNAPSHOT', id: `cycle_intel_${cycleId}`, timestamp: nowIso(), snapshot, meta: { automatic: true } };
              try{ attachMarketNewsAuditFields(auditObj, snapshot); }catch(_){ }
              await cycleAuditStore.append(auditObj as any);
          }catch(_){ }
          try{ runtime.latestCycle = { ...runtime.latestCycle, cycleIntelligenceSnapshot: snapshot }; }catch(_){ }
        }catch(_){ }
      }catch(_){ /* tolerate failures */ }

    }catch(_){ /* tolerate summary build failures */ }
    try{ await cycleAuditStore.append(diagnosticsAudit); }catch(_){ }
    // expose on runtime for quick observation
    try{ runtime.latestCycle = { ...runtime.latestCycle, diagnosticsSummary: { analyzed, eligible, executed: executedCount, blockers: blockerCounts } }; }catch(_){ }
    // Ensure AdaptiveDecisionContext is built/attached even if the summary build failed earlier
    try{
      const existing = adaptiveDecisionContext ? true : false;
      if (!existing){
        // attempt to gather cycle entries
        try{
          const all2 = Array.isArray(await auditStore.list()) ? await auditStore.list() : [];
          const cycleEntries3 = (all2 || []).filter((a:any)=>{ try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; } });
          const tradeFeedbacks2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'TRADE_FEEDBACK') ? (a.raw.feedback || a.feedback || a.raw) : null).filter(Boolean);
          const outcomeEvaluations2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
          const learningSignals2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'LEARNING_SIGNAL') ? (a.raw.signal || a.signal || a.raw) : null).filter(Boolean);
          const decisionSummary = runtime && (runtime as any).latestCycle && (runtime as any).latestCycle.decisionSummary ? (runtime as any).latestCycle.decisionSummary : null;
          const victorReview2 = buildVictorReview(decisionSummary, tradeFeedbacks2, outcomeEvaluations2, learningSignals2, profile);
          const adaptiveContext2 = buildAdaptiveDecisionContext(profile, victorReview2);
          // set local per-cycle variable
          adaptiveDecisionContext = adaptiveContext2;
          try{ await cycleAuditStore.append({ kind: 'ADAPTIVE_DECISION_CONTEXT', id: `adaptive_context_${cycleId}`, timestamp: nowIso(), context: adaptiveContext2, meta: { automatic: true } } as any); }catch(_){ }
          try{ runtime.latestCycle = { ...runtime.latestCycle, adaptiveDecisionContext: adaptiveContext2, victorReview: victorReview2 }; }catch(_){ }
          try{
            const snapshot2 = buildCycleIntelligenceSnapshot(decisionSummary, victorReview2, adaptiveContext2);
            try{ attachMarketNewsSummary(snapshot2); }catch(_){ }
            try{
              const auditObj: any = { kind: 'CYCLE_INTELLIGENCE_SNAPSHOT', id: `cycle_intel_${cycleId}`, timestamp: nowIso(), snapshot: snapshot2, meta: { automatic: true } };
                try{ attachMarketNewsAuditFields(auditObj, snapshot2); }catch(_){ }
                await cycleAuditStore.append(auditObj as any);
            }catch(_){ }
            try{ runtime.latestCycle = { ...runtime.latestCycle, cycleIntelligenceSnapshot: snapshot2 }; }catch(_){ }
          }catch(_){ }
        }catch(_){ /* ignore */ }
      }
    }catch(_){ }
  }catch(_){ }
  // finalize latestForexCycleStatus based on results
  try{
    const res = runtime.latestCycle || {};
    const executedCount = (res && typeof res.executed === 'number') ? res.executed : 0;
    let status: any = 'ANALYZED';
    if (executedCount > 0) status = 'EXECUTED';
    if (res && (res.skipped === true)) status = 'SKIPPED';
    runtime.latestForexCycleStatus = Object.assign({}, runtime.latestForexCycleStatus || {}, { cycleId, status, executionMode: (runtime.latestForexCycleStatus && runtime.latestForexCycleStatus.executionMode) ? runtime.latestForexCycleStatus.executionMode : 'DIAGNOSTIC_ONLY', completedAt: new Date().toISOString(), analyzedPairCount: (runtime.latestForexCycleStatus && runtime.latestForexCycleStatus.analyzedPairCount) ? runtime.latestForexCycleStatus.analyzedPairCount : 0, executionCandidateCount: (runtime.latestForexCycleStatus && runtime.latestForexCycleStatus.executionCandidateCount) ? runtime.latestForexCycleStatus.executionCandidateCount : 0, executedTradeCount: executedCount, blockingReasons: (runtime.latestForexCycleStatus && Array.isArray(runtime.latestForexCycleStatus.blockingReasons) ? runtime.latestForexCycleStatus.blockingReasons : []) });
  }catch(_){ }
  // update scheduler last/next when manual (automatic) cycle finishes
  return { ...runtime.latestCycle, evaluationCount };
}

// Helper to ensure every EVALUATION audit includes a technicalAnalysis meta object.
export async function appendEvaluation(entry: any, store?: import('./types').AuditStore, opts?: { evaluateShadowOutcome?: boolean }){
  try{
    entry.meta = entry.meta || {};
    if (!Object.prototype.hasOwnProperty.call(entry.meta, 'technicalAnalysis')){
      entry.meta.technicalAnalysis = { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: 'MISSING_TECHNICAL', technicalAnalysisErrorMessage: null };
    }
    // Derive a short human-readable technical summary from existing technicalAnalysis
    try{
      const ta = entry.meta.technicalAnalysis || {};
      // initialize technicalSummary only if not present to avoid overwriting any explicit test data
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'technicalSummary')){
        if (ta.technicalAnalysisStatus === 'success'){
          const trend = ta.technicalTrend || null;
          const signal = ta.technicalSignal || null;
          const score = typeof ta.technicalScore === 'number' ? ta.technicalScore : (typeof ta.technicalScore === 'string' ? Number(ta.technicalScore) : null);
          const reason = Array.isArray(ta.technicalReasons) && ta.technicalReasons.length ? String(ta.technicalReasons[0]) : (ta.technicalAnalysisErrorMessage || null);
          const textParts = [] as string[];
          if (trend) textParts.push(`Trend: ${trend}`);
          if (signal) textParts.push(`Signal: ${signal}`);
          if (score !== null && score !== undefined) textParts.push(`Score: ${score}`);
          if (reason) textParts.push(`Reason: ${reason}`);
          entry.meta.technicalSummary = { trend, signal, score, reason, text: textParts.join(' • ') };
        } else {
          entry.meta.technicalSummary = { text: 'Technical analysis unavailable' };
        }
      }
    }catch(_){ /* swallow summary generation errors */ }
    // Derive a compact list of short reasons from the existing technicalAnalysis
    try{
      const ta = entry.meta.technicalAnalysis || {};
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'technicalReasons')){
        if (ta.technicalAnalysisStatus === 'success'){
          const trend = ta.technicalTrend || null;
          const momentum = (typeof ta.technicalMomentumPercent === 'number' && Number.isFinite(ta.technicalMomentumPercent)) ? Math.round(ta.technicalMomentumPercent) : null;
          const volatility = (typeof ta.technicalVolatilityPercent === 'number' && Number.isFinite(ta.technicalVolatilityPercent)) ? Math.round(ta.technicalVolatilityPercent) : null;
          const score = (typeof ta.technicalScore === 'number' && Number.isFinite(ta.technicalScore)) ? Math.round(ta.technicalScore) : null;
          const important = Array.isArray(ta.technicalReasons) && ta.technicalReasons.length ? String(ta.technicalReasons[0]) : (ta.technicalAnalysisErrorMessage || null);
          const rows: string[] = [];
          // Combine trend and score on the first row
          if (trend && typeof score === 'number') rows.push(`Trend: ${trend} • Score: ${score}`);
          else if (trend) rows.push(`Trend: ${trend}`);
          else if (typeof score === 'number') rows.push(`Score: ${score}`);
          // add momentum, volatility, and important reason as subsequent rows
          if (typeof momentum === 'number') rows.push(`Momentum: ${momentum}%`);
          if (typeof volatility === 'number') rows.push(`Volatility: ${volatility}%`);
          if (important) rows.push(`Reason: ${important}`);
          // ensure max 4 rows
          entry.meta.technicalReasons = rows.slice(0, 4);
          if (!entry.meta.technicalReasons || !entry.meta.technicalReasons.length) entry.meta.technicalReasons = [`No technical reasons available`];
        } else {
          entry.meta.technicalReasons = ['Technical analysis unavailable'];
        }
      }
    }catch(_){ /* ignore */ }
    // Derive a short decision explanation based on available decision and technicalAnalysis
    try{
      // do not overwrite if present
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'decisionExplanation')){
        const decision = entry && entry.decision ? entry.decision : null;
        const actualAction = decision && decision.action ? String(decision.action) : null;
        const ta = entry.meta.technicalAnalysis || {};
        if (!ta || ta.technicalAnalysisStatus !== 'success'){
          entry.meta.decisionExplanation = 'Victor avvaktar eftersom teknisk analys saknas.';
        } else {
          const techSignal = ta.technicalSignal ? String(ta.technicalSignal) : null;
          // If technical signal differs from actual action, mention it
          if (techSignal && actualAction && techSignal.toUpperCase() !== actualAction.toUpperCase()){
            entry.meta.decisionExplanation = `Victor avvaktar. Den tekniska signalen är ${techSignal}, men strategins övriga villkor gav ${actualAction}.`;
          } else if (actualAction) {
            entry.meta.decisionExplanation = `Victor agerar: ${actualAction}.`;
          } else {
            entry.meta.decisionExplanation = `Victor avvaktar.`;
          }
        }
      }
    }catch(_){ /* ignore explanation errors */ }
    // Derive decisionContext metadata for evaluations
    try{
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'decisionContext')){
        const ta = entry.meta.technicalAnalysis || {};
        const status = ta.technicalAnalysisStatus || 'unavailable';
        let technicalConfidence: number | null = null;
        if (status === 'success' && ta && typeof ta.technicalScore !== 'undefined' && ta.technicalScore !== null){
          const parsed = Number(ta.technicalScore);
          if (Number.isFinite(parsed)) technicalConfidence = Math.round(parsed);
          else technicalConfidence = null;
        } else {
          technicalConfidence = null;
        }
        const techSignal = ta.technicalSignal ? String(ta.technicalSignal) : null;
        const actualAction = entry && entry.decision && entry.decision.action ? String(entry.decision.action) : null;
        const signalsConflict = techSignal && actualAction ? (techSignal.toUpperCase() !== actualAction.toUpperCase()) : false;
        let recommendationStrength: 'LOW'|'MEDIUM'|'HIGH' = 'LOW';
        if (technicalConfidence === null){ recommendationStrength = 'LOW'; }
        else if (technicalConfidence >= 75) { recommendationStrength = 'HIGH'; }
        else if (technicalConfidence >= 50) { recommendationStrength = 'MEDIUM'; }
        else { recommendationStrength = 'LOW'; }
        // compute overallDecisionConfidence per rules: start with technicalConfidence (or 0 if unavailable),
        // reduce by 20 if signalsConflict, clamp 0..100, round to int
        let overallDecisionConfidence: number = 0;
        if (status === 'success' && typeof technicalConfidence === 'number'){
          overallDecisionConfidence = Math.round(Math.max(0, Math.min(100, technicalConfidence - (signalsConflict ? 20 : 0))));
        } else {
          overallDecisionConfidence = 0;
        }

        entry.meta.decisionContext = {
          technicalConfidence,
          technicalStatus: status,
          signalsConflict,
          recommendationStrength,
          overallDecisionConfidence,
        };
        // executiveSummary: one-sentence summary built from existing fields
        try{
          let executiveSummary = 'Technical analysis unavailable.';
          if (status === 'success'){
            if (signalsConflict){
              if (recommendationStrength === 'HIGH') executiveSummary = 'Strong technical setup, but conflicting signals reduce confidence.';
              else if (recommendationStrength === 'MEDIUM') executiveSummary = 'Technical outlook is positive, but conflicting signals reduce confidence.';
              else executiveSummary = 'Technical outlook is weak and conflicting signals reduce confidence.';
            } else {
              if (recommendationStrength === 'HIGH') executiveSummary = 'Strong technical setup with no conflicting signals.';
              else if (recommendationStrength === 'MEDIUM') executiveSummary = 'Technical outlook is positive with moderate confidence.';
              else executiveSummary = 'Technical outlook is weak.';
            }
          }
          entry.meta.decisionContext.executiveSummary = executiveSummary;
        }catch(_){ /* ignore executiveSummary errors */ }
      }
    }catch(_){ /* ignore */ }

    // Add combinedAnalysis using available technicalAnalysis and optional fundamentalAnalysis
    try{
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'combinedAnalysis')){
        const tech = entry.meta.technicalAnalysis ? entry.meta.technicalAnalysis : null;
        const fund = entry.meta.fundamentalAnalysis ? entry.meta.fundamentalAnalysis : null;
        try{
          const techEngine = tech ? { status: tech.technicalAnalysisStatus || tech.status, score: typeof tech.technicalScore === 'number' ? tech.technicalScore : (typeof tech.technicalScore === 'string' ? Number(tech.technicalScore) : undefined), signal: tech.technicalSignal || tech.signal, reasons: Array.isArray(tech.technicalReasons) ? tech.technicalReasons : undefined } : null;
          const fundEngine = fund ? { status: fund.status || fund.technicalAnalysisStatus, score: typeof fund.score === 'number' ? fund.score : (typeof fund.score === 'string' ? Number(fund.score) : undefined), signal: fund.signal || fund.technicalSignal, reasons: Array.isArray(fund.reasons) ? fund.reasons : undefined } : null;
          const combined = combineAnalyses({ technical: techEngine as any, fundamental: fundEngine as any });
          entry.meta.combinedAnalysis = combined;
        }catch(_){ /* swallow errors from aggregator */ }
      }
    }catch(_){ /* ignore combined analysis errors */ }

    // Ensure evaluationSource meta is present and reflects which analyses were used
    try{
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'evaluationSource')){
        const technicalUsed = !!entry.meta.technicalAnalysis;
        const fundamentalUsed = !!entry.meta.fundamentalAnalysis;
        const aggregatorUsed = !!entry.meta.combinedAnalysis;
        let agreement: 'HIGH'|'MEDIUM'|'LOW' = 'HIGH';
        let conflictingSignals = false;
        try{
          const ca = entry.meta.combinedAnalysis;
          if (ca && typeof ca.agreement === 'string') agreement = ca.agreement;
          if (ca && typeof ca.conflictingSignals === 'boolean') conflictingSignals = Boolean(ca.conflictingSignals);
        }catch(_){ }
        entry.meta.evaluationSource = { technicalUsed, fundamentalUsed, aggregatorUsed, agreement, conflictingSignals };
      }
    }catch(_){ /* ignore */ }

    // Compute decisionComparison here (in evaluation flow) so storage layer remains passive.
    try{
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'decisionComparison')){
        const dec = entry && entry.decision ? entry.decision : null;
        const strategyAction = dec && dec.action ? String(dec.action).toUpperCase() : 'HOLD';
        const aggSignal = entry.meta.combinedAnalysis && typeof entry.meta.combinedAnalysis.overallSignal === 'string' ? String(entry.meta.combinedAnalysis.overallSignal).toUpperCase() : 'HOLD';
        const aggregatorSignal = aggSignal || 'HOLD';
        const matches = strategyAction === aggregatorSignal;
        // Do NOT modify entry.decision.action
        entry.meta.decisionComparison = { strategyAction, aggregatorSignal, matches };
      }
    }catch(_){ }

    // Compute alignmentStats for EVALUATION audits by inspecting previous EVALUATION entries
    try{
      if (entry && entry.kind === 'EVALUATION'){
        try{
          const prev = await auditStore.list();
          const symbol = entry && entry.decision && entry.decision.symbol ? String(entry.decision.symbol).toUpperCase() : null;
          const prevEvals = Array.isArray(prev) ? prev.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION' && a.raw.decision && symbol ? String(a.raw.decision.symbol).toUpperCase() === symbol : true) : [];
          // Count only previous evaluations that have a decisionComparison
          let prevComparisons = 0;
          let prevMatches = 0;
          for (const p of prevEvals){
            try{
              const dc = p && p.raw && p.raw.meta && p.raw.meta.decisionComparison;
              if (dc){ prevComparisons++; if (dc.matches) prevMatches++; }
            }catch(_){ }
          }
          const thisDc = entry.meta && entry.meta.decisionComparison ? entry.meta.decisionComparison : null;
          const thisMatch = thisDc && !!thisDc.matches ? 1 : 0;
          const totalComparisons = prevComparisons + (thisDc ? 1 : 0);
          const matchingComparisons = prevMatches + thisMatch;
          const matchRate = Math.round((totalComparisons > 0 ? (matchingComparisons / totalComparisons) * 100 : 0));
          entry.meta.alignmentStats = { totalComparisons, matchingComparisons, matchRate };
        }catch(_){ /* ignore alignment compute errors */ }
      }
    }catch(_){ }

  }catch(_){ /* ignore normalization errors */ }
  // Attach shadowDecisionOutcome when possible (observation-only)
  try{
    // default: evaluate shadow outcome unless explicitly opted out
    const shouldEvaluateShadow = !(opts && opts.evaluateShadowOutcome === false);
    if (shouldEvaluateShadow){
      if (entry && entry.kind === 'EVALUATION'){
        try{
          const sym = entry.decision && entry.decision.symbol ? String(entry.decision.symbol).toUpperCase() : (entry.execution && entry.execution.symbol ? String(entry.execution.symbol).toUpperCase() : null);
          let originalAction: string | null = null;
          let originalRefPrice: number | null = null;
          let storedShadowAction: string | null = null;
          try{
            const prev = Array.isArray(await (store || auditStore).list()) ? await (store || auditStore).list() : [];
            for (const p of prev){
              try{
                const raw = p && p.raw ? p.raw : p;
                if (!raw) continue;
                if (raw.kind === 'DECISION_SUMMARY'){
                  const summ = raw.summary || raw.decisionSummary || raw;
                  if (summ && Array.isArray(summ.decisions)){
                    const found = summ.decisions.find((d:any)=> d && (String(d.symbol||'').toUpperCase() === sym));
                    if (found){ originalAction = String(found.action || '').toUpperCase() || originalAction; if (typeof found.referencePrice === 'number') originalRefPrice = Number(found.referencePrice); }
                  }
                  if (summ && Array.isArray(summ.decisionReasons)){
                    const dr = summ.decisionReasons.find((d:any)=> d && (String(d.symbol||'').toUpperCase() === sym));
                    if (dr && dr.evidenceInformedDecision && dr.evidenceInformedDecision.recommendedAction) storedShadowAction = String(dr.evidenceInformedDecision.recommendedAction).toUpperCase();
                  }
                }
                if (raw.kind === 'TRADE_FEEDBACK'){
                  const fb = raw.feedback || raw;
                  if (fb && Array.isArray(fb.decisionReasons)){
                    const dr = fb.decisionReasons.find((d:any)=> d && (String(d.symbol||'').toUpperCase() === sym));
                    if (dr && dr.evidenceInformedDecision && dr.evidenceInformedDecision.recommendedAction) storedShadowAction = storedShadowAction || String(dr.evidenceInformedDecision.recommendedAction).toUpperCase();
                  }
                }
              }catch(_){ }
            }
          }catch(_){ }

          let refPrice: number | null = null;
          let evalPrice: number | null = null;
          try{ if (originalRefPrice !== null) refPrice = originalRefPrice; }catch(_){ }
          try{ if (entry.decision && typeof entry.decision.referencePrice === 'number') refPrice = entry.decision.referencePrice; }catch(_){ }
          try{ if (entry.execution && typeof entry.execution.executedPrice === 'number') evalPrice = entry.execution.executedPrice; }catch(_){ }
          try{ if (entry.evaluation && typeof entry.evaluation.exitPrice === 'number') evalPrice = evalPrice || entry.evaluation.exitPrice; }catch(_){ }

          const actualAct = originalAction || (entry.decision && entry.decision.action ? String(entry.decision.action).toUpperCase() : null);
          const shadowAct = storedShadowAction || null;
          const out = evaluateShadowDecisionOutcome({ actualAction: actualAct || 'HOLD', shadowAction: shadowAct || 'HOLD', referencePrice: refPrice ?? undefined, evaluationPrice: evalPrice ?? undefined, neutralThresholdPercent: 5 });
          entry.evaluation = entry.evaluation || {};
          entry.evaluation.shadowDecisionOutcome = out;
        }catch(_){ }
      }
    }
  }catch(_){ }
  return (store || auditStore).append(entry);
}

export async function setPaperTradingEnabled(enabled: boolean){
  runtime.enabled = enabled;
  runtime.trader = createPaperTrader({ portfolioAdapter, auditStore, config: { ...config, enabled } });
  runtime.lastUpdated = nowIso();
}

export async function executePaperTradeDecision(decision: PaperTradeDecision){
  runtime.latestDecision = decision;
  // capture before snapshot
  const beforeExecutionPortfolio = await portfolioAdapter.getPortfolio();
  const res = await runtime.trader.handleDecision(decision as any);
  // If executed and SELL that closes a position, compute and attach evaluation and update audit
  try{
    if (res && res.accepted){
      const exec: SimulatedExecution | null = (res.execution || res.transaction) || null;
      if (exec && String((exec as any).side || decision.action).toUpperCase() === 'SELL'){
        const afterExecutionPortfolio = await portfolioAdapter.getPortfolio();
        const sym = String(decision.symbol || '').toUpperCase();
        const stillHolding = Array.isArray(afterExecutionPortfolio.holdings) && afterExecutionPortfolio.holdings.find((h:any)=> String(h.symbol||'').toUpperCase() === sym);
        if (!stillHolding){
          const beforeHolding = Array.isArray(beforeExecutionPortfolio.holdings) ? beforeExecutionPortfolio.holdings.find((h:any)=> String(h.symbol||'').toUpperCase() === sym) : null;
          const entryPrice = beforeHolding && typeof beforeHolding.averagePrice === 'number' ? Number(beforeHolding.averagePrice) : null;
          const exitPrice = typeof (exec as any).executedPrice === 'number' ? Number((exec as any).executedPrice) : null;
          const qty = typeof (exec as any).quantity === 'number' ? Number((exec as any).quantity) : null;
          if (entryPrice !== null && exitPrice !== null && qty !== null){
            // Prefer an existing evaluation object on the execution if it looks valid; otherwise compute a fallback
            let evaluation: any = null;
            try{
              const existing = (exec as any).evaluation;
              if (existing && typeof existing.pnlSek === 'number' && typeof existing.pnlPercent === 'number' && (existing.winner === true || existing.winner === false)){
                evaluation = existing;
              }
            }catch(_){ /* ignore */ }
            if (!evaluation){
              evaluation = evaluateTrade({ entryPrice, exitPrice, quantity: qty, totalFees: exec.fee ?? 0 });
              try{ (exec as any).evaluation = evaluation; }catch(_){ }
            }
            // Attempt to resolve a single-entry BUY for a safe TradeReview
            try{
              const audits = await auditStore.list();
              let portfolioId = '';
              if (beforeExecutionPortfolio && typeof beforeExecutionPortfolio === 'object' && beforeExecutionPortfolio !== null){
                const asRec = beforeExecutionPortfolio as Record<string, unknown>;
                const idVal = asRec['id'];
                if (typeof idVal === 'string') portfolioId = idVal;
              }
              const entry = resolveSingleEntryForReview({ audits, portfolioId, symbol: sym, soldQuantity: qty });
              if (entry){
                const exitTs = nowIso();
                const holdingMinutes = Math.max(0, Math.floor((new Date(exitTs).getTime() - new Date(entry.entryTimestamp).getTime()) / 60000));
                const review = buildTradeReview({
                  executionId: entry.executionId,
                  symbol: sym,
                  entryPrice: entry.entryPrice,
                  exitPrice: exitPrice,
                  quantity: qty,
                  totalFees: exec.fee ?? 0,
                  holdingMinutes,
                  confidenceAtEntry: entry.confidenceAtEntry,
                  createdAt: exitTs,
                });
                try{ if (evaluation && typeof evaluation === 'object') (evaluation as Record<string, unknown>).tradeReview = review; }catch(_){ }
              }
            }catch(_){ /* tolerate resolver failures silently */ }
            try{
              const entries = (auditStore as any).entries as any[] | undefined;
              if (Array.isArray(entries)){
                for (let i = entries.length - 1; i >= 0; i--){
                  const it = entries[i];
                  if (it && it.raw && it.raw.kind === 'EXECUTION' && it.raw.execution && it.raw.execution.id === exec.id){
                    try{ (it.raw.execution as any).evaluation = evaluation; }catch(_){ }
                    break;
                  }
                }
              }
            }catch(_){ }
            try{ await auditStore.append({ kind: 'EVALUATION', decision, execution: exec, evaluation, portfolioBefore: beforeExecutionPortfolio, portfolioAfter: afterExecutionPortfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
          }
        }
      }
    }
  }catch(_){ }

  // update lightweight runtime state for observability
  runtime.latestCycle = res && (res as any).accepted ? { processedCandidates: 1, executed: 1, rejects: 0 } : { processedCandidates: 1, executed: 0, rejects: 1 } as any;
  runtime.latestDecision = decision;
  runtime.lastUpdated = nowIso();
  return { result: res, state: await getPaperTradingState() };
}

export { startAutonomousScheduler, stopAutonomousScheduler };

// Evaluate outcome for a single TradeFeedback using provided current market price.
// This function is explicit and does not fetch market data.
export function evaluateTradeOutcome(feedback:any, currentPrice?: number){
  const now = nowIso();
  try{
    const tradeId = feedback && feedback.tradeId ? String(feedback.tradeId) : (feedback && feedback.id ? String(feedback.id) : `unknown_${Date.now()}`);
    const executedPrice = (feedback && typeof feedback.executedPrice === 'number') ? Number(feedback.executedPrice) : null;
    const cp = (typeof currentPrice === 'number' && Number.isFinite(currentPrice)) ? Number(currentPrice) : null;
    let priceChangePercent: number | null = null;
    let absolutePnL: number | null = null;
    if (executedPrice !== null && cp !== null && executedPrice !== 0){
      priceChangePercent = ((cp - executedPrice) / executedPrice) * 100;
      priceChangePercent = Math.round(priceChangePercent * 100) / 100;
      // absolute PnL cannot be accurately computed without quantity; best-effort: use notional if present
      const notional = feedback && typeof feedback.notional === 'number' ? Number(feedback.notional) : null;
      const quantity = feedback && typeof feedback.quantity === 'number' ? Number(feedback.quantity) : null;
      if (quantity !== null) absolutePnL = Math.round(((cp - executedPrice) * quantity) * 100) / 100;
      else if (notional !== null && executedPrice !== 0) absolutePnL = Math.round(((cp - executedPrice) * (notional / executedPrice)) * 100) / 100;
      else absolutePnL = null;
    }

    const expectedDirection = feedback && feedback.expectedDirection ? String(feedback.expectedDirection).toUpperCase() : null;
    let expectedDirectionCorrect = false;
    if (priceChangePercent !== null && expectedDirection){
      if (expectedDirection === 'BUY') expectedDirectionCorrect = priceChangePercent > 0;
      else if (expectedDirection === 'SELL') expectedDirectionCorrect = priceChangePercent < 0;
      else expectedDirectionCorrect = false;
    }

    const confidence = feedback && typeof feedback.confidenceAtExecution === 'number' ? Number(feedback.confidenceAtExecution) : null;
    // Heuristic: confidenceAccurate when confidence >=50 and expectedDirectionCorrect true
    const confidenceAccurate = (confidence !== null && expectedDirectionCorrect) ? (confidence >= 50) : false;

    let evaluationResult: 'WIN'|'LOSS'|'NEUTRAL' = 'NEUTRAL';
    if (priceChangePercent === null){ evaluationResult = 'NEUTRAL'; }
    else if (expectedDirectionCorrect) evaluationResult = 'WIN';
    else evaluationResult = 'LOSS';

    const outcomeReason = priceChangePercent === null ? 'Insufficient price data' : (evaluationResult === 'WIN' ? 'Price moved in expected direction' : 'Price moved opposite to expectation');

    const out = { tradeId, evaluatedAt: now, currentPrice: cp, priceChangePercent, absolutePnL, expectedDirectionCorrect, confidenceAccurate, evaluationResult, outcomeReason } as any;
    return out as import('./types').OutcomeEvaluation;
  }catch(e){
    return { tradeId: (feedback && feedback.tradeId) ? String(feedback.tradeId) : `err_${Date.now()}`, evaluatedAt: now, currentPrice: null, priceChangePercent: null, absolutePnL: null, expectedDirectionCorrect: false, confidenceAccurate: false, evaluationResult: 'NEUTRAL', outcomeReason: String((e as any) && (e as any).message ? (e as any).message : e) } as any;
  }
}

// Generate a deterministic learning signal from an OutcomeEvaluation and its TradeFeedback.
export function generateLearningSignal(outcome:any, feedback:any){
  const now = nowIso();
  try{
    const tradeId = outcome && outcome.tradeId ? String(outcome.tradeId) : (feedback && feedback.tradeId ? String(feedback.tradeId) : `unknown_${Date.now()}`);
    const symbol = feedback && feedback.symbol ? String(feedback.symbol).toUpperCase() : (feedback && feedback.tradeId ? null : null);
    const evalResult = outcome && outcome.evaluationResult ? String(outcome.evaluationResult) : 'NEUTRAL';
    const confidence = feedback && typeof feedback.confidenceAtExecution === 'number' ? Number(feedback.confidenceAtExecution) : (feedback && typeof feedback.confidence === 'number' ? Number(feedback.confidence) : null);
    const confidenceAccurate = !!(outcome && typeof outcome.confidenceAccurate === 'boolean' ? outcome.confidenceAccurate : false);
    const expectedCorrect = !!(outcome && typeof outcome.expectedDirectionCorrect === 'boolean' ? outcome.expectedDirectionCorrect : false);

    // Determine lesson category deterministically using only supplied objects
    let lesson: any = 'NEUTRAL';
    let suggestedConfidenceAdjustment: number | null = null;
    let suggestedRiskAdjustment: number | null = null;

    // Confidence-based rules
    if (confidence !== null && typeof confidence === 'number'){
      if (evalResult === 'LOSS' && confidence >= 70){
        lesson = 'CONFIDENCE_TOO_HIGH';
        suggestedConfidenceAdjustment = -10; // suggest reduce 10 percentage points
      } else if (evalResult === 'WIN' && confidence < 50){
        lesson = 'CONFIDENCE_TOO_LOW';
        suggestedConfidenceAdjustment = +10; // suggest increase 10 percentage points
      }
    }

    // Risk-based rules from decisionReasons present in feedback
    try{
      const drs = Array.isArray(feedback && feedback.decisionReasons ? feedback.decisionReasons : feedback && feedback.decisionReasons ? feedback.decisionReasons : []) ? (feedback.decisionReasons || []) : [];
      const riskWarnings = drs.reduce((acc:any, d:any)=> acc.concat(Array.isArray(d.riskWarnings) ? d.riskWarnings : []), [] as string[]);
      if (riskWarnings.length){
        // If there were risk warnings and outcome was LOSS -> risk too aggressive
        if (evalResult === 'LOSS'){
          lesson = 'RISK_TOO_AGGRESSIVE';
          suggestedRiskAdjustment = -0.1; // suggest reduce risk tolerance by 10%
        } else if (evalResult === 'WIN'){
          // maybe risk was too conservative if wins and low confidence
          if (confidence !== null && confidence < 50){ lesson = 'RISK_TOO_CONSERVATIVE'; suggestedRiskAdjustment = +0.05; }
        }
      }
    }catch(_){ }

    // If none of the above changed and evaluation was correct, mark CORRECT_DECISION
    if (lesson === 'NEUTRAL' && evalResult === 'WIN' && expectedCorrect) lesson = 'CORRECT_DECISION';

    // Compose summary
    const summaryParts: string[] = [];
    summaryParts.push(`Result: ${evalResult}`);
    if (confidence !== null) summaryParts.push(`Confidence: ${confidence}`);
    if (typeof suggestedConfidenceAdjustment === 'number') summaryParts.push(`SuggestConfidenceAdj: ${suggestedConfidenceAdjustment}`);
    if (typeof suggestedRiskAdjustment === 'number') summaryParts.push(`SuggestRiskAdj: ${suggestedRiskAdjustment}`);
    const summary = summaryParts.join(' | ');

    const signal = {
      tradeId,
      symbol,
      generatedAt: now,
      evaluationResult: evalResult,
      confidenceAtExecution: confidence !== undefined ? confidence : null,
      confidenceAccurate: confidenceAccurate,
      expectedDirectionCorrect: expectedCorrect,
      lessonCategory: lesson,
      suggestedConfidenceAdjustment: suggestedConfidenceAdjustment,
      suggestedRiskAdjustment: suggestedRiskAdjustment,
      summary
    } as any;
    return signal as import('./types').LearningSignal;
  }catch(e){
    return { tradeId: (feedback && feedback.tradeId) ? String(feedback.tradeId) : `err_${Date.now()}`, generatedAt: now, evaluationResult: 'NEUTRAL', confidenceAtExecution: null, confidenceAccurate: false, expectedDirectionCorrect: false, lessonCategory: 'NEUTRAL', suggestedConfidenceAdjustment: null, suggestedRiskAdjustment: null, summary: String((e as any) && (e as any).message ? (e as any).message : e) } as any;
  }
}

// Pure deterministic aggregator: build a performance profile from an array of LearningSignal
export function buildPerformanceProfile(learningSignals: LearningSignal[]){
  const signals = Array.isArray(learningSignals) ? learningSignals : [];
  const totalTrades = signals.length;
  let wins = 0, losses = 0, neutral = 0;
  let confidenceSum = 0; let confidenceCount = 0;
  let confidenceAccurateCount = 0; let confidenceAccurateDenom = 0;
  const lessonBreakdown: Record<string, number> = {};
  let suggestedConfidenceSum = 0; let suggestedConfidenceCount = 0;
  let suggestedRiskSum = 0; let suggestedRiskCount = 0;

  for (const s of signals){
    const res = s && s.evaluationResult ? String(s.evaluationResult) : 'NEUTRAL';
    if (res === 'WIN') wins++;
    else if (res === 'LOSS') losses++;
    else neutral++;

    if (s && typeof s.confidenceAtExecution === 'number' && !Number.isNaN(s.confidenceAtExecution)){
      confidenceSum += s.confidenceAtExecution;
      confidenceCount++;
    }
    if (s && typeof s.confidenceAccurate === 'boolean'){
      confidenceAccurateDenom++;
      if (s.confidenceAccurate) confidenceAccurateCount++;
    }

    const lesson = s && s.lessonCategory ? String(s.lessonCategory) : 'NEUTRAL';
    lessonBreakdown[lesson] = (lessonBreakdown[lesson] || 0) + 1;

    if (s && typeof s.suggestedConfidenceAdjustment === 'number' && !Number.isNaN(s.suggestedConfidenceAdjustment)){
      suggestedConfidenceSum += s.suggestedConfidenceAdjustment;
      suggestedConfidenceCount++;
    }
    if (s && typeof s.suggestedRiskAdjustment === 'number' && !Number.isNaN(s.suggestedRiskAdjustment)){
      suggestedRiskSum += s.suggestedRiskAdjustment;
      suggestedRiskCount++;
    }
  }

  const winRate = totalTrades === 0 ? 0 : (wins / totalTrades);
  const averageConfidence = confidenceCount === 0 ? 0 : (confidenceSum / confidenceCount);
  const confidenceAccuracy = confidenceAccurateDenom === 0 ? 0 : (confidenceAccurateCount / confidenceAccurateDenom);
  const recommendedConfidenceBias = suggestedConfidenceCount === 0 ? 0 : (suggestedConfidenceSum / suggestedConfidenceCount);
  const recommendedRiskBias = suggestedRiskCount === 0 ? 0 : (suggestedRiskSum / suggestedRiskCount);

  const summary = `trades=${totalTrades} wins=${wins} losses=${losses} neutral=${neutral} winRate=${(winRate*100).toFixed(1)}% avgConf=${averageConfidence.toFixed(1)}`;

  return {
    totalTrades,
    wins,
    losses,
    neutral,
    winRate,
    averageConfidence,
    confidenceAccuracy,
    lessonBreakdown,
    recommendedConfidenceBias,
    recommendedRiskBias,
    summary
  } as const;
}

// Pure deterministic Victor review pipeline
export function buildVictorReview(
  decisionSummary: import('./types').DecisionSummary | null,
  tradeFeedbacks: import('./types').TradeFeedback[] | null,
  outcomeEvaluations: import('./types').OutcomeEvaluation[] | null,
  learningSignals: import('./types').LearningSignal[] | null,
  performanceProfile: any
){
  const ds = decisionSummary || ({} as import('./types').DecisionSummary);
  const tfs = Array.isArray(tradeFeedbacks) ? tradeFeedbacks : [];
  const outs = Array.isArray(outcomeEvaluations) ? outcomeEvaluations : [];
  const ls = Array.isArray(learningSignals) ? learningSignals : [];
  const pf = performanceProfile || {};

  const cycleId = ds.cycleId || (tfs.length ? tfs[0].cycleId : null) || 'unknown';
  const generatedAt = ds.timestamp || (ls.length ? ls[0].generatedAt : (outs.length ? outs[0].evaluatedAt : null)) || null;

  const totalTrades = pf && typeof pf.totalTrades === 'number' ? pf.totalTrades : ls.length || tfs.length || 0;
  const winRate = pf && typeof pf.winRate === 'number' ? pf.winRate : (totalTrades === 0 ? 0 : (ls.filter(s => s.evaluationResult === 'WIN').length / totalTrades));
  const avgConf = pf && typeof pf.averageConfidence === 'number' ? pf.averageConfidence : (ls.reduce((s:any,x:any)=> s + (typeof x.confidenceAtExecution === 'number' ? x.confidenceAtExecution : 0), 0) / (ls.filter((x:any)=> typeof x.confidenceAtExecution === 'number').length || 1));
  const confAcc = pf && typeof pf.confidenceAccuracy === 'number' ? pf.confidenceAccuracy : (ls.filter((x:any)=> x.confidenceAccurate).length / (ls.length || 1));

  const executiveSummary = `Cycle ${cycleId}: ${totalTrades} trades, winRate=${(winRate*100).toFixed(1)}%, avgConf=${(Number.isFinite(avgConf) ? avgConf.toFixed(1) : 'N/A')}`;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestedFocusAreas: string[] = [];

  if (winRate >= 0.6) strengths.push('High win rate');
  if (confAcc >= 0.6) strengths.push('Confidence predictions are generally accurate');
  if ((pf && pf.recommendedRiskBias) === 0 || (pf && pf.recommendedRiskBias === undefined)) strengths.push('Stable risk recommendations');

  if (winRate < 0.4) weaknesses.push('Low win rate');
  if (confAcc < 0.5) weaknesses.push('Low confidence accuracy');
  if (pf && typeof pf.recommendedConfidenceBias === 'number' && Math.abs(pf.recommendedConfidenceBias) > 5) weaknesses.push('Large suggested confidence adjustments');

  if (weaknesses.includes('Low win rate')) suggestedFocusAreas.push('Investigate decision quality and signal sources');
  if (weaknesses.includes('Low confidence accuracy')) suggestedFocusAreas.push('Calibrate confidence scoring and model calibration');
  if (weaknesses.includes('Large suggested confidence adjustments')) suggestedFocusAreas.push('Adjust confidence bias incrementally and monitor');

  // Inspect learning signals for common lesson categories
  const lessonCounts: Record<string, number> = {};
  for (const l of ls){ const cat = l && l.lessonCategory ? String(l.lessonCategory) : 'NEUTRAL'; lessonCounts[cat] = (lessonCounts[cat]||0)+1; }
  if (lessonCounts['CONFIDENCE_TOO_HIGH']) suggestedFocusAreas.push('Reduce overconfidence on flagged trades');
  if (lessonCounts['CONFIDENCE_TOO_LOW']) suggestedFocusAreas.push('Increase conviction or review signal strength');
  if (lessonCounts['RISK_TOO_AGGRESSIVE']) suggestedFocusAreas.push('Tighten risk controls for flagged cases');

  // Confidence and risk recommendations
  const confidenceRecommendation = (pf && typeof pf.recommendedConfidenceBias === 'number') ? pf.recommendedConfidenceBias : (ls.reduce((s:any,x:any)=> s + (typeof x.suggestedConfidenceAdjustment === 'number' ? x.suggestedConfidenceAdjustment : 0),0) / (ls.filter((x:any)=> typeof x.suggestedConfidenceAdjustment === 'number').length || 1));
  const riskRecommendation = (pf && typeof pf.recommendedRiskBias === 'number') ? pf.recommendedRiskBias : (ls.reduce((s:any,x:any)=> s + (typeof x.suggestedRiskAdjustment === 'number' ? x.suggestedRiskAdjustment : 0),0) / (ls.filter((x:any)=> typeof x.suggestedRiskAdjustment === 'number').length || 1));

  // Readiness score: combine winRate (60%), confidenceAccuracy (30%), add small base (10%), adjust for riskRecommendation
  const base = 10;
  let riskPenalty = 0;
  if (typeof riskRecommendation === 'number'){
    if (riskRecommendation < -0.05) riskPenalty = 10; // large negative risk suggest reduces readiness
    else if (riskRecommendation > 0.05) riskPenalty = -5; // positive risk tolerance improvement
  }
  let readiness = Math.round(winRate * 60 + confAcc * 30 + base - riskPenalty);
  readiness = Math.max(0, Math.min(100, readiness));

  // Next improvement: deterministic suggestion
  let nextImprovement = 'Maintain current approach';
  if (readiness < 40) nextImprovement = 'Immediate review: recalibrate signals and tighten risk controls';
  else if (readiness < 70) nextImprovement = 'Focus on confidence calibration and targeted risk tuning';
  else nextImprovement = 'Incremental optimization: fine-tune confidence bias and monitor';

  return {
    cycleId,
    generatedAt,
    executiveSummary,
    strengths,
    weaknesses,
    suggestedFocusAreas,
    confidenceRecommendation,
    riskRecommendation,
    readinessScore: readiness,
    nextImprovement
  } as const;
}

// Pure deterministic Adaptive Decision Context builder
export function buildAdaptiveDecisionContext(performanceProfile: any, victorReview: any){
  const pf = performanceProfile || {};
  const vr = victorReview || {};

  const confidenceRecommendation = typeof vr.confidenceRecommendation === 'number' ? vr.confidenceRecommendation : (typeof pf.recommendedConfidenceBias === 'number' ? pf.recommendedConfidenceBias : 0);
  const riskRecommendation = typeof vr.riskRecommendation === 'number' ? vr.riskRecommendation : (typeof pf.recommendedRiskBias === 'number' ? pf.recommendedRiskBias : 0);

  const lessonBreakdown = pf.lessonBreakdown && typeof pf.lessonBreakdown === 'object' ? pf.lessonBreakdown as Record<string, number> : (pf.lessonBreakdown || {});
  const preferredLessonCategories: string[] = [];
  const avoidLessonCategories: string[] = [];
  for (const k of Object.keys(lessonBreakdown)){
    const count = Number(lessonBreakdown[k] || 0);
    if (count <= 0) continue;
    if (k === 'CORRECT_DECISION') preferredLessonCategories.push(k);
    if (k === 'CONFIDENCE_TOO_HIGH' || k === 'CONFIDENCE_TOO_LOW' || k === 'RISK_TOO_AGGRESSIVE' || k === 'RISK_TOO_CONSERVATIVE') avoidLessonCategories.push(k);
  }

  const currentStrengths = Array.isArray(vr.strengths) ? vr.strengths.slice() : [];
  const currentWeaknesses = Array.isArray(vr.weaknesses) ? vr.weaknesses.slice() : [];
  const focusAreas = Array.isArray(vr.suggestedFocusAreas) ? vr.suggestedFocusAreas.slice() : [];

  const reviewSummary = typeof vr.executiveSummary === 'string' ? vr.executiveSummary : (pf && pf.summary ? String(pf.summary) : 'No summary available');

  const generatedAt = vr.generatedAt || (pf && pf.generatedAt) || 'unknown';

  // Determine simple biases based on inputs (pure deterministic)
  let confidenceBias = 0;
  if (typeof confidenceRecommendation === 'number') confidenceBias = confidenceRecommendation;
  else if (pf && typeof pf.winRate === 'number'){
    if (pf.winRate > 0.6) confidenceBias = 2; else if (pf.winRate < 0.4) confidenceBias = -5; else confidenceBias = 0;
  }

  let riskBias = 0;
  if (typeof riskRecommendation === 'number') riskBias = riskRecommendation;
  else if (vr && typeof vr.readinessScore === 'number'){
    if (vr.readinessScore > 70) riskBias = 0.02; else if (vr.readinessScore < 40) riskBias = -0.05; else riskBias = 0;
  }

  return {
    confidenceBias,
    riskBias,
    preferredLessonCategories,
    avoidLessonCategories,
    currentStrengths,
    currentWeaknesses,
    focusAreas,
    reviewSummary,
    generatedAt
  } as const;
}

// Pure deterministic Cycle Intelligence Snapshot builder
export function buildCycleIntelligenceSnapshot(decisionSummary: import('./types').DecisionSummary | null, victorReview: any, adaptiveDecisionContext: any){
  const ds = decisionSummary || ({} as import('./types').DecisionSummary);
  const vr = victorReview || {};
  const ac = adaptiveDecisionContext || {};

  const cycleId = ds.cycleId || (vr && vr.cycleId) || 'unknown';
  const generatedAt = (vr && vr.generatedAt) || (ds && ds.timestamp) || (ac && ac.generatedAt) || null;

  const readinessScore = typeof vr.readinessScore === 'number' ? vr.readinessScore : (typeof ac.readinessScore === 'number' ? ac.readinessScore : (typeof vr.readiness === 'number' ? vr.readiness : 0));

  const headline = readinessScore >= 70 ? 'Cycle performing well' : (readinessScore < 40 ? 'Immediate review recommended' : 'Mixed signals — targeted improvements');

  const confidenceState = vr && typeof vr.confidenceRecommendation === 'number' ? `Bias ${vr.confidenceRecommendation}` : (ac && typeof ac.confidenceBias === 'number' ? `Bias ${ac.confidenceBias}` : 'Neutral');
  const riskState = ac && typeof ac.riskBias === 'number' ? (ac.riskBias > 0 ? `Risk tolerant (+${ac.riskBias})` : (ac.riskBias < 0 ? `Risk conservative (${ac.riskBias})` : 'Risk neutral')) : 'Risk unknown';
  const marketState = ds && ds.marketSession && typeof ds.marketSession.marketOpen === 'boolean' ? (ds.marketSession.marketOpen ? 'Market open' : 'Market closed') : 'Market state unknown';

  const strongestInsight = (vr && Array.isArray(vr.strengths) && vr.strengths.length) ? vr.strengths[0] : ((ac && Array.isArray(ac.preferredLessonCategories) && ac.preferredLessonCategories.length) ? ac.preferredLessonCategories[0] : 'No clear insight');
  const biggestWeakness = (vr && Array.isArray(vr.weaknesses) && vr.weaknesses.length) ? vr.weaknesses[0] : ((ac && Array.isArray(ac.currentWeaknesses) && ac.currentWeaknesses.length) ? ac.currentWeaknesses[0] : 'No major weakness');
  const nextPriority = (vr && vr.nextImprovement) ? vr.nextImprovement : ((vr && Array.isArray(vr.suggestedFocusAreas) && vr.suggestedFocusAreas.length) ? vr.suggestedFocusAreas[0] : ((ac && Array.isArray(ac.focusAreas) && ac.focusAreas.length) ? ac.focusAreas[0] : 'Monitor and iterate'));

  return {
    cycleId,
    generatedAt,
    headline,
    confidenceState,
    riskState,
    marketState,
    strongestInsight,
    biggestWeakness,
    nextPriority,
    readinessScore
  } as const;
}

// Apply adaptive confidence policy: deterministic, clamps to 0-100, max adjustment +/-10
export function applyAdaptiveConfidencePolicy(originalConfidence: number, adaptiveDecisionContext: any){
  // Validate originalConfidence
  let orig = typeof originalConfidence === 'number' && !Number.isNaN(originalConfidence) ? originalConfidence : 0;
  // Extract bias from adaptiveDecisionContext
  const bias = (adaptiveDecisionContext && typeof adaptiveDecisionContext.confidenceBias === 'number') ? Number(adaptiveDecisionContext.confidenceBias) : 0;
  // Limit bias to +/-10 per requirement
  const limitedBias = Math.max(-10, Math.min(10, bias));
  // Apply bias (additive percentage points)
  let adjusted = orig + limitedBias;
  // Clamp to 0-100
  adjusted = Math.max(0, Math.min(100, adjusted));
  // Round to 2 decimal places for determinism
  adjusted = Math.round(adjusted * 100) / 100;
  return adjusted;
}

// Start autonomous scheduler lazily once on module initialization in non-test environments.
// Tests may control scheduler manually (NODE_ENV=test).
try{
  // Always ensure the global singleton references the current run implementation so hot-reload
  // can swap the callback without creating duplicate timers.
  try{ getGlobalScheduler().runTick = runAutomaticCycleImplementation; }catch(_){ }
  // Start in-memory scheduler only when explicitly enabled via env.
  // Default: do not start automatically unless running non-test and mode set to "in_memory".
  if (process.env.NODE_ENV !== 'test' && process.env.PAPER_TRADER_SCHEDULER_MODE === 'in_memory'){
    startAutonomousScheduler();
  }
}catch(e){}

export default { getPaperTradingState, runManualPaperTradingCycle, setPaperTradingEnabled, getPerformanceSummary, getPerformanceProfile };
export { buildMacroSignalsMock, SUPPORTED_MACRO_SIGNALS } from './macro-signals';
export type { MacroSignal } from './macro-signals';
