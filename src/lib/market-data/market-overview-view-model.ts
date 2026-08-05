import { TRADABLE_INSTRUMENTS } from './instruments';

export type MarketInstrumentRow = {
  instrumentId: string;
  symbol: string;
  providerSymbol?: string | null;
  name?: string | null;
  assetType?: string | null;
  currency?: string | null;
  sector?: string | null;
  enabled: boolean;
  marketDataEnabled: boolean;
  price: number | null;
  changePercent: number | null;
  marketTimestamp: string | null;
  fetchedAt: string | null;
  dataStatus: string;
  isStale: boolean;
  analyzedInLatestCycle: boolean;
  hasDecisionIntelligence: boolean;
  victorAction?: string | null;
  confidence?: number | null;
  usableSignalCount: number;
  latestAnalysisAt: string | null;
  blockingReason?: string | null;
  hasMTTI?: boolean;
};

export type MarketOverviewSnapshot = {
  instruments?: any[];
  latestQuoteSnapshotBySymbol?: Record<string, any>;
  latestDecisionIntelligenceBySymbol?: Record<string, any>;
  latestSignalBuildDiagnosticsBySymbol?: Record<string, any>;
  latestMultiTimeframeTechnicalIntelligenceBySymbol?: Record<string, any>;
  latestCycle?: { decisionSummary?: { analyzedSymbols?: string[] } } | null;
  latestAutonomousRuntimeReadiness?: any;
  forexLaunchControl?: any;
  latestAutomaticQuotesError?: any;
  snapshotGeneratedAt?: string | null;
};

function normalizeSym(s: string | undefined | null){ return s ? String(s).toUpperCase() : ''; }

function normalizeKeyForms(sym?: string | null){
  if (!sym) return [] as string[];
  const up = String(sym).toUpperCase();
  const compact = up.replace(/[^A-Z0-9]/g, '');
  const withSlash = (() => {
    // if compact is 6 letters like EURUSD -> EUR/USD
    if (/^[A-Z]{6}$/.test(compact)) return `${compact.slice(0,3)}/${compact.slice(3,6)}`;
    // if contains underscore -> replace with /
    if (up.indexOf('_') >= 0) return up.replace('_','/');
    return up;
  })();
  const withUnderscore = up.indexOf('/')>=0 ? up.replace('/','_') : (compact.length===6 ? `${compact.slice(0,3)}_${compact.slice(3,6)}` : up);
  return Array.from(new Set([up, compact, withSlash, withUnderscore]));
}

