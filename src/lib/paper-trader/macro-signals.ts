// Macro signals module — provides types and builders for macroeconomic / market-wide signals

export type MacroSignalDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export type MacroSignal = {
  id: string;
  type: string; // e.g., 'VIX', 'DXY', 'US10Y', 'GOLD', 'OIL'
  origin: string; // e.g., 'MACRO_INDICATOR' or 'MACRO_MODEL'
  direction: MacroSignalDirection;
  evidence: Record<string, unknown> | null;
  strength: number; // 0.0 - 1.0
  generatedAt: string;
};

function nowIso(){ return new Date().toISOString(); }

function makeEmptySignal(type: string, direction: MacroSignalDirection = 'NEUTRAL', strength: number = 0.4) : MacroSignal {
  const id = `macro_${type.toLowerCase()}`;
  return {
    id,
    type,
    origin: 'MACRO_PLACEHOLDER',
    direction,
    evidence: null,
    strength,
    generatedAt: nowIso(),
  };
}

// Build a VIX macro signal from a numeric VIX value.
// Classification rules:
// - VIX < 15            -> BULLISH
// - 15 <= VIX < 20      -> NEUTRAL
// - VIX >= 20           -> BEARISH
export function buildVixSignal(vixValue: number): MacroSignal {
  const type = 'VIX';
  const id = `macro_${type.toLowerCase()}`;
  const thresholds = { low: 15, mid: 20, high: 30 };
  let direction: MacroSignalDirection = 'NEUTRAL';
  let strength = 0.4;
  if (typeof vixValue === 'number'){
    if (vixValue < thresholds.low) { direction = 'BULLISH'; strength = 1.0; }
    else if (vixValue >= thresholds.low && vixValue < thresholds.mid) { direction = 'NEUTRAL'; strength = 0.4; }
    else if (vixValue >= thresholds.mid && vixValue < thresholds.high) { direction = 'BEARISH'; strength = 0.75; }
    else { direction = 'BEARISH'; strength = 1.0; }
  }
  const evidence = { value: Number(vixValue), regime: direction, threshold: thresholds, strength } as any;
  return { id, type, origin: 'MACRO_MARKET_DATA', direction, evidence, strength, generatedAt: nowIso() } as MacroSignal;
}

export function buildMacroSignalsMock(vixValue?: number, dxyValue?: number, us10yValue?: number, goldValue?: number, oilValue?: number): MacroSignal[]{
  // Reuse the central builder so mock logic isn't duplicated.
  return buildMacroSignals({ vix: vixValue, dxy: dxyValue, us10y: us10yValue, gold: goldValue, oil: oilValue });
}

export interface MacroSnapshot {
  vix?: number;
  dxy?: number;
  us10y?: number;
  gold?: number;
  oil?: number;
  generatedAt?: string;
}

export type MacroIndicatorKey = 'vix' | 'dxy' | 'us10y' | 'oil';

export type MacroIndicatorConfig = {
  key: MacroIndicatorKey;
  providerSymbol?: string; // optional provider symbol, never logged
  enabled: boolean;
};

export function getMacroIndicatorRegistry(env?: NodeJS.ProcessEnv): MacroIndicatorConfig[] {
  const e = env || (typeof process !== 'undefined' ? process.env : {} as NodeJS.ProcessEnv);
  const read = (k: string) => {
    try{ const v = e[k]; if (v === undefined) return undefined; const t = String(v).trim(); return t.length === 0 ? undefined : t; }catch(_){ return undefined; }
  };
  const vix = read('PAPER_TRADER_MACRO_VIX_SYMBOL');
  const dxy = read('PAPER_TRADER_MACRO_DXY_SYMBOL');
  const us10y = read('PAPER_TRADER_MACRO_US10Y_SYMBOL');
  const oil = read('PAPER_TRADER_MACRO_OIL_SYMBOL');
  return [
    { key: 'vix', providerSymbol: vix, enabled: typeof vix === 'string' && vix.length > 0 },
    { key: 'dxy', providerSymbol: dxy, enabled: typeof dxy === 'string' && dxy.length > 0 },
    { key: 'us10y', providerSymbol: us10y, enabled: typeof us10y === 'string' && us10y.length > 0 },
    { key: 'oil', providerSymbol: oil, enabled: typeof oil === 'string' && oil.length > 0 },
  ];
}

