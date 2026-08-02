// Market Environment Intelligence — deterministic, pure builder and per-cycle resolver
export type RiskMode = 'NORMAL' | 'DEFENSIVE' | 'AGGRESSIVE' | 'UNKNOWN';
export type Backdrop = 'BULL' | 'BEAR' | 'NEUTRAL' | 'UNKNOWN';

export type SectorLeadership = {
  sector: string;
  symbols: readonly string[];
};

export type CrossAssetRisk = {
  volatilityScore: number | null; // 0..1
  rateScore: number | null; // 0..1
  dollarScore: number | null; // 0..1
  aggregateScore: number | null; // 0..1
};

export type MarketEnvironmentIntelligence = {
  schemaVersion: 1;
  source: 'VICTOR_MARKET_ENVIRONMENT_INTELLIGENCE';
  generatedAt: string;
  observedAt: string | null;
  expiresAt: string | null;
  isFresh: boolean;

  coverage: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  quality: number; // 0..1
  riskMode: RiskMode;

  equityBackdrop: Backdrop;
  volatilityBackdrop: Backdrop;
  ratePressure: number | null; // -1..1 (negative = disinflationary/bullish for equities)
  dollarPressure: number | null; // -1..1 (positive = strong dollar)

  defensiveDemand: number | null; // 0..1
  confidence: number; // 0..1 derived from data availability
  strength: number | null; // -1..1 aggregate directional strength vs benchmarks

  leadershipProxy: readonly string[];
  sectorLeadershipProxy: readonly SectorLeadership[];
  supportingSignals: readonly string[];
  conflictingSignals: readonly string[];
  summary?: string | null;
  missingCapabilities: readonly string[];
  warnings: readonly string[];

  crossAssetRisk: CrossAssetRisk;

  diagnostics: { checkedAt: string; inputCounts: { intraday: number; benchmarks: number; macroIndicators: number }; warnings: readonly string[] };
};

function toIso(d: Date){ return d.toISOString(); }
function isFiniteNum(v: any): v is number { return typeof v === 'number' && Number.isFinite(v); }
function clamp01(v: number){ return Math.max(0, Math.min(1, v)); }
function clampMinus1to1(v: number){ return Math.max(-1, Math.min(1, v)); }
function uniqLimit(arr: string[] | undefined, limit = 10){ if (!Array.isArray(arr)) return [] as string[]; const out: string[] = []; const seen = new Set<string>(); for (const s of arr){ const u = String(s || '').toUpperCase(); if (!u) continue; if (seen.has(u)) continue; seen.add(u); out.push(u); if (out.length >= limit) break; } return out; }

// Input shapes (loose) — existing modules produce these
export type BenchmarkContextLike = { symbol?: string; relativeStrengthPercent?: number | null; warnings?: readonly string[] } | null | undefined;
export type IntradayContextLike = { symbol?: string; coverage?: string; isFresh?: boolean; session?: { changePercent?: number | null } } | null | undefined;
export type MacroSnapshotLike = { vix?: number | null; dxy?: number | null; us10y?: number | null } | null | undefined;

export type BuildMarketEnvironmentInput = {
  now?: Date;
  observedAt?: string | null;
  intradayContexts?: (IntradayContextLike | null | undefined)[];
  benchmarkContexts?: (BenchmarkContextLike | null | undefined)[];
  macroSnapshot?: MacroSnapshotLike;
};

