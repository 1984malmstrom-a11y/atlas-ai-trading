export type ExternalDataReadinessStatus = 'READY' | 'LIMITED' | 'UNAVAILABLE';

export type ExternalIntelligenceCategory =
  | 'COMPANY_NEWS'
  | 'MARKET_NEWS'
  | 'NEWS_SENTIMENT'
  | 'MACRO_EVENTS'
  | 'INTEREST_RATES'
  | 'INFLATION'
  | 'EMPLOYMENT'
  | 'EARNINGS_CALENDAR'
  | 'INCOME_STATEMENT'
  | 'BALANCE_SHEET'
  | 'CASH_FLOW'
  | 'COMPANY_PROFILE'
  | 'ANALYST_ESTIMATES'
  | 'OFFICIAL_FILINGS';

export type ExternalIntelligenceSourceReadiness = {
  category: ExternalIntelligenceCategory;
  status: ExternalDataReadinessStatus;
  provider: string | null;
  runtimeIntegrated: boolean;
  decisionIntelligenceIntegrated: boolean;
  freshnessMinutes: number | null;
  warnings: readonly string[];
};

export type ExternalIntelligenceReadiness = {
  schemaVersion: 1;
  checkedAt: string;

  readyCount: number;
  limitedCount: number;
  unavailableCount: number;

  sources: readonly ExternalIntelligenceSourceReadiness[];

  topBlockingReasons: readonly { reason: string; count: number }[];
};

export type ReadinessBuildInput = {
  // simple declarative capability hints (no secrets)
  capabilities?: {
    finnhub?: boolean; // company news
    macroConfig?: boolean; // macro indicators configured
    fundamentals?: boolean; // twelve-data fundamentals available
  };
  runtimeUsage?: {
    companyNewsRuntime?: boolean;
    companyNewsDI?: boolean;
    macroRuntime?: boolean;
    macroDI?: boolean;
    fundamentalsRuntime?: boolean;
    fundamentalsDI?: boolean;
  };
  freshnessMinutes?: Partial<Record<ExternalIntelligenceCategory, number | null>>;
  now?: Date;
};

function dedupeWarnings(arr: string[]){ return Array.from(new Set((arr||[]).filter(Boolean))).sort(); }

export function buildExternalIntelligenceReadiness(input?: ReadinessBuildInput): ExternalIntelligenceReadiness{
  const now = input && input.now ? input.now : new Date();
  const checkedAt = now.toISOString();
  const caps = input && input.capabilities ? input.capabilities : {};
  const run = input && input.runtimeUsage ? input.runtimeUsage : {};
  const freshness = input && input.freshnessMinutes ? input.freshnessMinutes : {} as any;

  // static categories we report on (order stable)
  const categories: ExternalIntelligenceCategory[] = [ 'COMPANY_NEWS','MARKET_NEWS','NEWS_SENTIMENT','MACRO_EVENTS','INTEREST_RATES','INFLATION','EMPLOYMENT','EARNINGS_CALENDAR','INCOME_STATEMENT','BALANCE_SHEET','CASH_FLOW','COMPANY_PROFILE','ANALYST_ESTIMATES','OFFICIAL_FILINGS' ];

  const srcs: ExternalIntelligenceSourceReadiness[] = categories.map(cat => {
    let provider: string | null = null;
    let provAvailable = false;
    let runtimeIntegrated = false;
    let diIntegrated = false;
    let warn: string[] = [];

    if (cat === 'COMPANY_NEWS' || cat === 'MARKET_NEWS' || cat === 'NEWS_SENTIMENT'){
      provider = 'FINNHUB';
      provAvailable = !!caps.finnhub;
      runtimeIntegrated = !!run.companyNewsRuntime;
      diIntegrated = !!run.companyNewsDI;
      if (!provAvailable) warn.push('PROVIDER_MISSING');
    }

    if (cat === 'MACRO_EVENTS' || cat === 'INTEREST_RATES' || cat === 'INFLATION' || cat === 'EMPLOYMENT'){
      provider = 'MACRO_REGISTRY';
      provAvailable = !!caps.macroConfig;
      runtimeIntegrated = !!run.macroRuntime;
      diIntegrated = !!run.macroDI;
      if (!provAvailable) warn.push('MACRO_CONFIG_MISSING');
    }

    if (cat === 'INCOME_STATEMENT' || cat === 'BALANCE_SHEET' || cat === 'CASH_FLOW' || cat === 'COMPANY_PROFILE' || cat === 'ANALYST_ESTIMATES' || cat === 'EARNINGS_CALENDAR'){
      provider = 'TWELVE_DATA';
      provAvailable = !!caps.fundamentals;
      runtimeIntegrated = !!run.fundamentalsRuntime;
      diIntegrated = !!run.fundamentalsDI;
      if (!provAvailable) warn.push('FUNDAMENTAL_PROVIDER_MISSING');
    }

    // Decide status
    const fMin = (freshness && Object.prototype.hasOwnProperty.call(freshness, cat)) ? freshness[cat] : null;
    let status: ExternalDataReadinessStatus = 'UNAVAILABLE';
    if (!provAvailable) status = 'UNAVAILABLE';
    else if (provAvailable && runtimeIntegrated && diIntegrated && (fMin === null || fMin === undefined || (typeof fMin === 'number' && fMin <= 120))) status = 'READY';
    else status = 'LIMITED';

    // warnings: freshness and integration
    if (provAvailable && !runtimeIntegrated) warn.push('PROVIDER_BUT_RUNTIME_MISSING');
    if (provAvailable && runtimeIntegrated && !diIntegrated) warn.push('RUNTIME_BUT_DI_MISSING');
    if (typeof fMin === 'number' && fMin !== null && fMin > 60) warn.push('DATA_STALE');

    return { category: cat, status, provider: provider || null, runtimeIntegrated: !!runtimeIntegrated, decisionIntelligenceIntegrated: !!diIntegrated, freshnessMinutes: typeof fMin === 'number' ? fMin : null, warnings: dedupeWarnings(warn) } as ExternalIntelligenceSourceReadiness;
  });

  let readyCount = 0, limitedCount = 0, unavailableCount = 0;
  const reasonCounts: Record<string, number> = {};
  for (const s of srcs){ if (s.status === 'READY') readyCount++; else if (s.status === 'LIMITED') limitedCount++; else unavailableCount++; for (const w of s.warnings || []) reasonCounts[w] = (reasonCounts[w] || 0) + 1; }
  const top = Object.keys(reasonCounts).map(k=> ({ reason: k, count: reasonCounts[k] })).sort((a,b)=> b.count - a.count || a.reason.localeCompare(b.reason)).slice(0,10);

  const out: ExternalIntelligenceReadiness = { schemaVersion: 1, checkedAt, readyCount, limitedCount, unavailableCount, sources: srcs, topBlockingReasons: top };
  return JSON.parse(JSON.stringify(out));
}