export type MacroProviderValidationStatus = 'VALID' | 'NOT_FOUND' | 'UNSUPPORTED' | 'INVALID_ASSET_TYPE' | 'PROVIDER_ERROR';

export type MacroProviderValidationResult = {
  key: MacroIndicatorKey;
  configured: boolean;
  status: MacroProviderValidationStatus;
  assetType?: string;
  exchange?: string;
};

export type MacroProviderValidationSummary = {
  checkedAt: string;
  validCount: number;
  configuredCount: number;
  results: MacroProviderValidationResult[];
};

export type MacroProviderCandidate = {
  key: MacroIndicatorKey;
  symbol: string;
  instrumentName?: string;
  instrumentType?: string;
  exchange?: string;
  compatibility: 'COMPATIBLE' | 'POSSIBLE' | 'INCOMPATIBLE';
  exactMatch?: boolean;
};

export type MacroProviderDiscoveryResult = {
  checkedAt: string;
  candidatesByIndicator: {
    vix: MacroProviderCandidate[];
    dxy: MacroProviderCandidate[];
    us10y: MacroProviderCandidate[];
    oil: MacroProviderCandidate[];
  };
  requestStats?: {
    searchCalls: number;
    exactLookupCalls: number;
    uniqueLookupSymbols: number;
  };
  recommendedByIndicator?: {
    vix?: MacroProviderCandidate | undefined;
    dxy?: MacroProviderCandidate | undefined;
    us10y?: MacroProviderCandidate | undefined;
    oil?: MacroProviderCandidate | undefined;
  };
};