export function buildMarketEnvironmentIntelligence(input?: BuildMarketEnvironmentInput): MarketEnvironmentIntelligence {
  const now = input && input.now ? input.now : new Date();
  const generatedAt = toIso(now);
  const observedAt = input && typeof input.observedAt === 'string' ? input.observedAt : null;
  const intr = Array.isArray(input && input.intradayContexts) ? input!.intradayContexts! : [];
  const bench = Array.isArray(input && input.benchmarkContexts) ? input!.benchmarkContexts! : [];
  const macro = input && input.macroSnapshot ? input.macroSnapshot : null;

  // coverage & counts
  const intrCount = intr.length;
  const benchCount = bench.length;
  const macroCount = macro ? Object.keys(macro).filter(k=> (macro as any)[k] !== null && (macro as any)[k] !== undefined).length : 0;
  const coverage = (intrCount > 0 || benchCount > 0 || macroCount > 0) ? (intrCount > 0 && benchCount > 0 && macroCount > 0 ? 'COMPLETE' : 'PARTIAL') : 'UNAVAILABLE';

  // confidence: fraction of expected inputs present (we expect intraday+benchmarks+macro ideally)
  const expected = 3; const present = (intrCount > 0 ? 1 : 0) + (benchCount > 0 ? 1 : 0) + (macroCount > 0 ? 1 : 0);
  const confidence = clamp01(present / expected);

  // leadership: pick top relativeStrengthPercent from benchmarkContexts
  const leaders: string[] = [];
  try{
    const scored = bench.map((b,i)=> ({ sym: String((b && (b as any).symbol) || '').toUpperCase(), score: isFiniteNum((b && (b as any).relativeStrengthPercent) as any) ? (b as any).relativeStrengthPercent as number : -Infinity, idx: i }));
    scored.sort((a,b)=> b.score - a.score || a.sym.localeCompare(b.sym));
    for (const s of scored){ if (!s.sym) continue; if (!isFiniteNum(s.score) || s.score === -Infinity) continue; if (s.score <= 0) continue; leaders.push(s.sym); }
  }catch(e){ /* ignore */ }

  const leadershipProxy = uniqLimit(leaders, 10);

  // sector leadership: naive grouping by prefix (everything before dot or first 3 chars)
  const sectorMap = new Map<string, Set<string>>();
  for (const s of leadershipProxy){ const sector = s.split(/\.|\-/)[0].slice(0,3); if (!sectorMap.has(sector)) sectorMap.set(sector, new Set()); sectorMap.get(sector)!.add(s); }
  const sectorLeadershipProxy: SectorLeadership[] = Array.from(sectorMap.entries()).slice(0,6).map(([sec, syms])=> ({ sector: sec, symbols: Array.from(syms).slice(0,6) }));

  // volatility backdrop from VIX
  let volatilityBackdrop: Backdrop = 'UNKNOWN';
  let volatilityScore: number | null = null;
  if (macro && isFiniteNum((macro as any).vix)){
    const v = Number((macro as any).vix);
    volatilityScore = clamp01((v - 10) / 40); // normalize roughly 10..50 -> 0..1
    if (v >= 25) volatilityBackdrop = 'BEAR'; else if (v >= 15) volatilityBackdrop = 'NEUTRAL'; else volatilityBackdrop = 'BULL';
  }

  // rate pressure from US10Y: map yield to -1..1 (higher yield -> more pressure on equities)
  let ratePressure: number | null = null; if (macro && isFiniteNum((macro as any).us10y)){ const y = Number((macro as any).us10y); // typical range 0..8
    ratePressure = clampMinus1to1((y - 2.5) / 5); // center at 2.5 -> -0.5..+1
    ratePressure = Number(ratePressure.toFixed(4)); }

  // dollar pressure from DXY: map 80..120 -> -1..1
  let dollarPressure: number | null = null; if (macro && isFiniteNum((macro as any).dxy)){ const d = Number((macro as any).dxy); dollarPressure = clampMinus1to1((d - 100) / 20); dollarPressure = Number(dollarPressure.toFixed(4)); }

  // equity backdrop: use average sign of benchmark changePercent if available
  let equityBackdrop: Backdrop = 'UNKNOWN'; let strength: number | null = null;
  try{
    const changeVals: number[] = bench.map(b=> { const v = (b && (b as any).relativeStrengthPercent); return isFiniteNum(v) ? Number(v) : NaN; }).filter(isFiniteNum);
    if (changeVals.length > 0){ const avg = changeVals.reduce((s,n)=> s + n, 0)/changeVals.length; strength = clampMinus1to1(avg / 100); if (avg > 0.3) equityBackdrop = 'BULL'; else if (avg < -0.3) equityBackdrop = 'BEAR'; else equityBackdrop = 'NEUTRAL'; }
  }catch(e){ /* ignore */ }

  // defensive demand: higher when volatilityScore high or ratePressure high
  let defensiveDemand: number | null = null; try{ const parts: number[] = []; if (volatilityScore !== null) parts.push(clamp01(volatilityScore)); if (ratePressure !== null) parts.push(clamp01(Math.abs(ratePressure))); if (parts.length>0) defensiveDemand = Number((parts.reduce((s,n)=> s + n, 0)/parts.length).toFixed(4)); }catch(e){ defensiveDemand = null; }

  // riskMode: simple rules
  let riskMode: RiskMode = 'UNKNOWN';
  if (defensiveDemand !== null && defensiveDemand >= 0.6) riskMode = 'DEFENSIVE'; else if (defensiveDemand !== null && defensiveDemand <= 0.2) riskMode = 'AGGRESSIVE'; else riskMode = 'NORMAL';

  // cross-asset risk aggregate
  const cross: CrossAssetRisk = { volatilityScore: volatilityScore === null ? null : Number((volatilityScore).toFixed(4)), rateScore: ratePressure === null ? null : clamp01(Math.abs(ratePressure)), dollarScore: dollarPressure === null ? null : clamp01(Math.abs(dollarPressure)), aggregateScore: null };
  try{ const vals = [cross.volatilityScore, cross.rateScore, cross.dollarScore].filter(isFiniteNum) as number[]; cross.aggregateScore = vals.length ? Number((vals.reduce((s,n)=> s + n, 0)/vals.length).toFixed(4)) : null; }catch(e){ cross.aggregateScore = null; }

  // quality metric: based on presence of data and warnings
  let quality = Number(confidence.toFixed(4));
  if (bench.some(b=> (b && (b as any).warnings && Array.isArray((b as any).warnings) && (b as any).warnings.length > 0))) quality = Math.max(0, quality - 0.1);

  const warnings = [] as string[];
  if (coverage === 'UNAVAILABLE') warnings.push('MEI_INPUTS_UNAVAILABLE');

  const missingCapabilitiesArr = ['TRUE_ADVANCE_DECLINE_BREADTH'];
  const summaryText = `${equityBackdrop || 'UNKNOWN'} ${riskMode || 'UNKNOWN'}`;
  const out: MarketEnvironmentIntelligence = {
    schemaVersion: 1,
    source: 'VICTOR_MARKET_ENVIRONMENT_INTELLIGENCE',
    generatedAt,
    observedAt: observedAt || null,
    expiresAt: null,
    isFresh: true,
    coverage,
    quality,
    riskMode,
    equityBackdrop,
    volatilityBackdrop,
    ratePressure: ratePressure === null ? null : Number(ratePressure),
    dollarPressure: dollarPressure === null ? null : Number(dollarPressure),
    defensiveDemand: defensiveDemand === null ? null : Number(defensiveDemand),
    confidence: Number(confidence.toFixed(4)),
    strength: strength === null ? null : Number(Number(strength).toFixed(4)),
    leadershipProxy: leadershipProxy,
    sectorLeadershipProxy: sectorLeadershipProxy.map(s=> ({ sector: s.sector, symbols: uniqLimit((s.symbols as any), 6) })),
    crossAssetRisk: cross,
    supportingSignals: uniqLimit(leadershipProxy, 10),
    conflictingSignals: [],
    summary: summaryText,
    missingCapabilities: missingCapabilitiesArr,
    warnings: uniqLimit(warnings, 10),
    diagnostics: { checkedAt: generatedAt, inputCounts: { intraday: intrCount, benchmarks: benchCount, macroIndicators: macroCount }, warnings: uniqLimit(warnings, 10) }
  };

  return out;
}