export default { buildExternalIntelligenceReadiness };

export function buildCurrentExternalIntelligenceReadiness(opts?: { env?: NodeJS.ProcessEnv; runtime?: any }){
  const env = opts && opts.env ? opts.env : (typeof process !== 'undefined' ? process.env : {} as NodeJS.ProcessEnv);
  const runtime = opts && opts.runtime ? opts.runtime : {};
  // detect capabilities from environment and registry
  const finnhub = typeof env.FINNHUB_API_KEY === 'string' && String(env.FINNHUB_API_KEY).trim().length > 0;
  const fundamentals = typeof env.TWELVE_DATA_API_KEY === 'string' && String(env.TWELVE_DATA_API_KEY).trim().length > 0;
  // macro registry: avoid network, inspect registry config only
  let macroConfig = false;
  try{ const ms = require('./macro-signals'); if (ms && typeof ms.getMacroIndicatorRegistry === 'function'){ const reg = ms.getMacroIndicatorRegistry(env); if (Array.isArray(reg) && reg.some((r:any)=> r && r.enabled === true)) macroConfig = true; } }catch(_){ macroConfig = false; }

  const capabilities = { finnhub: !!finnhub, macroConfig: !!macroConfig, fundamentals: !!fundamentals };

  const runtimeUsage = {
    companyNewsRuntime: Boolean(runtime.latestMarketNewsActivity),
    companyNewsDI: Boolean(runtime.latestDecisionIntelligenceBySymbol && Object.keys(runtime.latestDecisionIntelligenceBySymbol || {}).length > 0),
    macroRuntime: Boolean(runtime.latestMarketRegimeIntelligenceBySymbol && Object.keys(runtime.latestMarketRegimeIntelligenceBySymbol || {}).length > 0),
    macroDI: Boolean(runtime.latestDecisionIntelligenceBySymbol && Object.keys(runtime.latestDecisionIntelligenceBySymbol || {}).length > 0),
    fundamentalsRuntime: Boolean(runtime.latestFundamentalIntelligenceBySymbol && Object.keys(runtime.latestFundamentalIntelligenceBySymbol || {}).length > 0),
    fundamentalsDI: Boolean(runtime.latestDecisionIntelligenceBySymbol && Object.keys(runtime.latestDecisionIntelligenceBySymbol || {}).length > 0),
  };

  return buildExternalIntelligenceReadiness({ capabilities, runtimeUsage, now: opts && opts.env && opts.env['NOW'] ? new Date(String(opts.env['NOW'])) : new Date() });
}