export async function discoverMacroProviderCandidates(deps?: { searchCandidates?: (q:string)=>Promise<any[]>; lookupExact?: (s:string)=>Promise<any>; now?: ()=>Date }): Promise<MacroProviderDiscoveryResult> {
  const nowFn = deps && deps.now ? deps.now : (()=> new Date());
  const checkedAt = nowFn().toISOString();
  const termsByKey: Record<MacroIndicatorKey, string[]> = {
    vix: ['VIX','CBOE Volatility Index','Volatility Index'],
    dxy: ['DXY','US Dollar Index','Dollar Index'],
    us10y: ['US10Y','10 Year Treasury','US 10 Year Yield','Treasury Yield'],
    oil: ['WTI','Brent','Crude Oil'],
  };
  const td = await import('../market-data/twelve-data');
  const searchFn = deps && deps.searchCandidates ? deps.searchCandidates : td.searchTwelveSymbolCandidates;
  const lookupFn = deps && deps.lookupExact ? deps.lookupExact : td.lookupTwelveSymbolExact;
  const candidatesByIndicator: any = { vix: [], dxy: [], us10y: [], oil: [] };
  const globalLookupCache = new Map<string, { found?: boolean; exactMatch?: boolean; assetType?: string; exchange?: string; error?: any }>();
  let searchCalls = 0;
  let exactLookupCalls = 0;
  const uniqueLookups = new Set<string>();

  const isRelevantForKey = (key: MacroIndicatorKey, cand: { instrumentName?:string; instrumentType?:string; symbol?:string })=>{
    const name = String(cand.instrumentName || '').toLowerCase();
    const typ = String(cand.instrumentType || '').toLowerCase();
    // reject obvious equities/etf/warrant/certificate
    if (/\b(stock|equity|ordinary|etf|warrant|certificate)\b/.test(typ)) return false;
    if (key === 'vix'){
      if (name.includes('volatility') || name.includes('vix')) return true;
      if (typ.includes('index') || typ.includes('idx') || typ.includes('benchmark')) return true;
      return false;
    }
    if (key === 'dxy'){
      if (name.includes('dollar index') || name.includes('dxy') || name.includes('us dollar')) return true;
      if (typ.includes('index') || typ.includes('idx')) return true;
      return false;
    }
    if (key === 'us10y'){
      if (name.includes('treasury') || name.includes('10 year') || name.includes('10-year') || name.includes('yield') || name.includes('government')) return true;
      if (typ.includes('bond') || typ.includes('yield') || typ.includes('treasury') || typ.includes('government') || typ.includes('note') || typ.includes('index')) return true;
      return false;
    }
    if (key === 'oil'){
      if (name.includes('crude') || name.includes('wti') || name.includes('brent')) return true;
      if (typ.includes('commodity') || typ.includes('future') || typ.includes('crude') || typ.includes('oil')) return true;
      return false;
    }
    return false;
  };

  for (const key of Object.keys(termsByKey) as MacroIndicatorKey[]){
    const terms = termsByKey[key];
    const seen = new Map<string, MacroProviderCandidate>();
    const perIndicatorExactCount = { count: 0 };
    for (const term of terms){
      try{
        searchCalls++;
        const raw = await searchFn(term);
        if (!Array.isArray(raw)) continue;
        for (const r of raw){
          try{
            const id = (String(r.symbol || '').toUpperCase() + '|' + String(r.exchange || '')).toUpperCase();
            if (!r.symbol) continue;
            if (seen.has(id)) continue;
            const instType = r.instrumentType || r.instrument_type || undefined;
            const detectedTenor = extractTenorFromText(String(r.symbol || '')) || extractTenorFromText(String(r.instrumentName || ''));
            // conservative initial compatibility
            let comp: MacroProviderCandidate['compatibility'] = 'POSSIBLE';
            const hasNameOrType = Boolean(r.instrumentName || r.instrument_type || r.instrumentType || r.name);
            if (!hasNameOrType) comp = 'POSSIBLE';
            // If type strongly indicates incompatibility, mark INCOMPATIBLE
            if (instType && /\b(stock|equity|etf|warrant|certificate)\b/i.test(String(instType))) comp = 'INCOMPATIBLE';
            // If tenor explicitly indicates other than 10y for us10y, mark INCOMPATIBLE
            if (key === 'us10y' && detectedTenor && detectedTenor !== '10y'){
              comp = 'INCOMPATIBLE';
            }
            // If name/type indicate relevance and accepted assetType, mark COMPATIBLE
            if (isRelevantForKey(key, r) && instType && assetTypeAccepts(key, instType) && !(key === 'us10y' && detectedTenor && detectedTenor !== '10y')) comp = 'COMPATIBLE';
            const cand: MacroProviderCandidate = { key: key as MacroIndicatorKey, symbol: String(r.symbol).toUpperCase(), instrumentName: r.instrumentName, instrumentType: instType, exchange: r.exchange, compatibility: comp };
            seen.set(id, cand);
          }catch(e){ continue; }
        }
      }catch(e){ /* isolate term errors */ continue; }
    }
    // convert to array and sort by compatibility
    let arr = Array.from(seen.values());
    arr.sort((a,b)=>{
      const order = { COMPATIBLE: 0, POSSIBLE: 1, INCOMPATIBLE: 2 } as any;
      if (order[a.compatibility] !== order[b.compatibility]) return order[a.compatibility] - order[b.compatibility];
      return String(a.symbol).localeCompare(String(b.symbol));
    });
    // For COMPATIBLE or POSSIBLE candidates, perform up to 3 exact lookups per indicator, but avoid duplicate symbol lookups globally
    const toVerify = arr.filter(c => c.compatibility === 'COMPATIBLE' || c.compatibility === 'POSSIBLE');
    for (const c of toVerify){
      if (perIndicatorExactCount.count >= 3) break;
      const symKey = c.symbol + '|' + (c.exchange || '');
      if (globalLookupCache.has(symKey)){
        const cached = globalLookupCache.get(symKey)!;
        c.exactMatch = Boolean(cached.exactMatch);
        // update compatibility if verified by provider assetType
        if (c.exactMatch && cached.assetType && assetTypeAccepts(c.key, cached.assetType)) c.compatibility = 'COMPATIBLE';
        else if (c.exactMatch && cached.assetType && !assetTypeAccepts(c.key, cached.assetType)) c.compatibility = 'INCOMPATIBLE';
        perIndicatorExactCount.count++;
        continue;
      }
      try{
        exactLookupCalls++;
        uniqueLookups.add(c.symbol);
        const lookup = await lookupFn(c.symbol);
        globalLookupCache.set(symKey, lookup as any);
        c.exactMatch = !!lookup.exactMatch;
        if (c.exactMatch && lookup.assetType && assetTypeAccepts(c.key, lookup.assetType)) c.compatibility = 'COMPATIBLE';
        else if (c.exactMatch && lookup.assetType && !assetTypeAccepts(c.key, lookup.assetType)) c.compatibility = 'INCOMPATIBLE';
        perIndicatorExactCount.count++;
      }catch(e){ globalLookupCache.set(symKey, { error: 'PROVIDER_ERROR' } as any); }
    }
    // sort by exactMatch within same compatibility: prefer exactMatch true
    arr.sort((a,b)=>{
      if (a.compatibility === b.compatibility){
        const ax = a.exactMatch ? 0 : 1;
        const bx = b.exactMatch ? 0 : 1;
        if (ax !== bx) return ax - bx;
      }
      return 0;
    });
    candidatesByIndicator[key] = arr.slice(0,5);
  }

  const recommendedByIndicator: any = {};
  const selectRec = (k: MacroIndicatorKey)=>{
    try{
      const list = candidatesByIndicator[k] as MacroProviderCandidate[] || [];
      return selectRecommendedMacroCandidate(k, list);
    }catch(e){ return undefined; }
  };
  recommendedByIndicator.vix = selectRec('vix');
  recommendedByIndicator.dxy = selectRec('dxy');
  recommendedByIndicator.us10y = selectRec('us10y');
  recommendedByIndicator.oil = selectRec('oil');

  return { checkedAt, candidatesByIndicator, requestStats: { searchCalls, exactLookupCalls, uniqueLookupSymbols: uniqueLookups.size }, recommendedByIndicator } as MacroProviderDiscoveryResult;
}