export function sanitizeMarketEnvironmentIntelligenceForState(mei: MarketEnvironmentIntelligence){
  // Defensive JSON-safe copy; dedupe arrays and limit sizes
  const copy: MarketEnvironmentIntelligence = JSON.parse(JSON.stringify(mei));
  copy.leadershipProxy = uniqLimit(Array.isArray(copy.leadershipProxy) ? copy.leadershipProxy as any[] : [], 10);
  copy.sectorLeadershipProxy = Array.isArray(copy.sectorLeadershipProxy) ? (copy.sectorLeadershipProxy as SectorLeadership[]).slice(0,6).map(s=> ({ sector: String(s.sector || ''), symbols: uniqLimit(Array.isArray(s.symbols) ? s.symbols as any[] : [], 6) })) : [];
  copy.supportingSignals = uniqLimit(Array.isArray((copy as any).supportingSignals) ? (copy as any).supportingSignals as any[] : [], 10);
  copy.conflictingSignals = uniqLimit(Array.isArray((copy as any).conflictingSignals) ? (copy as any).conflictingSignals as any[] : [], 10);
  copy.missingCapabilities = uniqLimit(Array.isArray((copy as any).missingCapabilities) ? (copy as any).missingCapabilities as any[] : [], 10);
  copy.warnings = uniqLimit(Array.isArray((copy as any).warnings) ? (copy as any).warnings as any[] : [], 10);
  copy.diagnostics.warnings = uniqLimit(Array.isArray(copy.diagnostics.warnings) ? copy.diagnostics.warnings as any[] : [], 10);
  if (typeof (copy as any).summary === 'string') (copy as any).summary = String(((copy as any).summary || '').toString()).slice(0, 200);
  return copy;
}