export function buildMarketOverviewViewModel(snapshot: MarketOverviewSnapshot){
  const quotes = snapshot.latestQuoteSnapshotBySymbol || {};
  const di = snapshot.latestDecisionIntelligenceBySymbol || {};
  const sig = snapshot.latestSignalBuildDiagnosticsBySymbol || {};
  const mtti = snapshot.latestMultiTimeframeTechnicalIntelligenceBySymbol || {};
  // support canonical nested path first, fallback to legacy array
  const analyzedList = Array.isArray((snapshot as any).latestCycle?.decisionSummary?.analyzedSymbols) ? (snapshot as any).latestCycle.decisionSummary.analyzedSymbols.map((s:any)=>String(s).toUpperCase()) : (Array.isArray((snapshot as any).latestCycleAnalyzedSymbols) ? (snapshot as any).latestCycleAnalyzedSymbols.map((s:any)=>String(s).toUpperCase()) : []);
  const blockingReason = (snapshot.forexLaunchControl && snapshot.forexLaunchControl.blockingReason) ? String(snapshot.forexLaunchControl.blockingReason) : null;

  const seen = new Set<string>();
  const rows: MarketInstrumentRow[] = TRADABLE_INSTRUMENTS.map(inst => {
    const id = String(inst.id);
    if (seen.has(id)) return null as any;
    seen.add(id);
    const prov = inst.providerSymbol || inst.id;
    const lookupKeys = normalizeKeyForms(prov);
    // include id as variant
    lookupKeys.push(String(inst.id).toUpperCase());
    let q: any = null; let diEntry: any = null; let sigEntry: any = null; let mttiEntry: any = null;
    for (const k of lookupKeys){
      if (!q && (quotes as any)[k]) q = (quotes as any)[k];
      if (!diEntry && (di as any)[k]) diEntry = (di as any)[k];
      if (!sigEntry && (sig as any)[k]) sigEntry = (sig as any)[k];
      if (!mttiEntry && (mtti as any)[k]) mttiEntry = (mtti as any)[k];
      if (q && diEntry && sigEntry) break;
    }

    const price = q && (typeof q.price === 'number' ? q.price : (q.price ? Number(q.price) : null)) || null;
    const changePercent = q && (q.changePercent ?? q.change_percent) !== undefined ? (Number(q.changePercent ?? q.change_percent) || 0) : null;
    const marketTimestamp = q && (q.marketTimestamp || q.timestamp) ? (q.marketTimestamp || q.timestamp) : null;
    const fetchedAt = q && (q.fetchedAt || q.fetched_at) ? (q.fetchedAt || q.fetched_at) : null;
    const dataStatus = (q && (q.dataStatus || q.status)) ? String(q.dataStatus || q.status).toUpperCase() : 'UNAVAILABLE';
    const isStale = Boolean(q && (q.isStale || q.is_stale));
    const providerSym = normalizeSym(inst.providerSymbol || inst.id);
    const analyzedInLatestCycle = analyzedList.indexOf(providerSym) !== -1 || analyzedList.indexOf((inst.id || '').toString().toUpperCase()) !== -1;
    const hasDecisionIntelligence = !!diEntry;
    const victorAction = diEntry && diEntry.action ? String(diEntry.action).toUpperCase() : null;
    const confidence = diEntry && (diEntry.confidence === null || typeof diEntry.confidence === 'undefined') ? null : (diEntry && typeof diEntry.confidence === 'number' ? diEntry.confidence : (diEntry && diEntry.confidence ? Number(diEntry.confidence) : null));
    const usableSignalCount = sigEntry && (Array.isArray(sigEntry.signals) ? sigEntry.signals.length : (typeof sigEntry.usableSignalCount === 'number' ? sigEntry.usableSignalCount : 0)) || 0;
    const latestAnalysisAt = diEntry && (diEntry.generatedAt || diEntry.analyzedAt || diEntry.updatedAt) ? (diEntry.generatedAt || diEntry.analyzedAt || diEntry.updatedAt) : null;

    return {
      instrumentId: id,
      symbol: providerSym || String(inst.id).toUpperCase(),
      providerSymbol: inst.providerSymbol || null,
      name: inst.name || null,
      assetType: inst.assetType || null,
      currency: inst.currency || null,
      sector: (inst as any).sector || null,
      enabled: Boolean(inst.enabled),
      marketDataEnabled: Boolean(inst.marketDataEnabled || inst.marketDataEnabled === undefined ? !!inst.marketDataEnabled : !!inst.marketDataEnabled),
      price: price,
      changePercent: changePercent,
      marketTimestamp: marketTimestamp || null,
      fetchedAt: fetchedAt || null,
      dataStatus: dataStatus,
      isStale: isStale,
      analyzedInLatestCycle: Boolean(analyzedInLatestCycle),
      hasDecisionIntelligence: Boolean(hasDecisionIntelligence),
      hasMTTI: Boolean(mttiEntry),
      victorAction: victorAction,
      confidence: (typeof confidence === 'number' ? confidence : null),
      usableSignalCount: usableSignalCount,
      latestAnalysisAt: latestAnalysisAt || null,
      blockingReason: blockingReason,
    } as MarketInstrumentRow;
  }).filter(Boolean) as MarketInstrumentRow[];

  // deterministic sort by instrumentId then symbol
  rows.sort((a,b) => {
    if (a.instrumentId < b.instrumentId) return -1;
    if (a.instrumentId > b.instrumentId) return 1;
    if (a.symbol < b.symbol) return -1;
    if (a.symbol > b.symbol) return 1;
    return 0;
  });

  return {
    generatedAt: snapshot.snapshotGeneratedAt || new Date().toISOString(),
    totalInstruments: rows.length,
    rows,
    health: {
      scheduler: {
        running: (snapshot as any).schedulerRunning ?? ((snapshot as any).scheduler && ((snapshot as any).scheduler.inProgress || false)) ?? false,
        cycleInProgress: (snapshot as any).cycleInProgress ?? ((snapshot as any).scheduler && ((snapshot as any).scheduler.inProgress || false)) ?? false,
        nextRunAt: (snapshot as any).nextAutomaticRunAt ?? ((snapshot as any).scheduler && (snapshot as any).scheduler.nextRunAt ? new Date((snapshot as any).scheduler.nextRunAt).toISOString() : null) ?? null,
        lastRunAt: (snapshot as any).lastAutomaticRunAt ?? ((snapshot as any).scheduler && (snapshot as any).scheduler.lastRunAt ? new Date((snapshot as any).scheduler.lastRunAt).toISOString() : null) ?? null,
        lastStatus: (snapshot as any).lastAutomaticRunStatus ?? ((snapshot as any).scheduler && (snapshot as any).scheduler.lastAutomaticRunStatus ? (snapshot as any).scheduler.lastAutomaticRunStatus : null) ?? null,
      },
      forexLaunchControl: snapshot.forexLaunchControl || null,
      latestAutomaticQuotesError: snapshot.latestAutomaticQuotesError || null,
    }
  } as const;
}

export type MarketOverviewViewModel = ReturnType<typeof buildMarketOverviewViewModel>;