// Helper: extract tenor like 2Y, 10Y, 30Y from symbol or name
function extractTenorFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const s = String(text).toLowerCase();
  const m = s.match(/\b(\d{1,2})\s*-?\s*(years|year|yrs|yr|y)\b/);
  if (m && m[1]) return `${m[1]}y`;
  if (/\bus10y\b/.test(s)) return '10y';
  if (/\b10-?year\b/.test(s)) return '10y';
  if (/\b10y\b/.test(s)) return '10y';
  if (/\b2y\b/.test(s)) return '2y';
  if (/\b5y\b/.test(s)) return '5y';
  if (/\b30y\b/.test(s)) return '30y';
  return undefined;
}

// Strict recommendation helper
export function selectRecommendedMacroCandidate(key: MacroIndicatorKey, candidates: MacroProviderCandidate[] | undefined): MacroProviderCandidate | undefined {
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  // filter only COMPATIBLE
  const compatible = candidates.filter(c => c.compatibility === 'COMPATIBLE');
  if (compatible.length === 0) return undefined;
  // prefer exactMatch true
  const exacts = compatible.filter(c=> !!c.exactMatch);
  const pool = exacts.length > 0 ? exacts : compatible;
  // Additional per-indicator strict checks
  for (const c of pool){
    const name = String(c.instrumentName || '').toLowerCase();
    const typ = String(c.instrumentType || '').toLowerCase();
    // disallow equities/etf/warrant/certificate
    if (/\b(stock|equity|etf|warrant|certificate|fund|mutual)\b/.test(typ)) continue;
    if (key === 'vix'){
      if (!(name.includes('vix') || name.includes('volatility'))) continue;
      if (!typ.includes('index') && !typ.includes('idx') && !typ.includes('benchmark')) continue;
      return c;
    }
    if (key === 'dxy'){
      if (!(name.includes('dollar index') || name.includes('dxy') || name.includes('us dollar'))) continue;
      if (!typ.includes('index') && !typ.includes('idx')) continue;
      return c;
    }
    if (key === 'us10y'){
      // require explicit 10y tenor
      const tenorSym = extractTenorFromText(c.symbol) || extractTenorFromText(c.instrumentName) || undefined;
      if (!tenorSym) continue;
      if (tenorSym !== '10y') continue;
      if (!/(bond|yield|treasury|government|note|index)/.test(typ)) continue;
      if (!assetTypeAccepts('us10y', c.instrumentType)) continue;
      return c;
    }
    if (key === 'oil'){
      if (!(name.includes('wti') || name.includes('brent') || name.includes('crude'))) continue;
      if (!assetTypeAccepts('oil', c.instrumentType)) continue;
      // disallow ETF/ETP/etc
      if (/\b(etf|etp|etc|fund|certificate)\b/.test(typ)) continue;
      return c;
    }
  }
  return undefined;
}