export function createPerCycleMarketEnvironmentResolver(opts?: {
  getIntradayContext?: (symbol: string) => Promise<IntradayContextLike | null>;
  getBenchmarkContext?: (symbol: string) => Promise<BenchmarkContextLike | null>;
  getMacroContext?: () => Promise<MacroSnapshotLike | null> | MacroSnapshotLike | null;
  appendAudit?: (payload: any)=>Promise<void>;
  updateState?: (snap: MarketEnvironmentIntelligence)=>void;
  cycleId?: string;
}){
  const intradayCache = new Map<string, Promise<IntradayContextLike | null>>();
  const benchmarkCache = new Map<string, Promise<BenchmarkContextLike | null>>();
  let macroCache: Promise<MacroSnapshotLike | null> | null = null;

  const buildPromiseByCycle = { p: null as Promise<MarketEnvironmentIntelligence> | null };

  const getIntraday = async (sym: string) => {
    const s = String(sym || '').toUpperCase(); if (!s) return null;
    if (!intradayCache.has(s)){
      const fn = opts && typeof opts.getIntradayContext === 'function' ? opts!.getIntradayContext : async ()=> null;
      intradayCache.set(s, Promise.resolve().then(()=> fn(s)).catch(()=> null));
    }
    return intradayCache.get(s) as Promise<IntradayContextLike | null>;
  };

  const getBenchmark = async (sym: string) => {
    const s = String(sym || '').toUpperCase(); if (!s) return null;
    if (!benchmarkCache.has(s)){
      const fn = opts && typeof opts.getBenchmarkContext === 'function' ? opts!.getBenchmarkContext : async ()=> null;
      benchmarkCache.set(s, Promise.resolve().then(()=> fn(s)).catch(()=> null));
    }
    return benchmarkCache.get(s) as Promise<BenchmarkContextLike | null>;
  };

  const getMacro = async () => {
    if (!macroCache){
      const fn = opts && typeof opts.getMacroContext === 'function' ? opts!.getMacroContext : async ()=> null;
      try{ const res = fn(); macroCache = Promise.resolve(res).catch(()=> null); }catch(e){ macroCache = Promise.resolve(null); }
    }
    return macroCache as Promise<MacroSnapshotLike | null>;
  };

  async function buildOnce(): Promise<MarketEnvironmentIntelligence>{
    if (buildPromiseByCycle.p) return buildPromiseByCycle.p;
    const p = (async ()=>{
      try{
        // Fetch macro snapshot first (may be lightweight)
        const macro = await getMacro().catch(()=> null);

        // Request benchmark contexts for SPY/QQQ/IWM at most once each
        const benchSymbols = ['SPY','QQQ','IWM'];
        const benchPromises = benchSymbols.map(s => getBenchmark(s));
        const benchResults = await Promise.all(benchPromises).catch(()=> []);

        // Also fetch intraday contexts for the same benchmarks when available
        const intrPromises = benchSymbols.map(s => getIntraday(s));
        const intrResults = await Promise.all(intrPromises).catch(()=> []);

        // Build MEI using available benchmark contexts and macro snapshot
        const built = buildMarketEnvironmentIntelligence({ now: new Date(), observedAt: new Date().toISOString(), intradayContexts: intrResults as any, benchmarkContexts: benchResults as any, macroSnapshot: macro as any });

        // Best-effort append audit if requested (only allowed summary fields)
        try{ if (opts && typeof opts.appendAudit === 'function'){ const audit = { kind: 'MARKET_ENVIRONMENT_INTELLIGENCE_SNAPSHOT', cycleId: opts.cycleId ? opts.cycleId : null, generatedAt: built.generatedAt, observedAt: built.observedAt, coverage: built.coverage, quality: built.quality, riskMode: built.riskMode, equityBackdrop: built.equityBackdrop, volatilityBackdrop: built.volatilityBackdrop, ratePressure: built.ratePressure, dollarPressure: built.dollarPressure, defensiveDemand: built.defensiveDemand, confidence: built.confidence, strength: built.strength, supportingSignals: Array.isArray(built.leadershipProxy) ? built.leadershipProxy.slice(0,10) : [], conflictingSignals: [], missingCapabilities: ['TRUE_ADVANCE_DECLINE_BREADTH'], warnings: Array.isArray(built.diagnostics.warnings) ? built.diagnostics.warnings.slice(0,10) : [] }; await opts.appendAudit(audit).catch(()=>{}); } }catch(_){ }

        // update optional runtime state
        try{ if (opts && typeof opts.updateState === 'function') opts.updateState(built); }catch(_){ }

        return built;
      }catch(e){
        // Return a LIMITED/UNAVAILABLE fallback rather than throwing
        const fallback = buildMarketEnvironmentIntelligence({ now: new Date(), observedAt: null, intradayContexts: [], benchmarkContexts: [], macroSnapshot: null });
        return fallback;
      }
    })();
    buildPromiseByCycle.p = p;
    return p;
  }

  return {
    buildOnce,
    getIntradayContext: getIntraday,
    getBenchmarkContext: getBenchmark,
    getMacroSnapshot: getMacro,
    updateState: (payload: { intraday?: Record<string, IntradayContextLike | null>; benchmarks?: Record<string, BenchmarkContextLike | null>; macroSnapshot?: MacroSnapshotLike | null })=>{
      try{ if (payload && payload.intraday){ for (const k of Object.keys(payload.intraday)) intradayCache.set(String(k).toUpperCase(), Promise.resolve(payload.intraday[k])); } }catch(_){ }
      try{ if (payload && payload.benchmarks){ for (const k of Object.keys(payload.benchmarks)) benchmarkCache.set(String(k).toUpperCase(), Promise.resolve(payload.benchmarks[k])); } }catch(_){ }
      try{ if (payload && payload.macroSnapshot){ macroCache = Promise.resolve(payload.macroSnapshot); } }catch(_){ }
    },
    appendAudit: async (a:any)=>{ try{ if (opts && typeof opts.appendAudit === 'function') await opts.appendAudit(a); }catch(_){ } }
  } as const;
}

export default { buildMarketEnvironmentIntelligence, sanitizeMarketEnvironmentIntelligenceForState, createPerCycleMarketEnvironmentResolver };