function normalizeAssetType(t: any): string | undefined {
  try{ if (!t && t !== '') return undefined; const s = String(t).toLowerCase().trim(); return s.length === 0 ? undefined : s; }catch(e){ return undefined; }
}

function assetTypeAccepts(ind: MacroIndicatorKey, rawType?: string): boolean {
  const t = normalizeAssetType(rawType);
  if (!t) return false;
  if (ind === 'vix' || ind === 'dxy'){
    return t.includes('index') || t.includes('idx') || t.includes('benchmark');
  }
  if (ind === 'us10y'){
    return t.includes('bond') || t.includes('yield') || t.includes('treasury') || t.includes('government') || t.includes('note');
  }
  if (ind === 'oil'){
    return t.includes('commodity') || t.includes('future') || t.includes('crude') || t.includes('oil');
  }
  return false;
}

// Validate registry entries against provider symbol lookup (exact match required).
export async function validateMacroIndicatorRegistry(): Promise<MacroProviderValidationSummary> {
  const checkedAt = new Date().toISOString();
  const registry = getMacroIndicatorRegistry();
  const results: MacroProviderValidationResult[] = [];
  let validCount = 0;
  let configuredCount = 0;
  // import twelve-data lookup helper
  const td = await import('../market-data/twelve-data');
  for (const cfg of registry){
    const res: MacroProviderValidationResult = { key: cfg.key, configured: !!cfg.enabled, status: 'UNSUPPORTED' };
    if (!cfg.enabled || !cfg.providerSymbol){
      res.status = 'UNSUPPORTED';
      res.configured = false;
      results.push(res);
      continue;
    }
    configuredCount++;
    try{
      const lookup = await td.lookupTwelveSymbolExact(String(cfg.providerSymbol));
      if (lookup.error){ res.status = 'PROVIDER_ERROR'; }
      else if (!lookup.found || !lookup.exactMatch){ res.status = 'NOT_FOUND'; }
      else {
        // exact match found — validate asset type
        const at = lookup.assetType;
        if (!assetTypeAccepts(cfg.key, at)){
          res.status = 'INVALID_ASSET_TYPE';
          res.assetType = at;
          res.exchange = lookup.exchange;
        } else {
          res.status = 'VALID';
          res.assetType = at;
          res.exchange = lookup.exchange;
          validCount++;
        }
      }
    }catch(e){ res.status = 'PROVIDER_ERROR'; }
    results.push(res);
  }
  return { checkedAt, validCount, configuredCount, results };
}

export function buildMacroSignals(snapshot?: MacroSnapshot): MacroSignal[] {
  // If no snapshot is provided, return the exact neutral placeholders.
  if (!snapshot) {
    return ['VIX','DXY','US10Y','GOLD','OIL'].map((t) => makeEmptySignal(t, 'NEUTRAL'));
  }
  const signals: MacroSignal[] = [];
  if (typeof snapshot.vix === 'number' && !Number.isNaN(snapshot.vix)){
    signals.push(buildVixSignal(snapshot.vix));
  } else {
    signals.push(makeEmptySignal('VIX', 'NEUTRAL'));
  }
  if (typeof snapshot.dxy === 'number' && !Number.isNaN(snapshot.dxy)){
    signals.push(buildDxySignal(snapshot.dxy));
  } else {
    signals.push(makeEmptySignal('DXY', 'NEUTRAL'));
  }
  if (typeof snapshot.us10y === 'number' && !Number.isNaN(snapshot.us10y)){
    signals.push(buildUs10ySignal(snapshot.us10y));
  } else {
    signals.push(makeEmptySignal('US10Y', 'NEUTRAL'));
  }
  if (typeof snapshot.gold === 'number' && !Number.isNaN(snapshot.gold)){
    signals.push(buildGoldSignal(snapshot.gold));
  } else {
    signals.push(makeEmptySignal('GOLD', 'NEUTRAL'));
  }
  if (typeof snapshot.oil === 'number' && !Number.isNaN(snapshot.oil)){
    signals.push(buildOilSignal(snapshot.oil));
  } else {
    signals.push(makeEmptySignal('OIL', 'NEUTRAL'));
  }
  return signals;
}

// Build a MacroSnapshot from the runtime `instruments` universe.
// instruments: array of objects with at least { symbol?, providerSymbol?, price?, dataStatus?, isStale?, marketTimestamp? }
export function buildMacroSnapshotFromInstruments(instruments: any[] | undefined, generatedAt?: string): MacroSnapshot {
  const snap: MacroSnapshot = { generatedAt: generatedAt || new Date().toISOString() };
  if (!Array.isArray(instruments) || instruments.length === 0) return snap;
  const normalize = (s: any) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const oilCandidates = new Set(['OIL','WTI','USOIL','BRENT','BRENTUSD','CRUDEOIL','CRUDE','CL']);
  for (const i of instruments){
    try{
      if (!i) continue;
      if (i.dataStatus === 'UNAVAILABLE') continue;
      if (i.isStale === true) continue;
      const price = (typeof i.price === 'number' && isFinite(i.price)) ? Number(i.price) : null;
      if (price === null || price <= 0) continue;
      const sym = normalize(i.symbol || i.providerSymbol || i.instrumentId || i.name || '');
      if (!snap.gold && sym === 'XAUUSD') snap.gold = price;
      if (!snap.oil && oilCandidates.has(sym)) snap.oil = price;
      // do not attempt to populate VIX/DXY/US10Y here — leave undefined until explicit instruments exist
      if (snap.gold && snap.oil) break;
    }catch(_){ /* ignore per-instrument errors */ }
  }
  return snap;
}

export type MacroIndicatorStatus = 'OK' | 'UNSUPPORTED' | 'MISSING' | 'STALE' | 'ERROR';

export type MacroDataResult = {
  snapshot: MacroSnapshot;
  fetchedAt: string;
  statusByIndicator: {
    vix: MacroIndicatorStatus;
    dxy: MacroIndicatorStatus;
    us10y: MacroIndicatorStatus;
    oil: MacroIndicatorStatus;
  };
  diagnosticsByIndicator: {
    vix: { configured: boolean; status: MacroIndicatorStatus; hasValue: boolean; hasTimestamp: boolean; isFresh: boolean };
    dxy: { configured: boolean; status: MacroIndicatorStatus; hasValue: boolean; hasTimestamp: boolean; isFresh: boolean };
    us10y: { configured: boolean; status: MacroIndicatorStatus; hasValue: boolean; hasTimestamp: boolean; isFresh: boolean };
    oil: { configured: boolean; status: MacroIndicatorStatus; hasValue: boolean; hasTimestamp: boolean; isFresh: boolean };
  };
}

// Fetch macro indicators (VIX, DXY, US10Y) using existing market-data provider when
// corresponding provider symbols are configured AND a matching TradableInstrument exists.
// Does NOT guess symbols, never logs secrets or provider internals.
export async function fetchMacroSnapshot(): Promise<MacroDataResult> {
  const fetchedAt = new Date().toISOString();
  const emptySnapshot: MacroSnapshot = { generatedAt: fetchedAt };
  const initialStatus = { vix: 'UNSUPPORTED', dxy: 'UNSUPPORTED', us10y: 'UNSUPPORTED' } as any;
  const initialDiag = {
    vix: { configured: false, status: 'UNSUPPORTED', hasValue: false, hasTimestamp: false, isFresh: false },
    dxy: { configured: false, status: 'UNSUPPORTED', hasValue: false, hasTimestamp: false, isFresh: false },
    us10y: { configured: false, status: 'UNSUPPORTED', hasValue: false, hasTimestamp: false, isFresh: false },
  } as any;
  const result: MacroDataResult = { snapshot: emptySnapshot, fetchedAt, statusByIndicator: initialStatus, diagnosticsByIndicator: initialDiag } as any;
  try{
    const registry = getMacroIndicatorRegistry();
    const instrMod = await import('../market-data/instruments');
    const providerMod = await import('../market-data');
    const provider: any = providerMod && providerMod.default ? providerMod.default : providerMod;
    // Helper to test freshness: prefer provider-provided isStale, but also check timestamp age <= 120s
    const now = Date.now();
    const maxAgeMs = 120 * 1000;
    for (const cfg of registry){
      const key = cfg.key as MacroIndicatorKey;
      // initialize diagnostics configured flag
      result.diagnosticsByIndicator[key].configured = !!cfg.enabled && typeof cfg.providerSymbol === 'string' && cfg.providerSymbol.length > 0;
      if (!cfg.enabled || !cfg.providerSymbol){
        result.statusByIndicator[key] = 'UNSUPPORTED';
        result.diagnosticsByIndicator[key].status = 'UNSUPPORTED';
        continue;
      }
      // find exact matching instrument by providerSymbol (do not guess)
      const found = Array.isArray((instrMod as any).TRADABLE_INSTRUMENTS) ? (instrMod as any).TRADABLE_INSTRUMENTS.find((i:any)=> {
        try{ return String(i.providerSymbol) === String(cfg.providerSymbol); }catch(e){ return false; }
      }) : undefined;
      if (!found){
        result.statusByIndicator[key] = 'UNSUPPORTED';
        result.diagnosticsByIndicator[key].status = 'UNSUPPORTED';
        continue;
      }
      // attempt to fetch provider quote for the found instrument id
      try{
        const q = await provider.getQuote(found.id);
        const hasTimestamp = !!(q && (q.timestamp || q.time || q.date));
        result.diagnosticsByIndicator[key].hasTimestamp = hasTimestamp;
        if (!q || q.price === null || q.price === undefined){ result.statusByIndicator[key] = 'MISSING'; result.diagnosticsByIndicator[key].status = 'MISSING'; continue; }
        const price = Number(q.price);
        if (!Number.isFinite(price) || price <= 0){ result.statusByIndicator[key] = 'ERROR'; result.diagnosticsByIndicator[key].status = 'ERROR'; continue; }
        const providerIsStale = q.isStale === true;
        let tsMs = 0;
        if (hasTimestamp){
          try{ tsMs = new Date(q.timestamp || q.time || q.date).getTime(); if (!isFinite(tsMs)) tsMs = 0; }catch(_){ tsMs = 0; }
        }
        const isFresh = !providerIsStale && tsMs > 0 && (now - tsMs) <= maxAgeMs;
        result.diagnosticsByIndicator[key].isFresh = Boolean(isFresh);
        if (providerIsStale || !isFresh){ result.statusByIndicator[key] = 'STALE'; result.diagnosticsByIndicator[key].status = 'STALE'; continue; }
        // success
        result.statusByIndicator[key] = 'OK';
        result.diagnosticsByIndicator[key].status = 'OK';
        result.diagnosticsByIndicator[key].hasValue = true;
        // assign into snapshot
        if (key === 'vix') result.snapshot.vix = price;
        if (key === 'dxy') result.snapshot.dxy = price;
        if (key === 'us10y') result.snapshot.us10y = price;
      }catch(e){ result.statusByIndicator[key] = 'ERROR'; result.diagnosticsByIndicator[key].status = 'ERROR'; }
    }
  }catch(e){ /* swallow errors, return best-effort result */ }
  return result;
}

// Build a US10Y macro signal from a numeric US10Y value (percent yield).
// Classification rules:
// - US10Y < 3.5        -> BULLISH
// - 3.5 <= US10Y < 4.5 -> NEUTRAL
// - US10Y >= 4.5       -> BEARISH
export function buildUs10ySignal(us10yValue: number): MacroSignal {
  const type = 'US10Y';
  const id = `macro_${type.toLowerCase()}`;
  const thresholds = { low: 3.5, mid: 4.5 };
  let direction: MacroSignalDirection = 'NEUTRAL';
  let strength = 0.4;
  if (typeof us10yValue === 'number'){
    if (us10yValue < thresholds.low) { direction = 'BULLISH'; strength = 0.7; }
    else if (us10yValue >= thresholds.low && us10yValue < thresholds.mid) { direction = 'NEUTRAL'; strength = 0.4; }
    else { direction = 'BEARISH'; strength = 0.7; }
  }
  const evidence = { value: Number(us10yValue), regime: direction, threshold: thresholds, strength } as any;
  return { id, type, origin: 'MACRO_MARKET_DATA', direction, evidence, strength, generatedAt: nowIso() } as MacroSignal;
}

// Build a DXY macro signal from a numeric DXY value.
// Classification rules:
// - DXY < 98        -> BULLISH
// - 98 <= DXY < 103  -> NEUTRAL
// - DXY >= 103       -> BEARISH
export function buildDxySignal(dxyValue: number): MacroSignal {
  const type = 'DXY';
  const id = `macro_${type.toLowerCase()}`;
  const thresholds = { low: 98, mid: 103 };
  let direction: MacroSignalDirection = 'NEUTRAL';
  let strength = 0.4;
  if (typeof dxyValue === 'number'){
    if (dxyValue < thresholds.low) { direction = 'BULLISH'; strength = 0.8; }
    else if (dxyValue >= thresholds.low && dxyValue < thresholds.mid) { direction = 'NEUTRAL'; strength = 0.4; }
    else { direction = 'BEARISH'; strength = 0.8; }
  }
  const evidence = { value: Number(dxyValue), regime: direction, threshold: thresholds, strength } as any;
  return { id, type, origin: 'MACRO_MARKET_DATA', direction, evidence, strength, generatedAt: nowIso() } as MacroSignal;
}

export const SUPPORTED_MACRO_SIGNALS = ['VIX','DXY','US10Y','GOLD','OIL'] as const;
export type SupportedMacroSignal = typeof SUPPORTED_MACRO_SIGNALS[number];

// Build a GOLD macro signal from a numeric GOLD value (price in e.g. SEK or USD depending on runtime).
// Classification rules:
// - GOLD < 3000       -> BULLISH
// - 3000 <= GOLD < 3500 -> NEUTRAL
// - GOLD >= 3500      -> BEARISH
export function buildGoldSignal(goldValue: number): MacroSignal {
  const type = 'GOLD';
  const id = `macro_${type.toLowerCase()}`;
  const thresholds = { low: 3000, mid: 3500 };
  let direction: MacroSignalDirection = 'NEUTRAL';
  let strength = 0.4;
  if (typeof goldValue === 'number'){
    if (goldValue < thresholds.low) { direction = 'BULLISH'; strength = 0.7; }
    else if (goldValue >= thresholds.low && goldValue < thresholds.mid) { direction = 'NEUTRAL'; strength = 0.4; }
    else { direction = 'BEARISH'; strength = 0.8; }
  }
  const evidence = { value: Number(goldValue), regime: direction, threshold: thresholds, strength } as any;
  return { id, type, origin: 'MACRO_MARKET_DATA', direction, evidence, strength, generatedAt: nowIso() } as MacroSignal;
}

// Build an OIL macro signal from a numeric OIL value (price per barrel).
// Classification rules:
// - OIL < 60        -> BULLISH
// - 60 <= OIL < 90  -> NEUTRAL
// - OIL >= 90       -> BEARISH
export function buildOilSignal(oilValue: number): MacroSignal {
  const type = 'OIL';
  const id = `macro_${type.toLowerCase()}`;
  const thresholds = { low: 60, mid: 90 };
  let direction: MacroSignalDirection = 'NEUTRAL';
  let strength = 0.4;
  if (typeof oilValue === 'number'){
    if (oilValue < thresholds.low) { direction = 'BULLISH'; strength = 0.7; }
    else if (oilValue >= thresholds.low && oilValue < thresholds.mid) { direction = 'NEUTRAL'; strength = 0.4; }
    else { direction = 'BEARISH'; strength = 0.8; }
  }
  const evidence = { value: Number(oilValue), regime: direction, threshold: thresholds, strength } as any;
  return { id, type, origin: 'MACRO_MARKET_DATA', direction, evidence, strength, generatedAt: nowIso() } as MacroSignal;
}
