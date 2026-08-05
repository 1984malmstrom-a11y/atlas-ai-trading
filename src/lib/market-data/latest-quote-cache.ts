import fs from 'fs';
import path from 'path';

export type LatestQuoteCacheEntry = {
  instrumentId: string;
  symbol: string | null;
  providerSymbol: string | null;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  marketTimestamp: string | null;
  fetchedAt: string; // ISO
  observedAt: string; // ISO when first seen
  expiresAt: string | null; // ISO
  dataStatus: 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE' | 'MARKET_CLOSED';
  isStale: boolean;
  provider: string | null;
  currency: string | null;
};

export type LatestQuoteCache = Record<string, LatestQuoteCacheEntry>;

function toIso(d?: Date){ return (d || new Date()).toISOString(); }

function parseNullableNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number'){ if (!Number.isFinite(v)) return null; return v; }
  if (typeof v === 'string'){
    const s = v.trim();
    if (s === '') return null;
    // percent like "1.5%"
    if (s.endsWith('%')){
      const num = Number(s.slice(0,-1));
      return Number.isFinite(num) ? num : null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function safePositiveNumber(v: any): number | null {
  const n = parseNullableNumber(v);
  if (n === null) return null;
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return n;
}

export function createEmptyLatestQuoteCache(): LatestQuoteCache { return {}; }

export function hydrateLatestQuoteCache(serialized: any): LatestQuoteCache {
  if (!serialized || typeof serialized !== 'object') return createEmptyLatestQuoteCache();
  const out: LatestQuoteCache = {};
  try{
    for (const k of Object.keys(serialized)){
      try{
        const v = serialized[k];
        if (!v || typeof v !== 'object') continue;
        // basic validation
        const instrumentId = String(v.instrumentId || k).toLowerCase();
        const fetchedAt = v.fetchedAt ? String(v.fetchedAt) : toIso();
        out[instrumentId] = {
          instrumentId,
          symbol: v.symbol ?? null,
          providerSymbol: v.providerSymbol ?? null,
          price: (typeof v.price === 'number' && Number.isFinite(v.price)) ? Number(v.price) : (v.price ? parseNullableNumber(v.price) : null),
          previousClose: parseNullableNumber(v.previousClose ?? v.previous_close ?? null),
          change: parseNullableNumber(v.change ?? null),
          changePercent: parseNullableNumber(v.changePercent ?? v.change_percent ?? null),
          marketTimestamp: v.marketTimestamp ?? v.timestamp ?? null,
          fetchedAt: fetchedAt,
          observedAt: v.observedAt ? String(v.observedAt) : fetchedAt,
          expiresAt: v.expiresAt ?? null,
          dataStatus: (v.dataStatus || v.status || 'UNAVAILABLE') as any,
          isStale: !!v.isStale,
          provider: v.provider ?? null,
          currency: v.currency ?? null,
        };
      }catch(e){ continue; }
    }
  }catch(e){ return createEmptyLatestQuoteCache(); }
  return out;
}

function computeExpiresAt(assetType: string | null, fetchedAtIso: string): string | null {
  try{
    const fetched = new Date(fetchedAtIso);
    if (!isFinite(fetched.getTime())) return null;
    const upper = assetType ? String(assetType).toUpperCase() : '';
    let ttlMs = 24 * 60 * 60 * 1000; // default 24h
    if (upper === 'FOREX') ttlMs = 5 * 60 * 1000;
    else if (upper === 'STOCK' || upper === 'ETF') ttlMs = 5 * 60 * 1000;
    else if (upper === 'COMMODITY') ttlMs = 15 * 60 * 1000;
    const exp = new Date(fetched.getTime() + ttlMs);
    return exp.toISOString();
  }catch(e){ return null; }
}

export function mergeLatestQuotes(cache: LatestQuoteCache, quotes: any[], nowIso?: string, assetTypeLookup?: (instrumentId:string)=>string|null): LatestQuoteCache {
  const now = nowIso || toIso();
  const out: LatestQuoteCache = Object.assign({}, cache || {});
  for (const q of Array.isArray(quotes) ? quotes : []){
    try{
      const iidRaw = q.instrumentId || q.id || q.instrument || q.providerSymbol || q.symbol;
      if (!iidRaw) continue;
      const instrumentId = String(iidRaw).toLowerCase();
      const providerSymbol = q.providerSymbol ?? q.provider_symbol ?? q.symbol ?? null;
      const symbol = q.symbol ?? providerSymbol ?? null;
      const price = safePositiveNumber(q.price ?? q.priceSek ?? null);
      if (price === null) continue; // ignore invalid price
      const fetchedAt = q.fetchedAt ? String(q.fetchedAt) : (q.fetched_at ? String(q.fetched_at) : now);
      const marketTimestamp = q.marketTimestamp ?? q.timestamp ?? null;
      const prev = parseNullableNumber(q.previousClose ?? q.previous_close ?? null);
      const change = parseNullableNumber(q.change ?? null) ?? (prev !== null ? Number(price - (prev as number)) : null);
      let changePercent = parseNullableNumber(q.changePercent ?? q.change_percent ?? null);
      if (changePercent === null && prev !== null && prev > 0){ changePercent = ((price - (prev as number)) / (prev as number)) * 100; }

      const provider = q.provider ?? q.source ?? null;
      const currency = q.currency ?? null;
      const isStale = !!(q.isStale || q.is_stale);
      const dataStatus = (q.dataStatus || q.status || q.data_status || 'UNAVAILABLE') as any;

      const existing = out[instrumentId];
      // decide replace only if new is newer or equal
      const existingFetched = existing && existing.fetchedAt ? Date.parse(existing.fetchedAt) : 0;
      const newFetched = fetchedAt ? Date.parse(fetchedAt) : Date.parse(marketTimestamp || now);
      if (!existing){
        const observedAt = now;
        const assetType = assetTypeLookup ? assetTypeLookup(instrumentId) : null;
        const expiresAt = computeExpiresAt(assetType, fetchedAt);
        out[instrumentId] = {
          instrumentId,
          symbol: symbol ? String(symbol) : null,
          providerSymbol: providerSymbol ? String(providerSymbol) : null,
          price,
          previousClose: prev !== null && prev > 0 ? Number(prev) : null,
          change: change !== null ? Number(change) : null,
          changePercent: changePercent !== null ? Number(changePercent) : null,
          marketTimestamp: marketTimestamp ? String(marketTimestamp) : null,
          fetchedAt: String(fetchedAt),
          observedAt,
          expiresAt,
          dataStatus: (dataStatus as any) || 'UNAVAILABLE',
          isStale,
          provider: provider ? String(provider) : null,
          currency: currency ? String(currency) : null,
        };
      } else {
        // preserve observedAt
        const observedAt = existing.observedAt || now;
        // only replace if newFetched >= existingFetched
        if (isNaN(newFetched) || existingFetched > newFetched) continue;
        const assetType = assetTypeLookup ? assetTypeLookup(instrumentId) : null;
        const expiresAt = computeExpiresAt(assetType, fetchedAt);
        out[instrumentId] = {
          instrumentId,
          symbol: symbol ? String(symbol) : existing.symbol,
          providerSymbol: providerSymbol ? String(providerSymbol) : existing.providerSymbol,
          price: price !== null ? price : existing.price,
          previousClose: prev !== null && prev > 0 ? Number(prev) : (existing.previousClose ?? null),
          change: change !== null ? Number(change) : (existing.change ?? null),
          changePercent: changePercent !== null ? Number(changePercent) : (existing.changePercent ?? null),
          marketTimestamp: marketTimestamp ? String(marketTimestamp) : existing.marketTimestamp,
          fetchedAt: String(fetchedAt),
          observedAt,
          expiresAt: expiresAt,
          dataStatus: (dataStatus as any) || existing.dataStatus || 'UNAVAILABLE',
          isStale: isStale || existing.isStale,
          provider: provider ? String(provider) : (existing.provider ?? null),
          currency: currency ? String(currency) : (existing.currency ?? null),
        };
      }
    }catch(e){ continue; }
  }
  return out;
}

// project to runtime.latestQuoteSnapshotBySymbol canonical keys
export function projectLatestQuoteCache(cache: LatestQuoteCache, instruments: any[] = [], nowIso?: string){
  const now = nowIso || toIso();
  const out: Record<string, any> = {};
  for (const id of Object.keys(cache)){
    try{
      const e = cache[id];
      if (!e) continue;
      // canonical key: prefer symbol/providerSymbol normalized similar to demo-runtime
      const pick = (e.symbol || e.providerSymbol || e.instrumentId || '').toString();
      const cleaned = String(pick || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
      let key = ((): string => {
        if (/^[A-Z]{6}$/.test(cleaned)) return `${cleaned.slice(0,3)}/${cleaned.slice(3,6)}`;
        const sep = (pick || '').toString().match(/^([A-Z]{3})[^A-Z0-9]+([A-Z]{3})$/i);
        if (sep) return `${sep[1]}/${sep[2]}`;
        if (String(e.instrumentId || '').indexOf('_')>0){ const parts = String(e.instrumentId).split('_'); if (parts.length===2) return `${parts[0]}/${parts[1]}`; }
        return (e.symbol || e.providerSymbol || e.instrumentId || '').toString().toUpperCase();
      })();

      // compute staleness at projection time based on expiresAt and now
      let computedIsStale = !!e.isStale;
      try{ if (e.expiresAt){ const exp = Date.parse(e.expiresAt); const nowMs = Date.parse(now); if (isFinite(exp) && exp < nowMs) computedIsStale = true; } }catch(_){ }
      let projectedStatus = e.dataStatus || 'UNAVAILABLE';
      // if expired and we have observed data, mark as STALE (never convert truly never-observed entries)
      if (computedIsStale && (e.observedAt || e.fetchedAt)) projectedStatus = 'STALE';

      out[String(key).toUpperCase()] = {
        instrumentId: e.instrumentId || null,
        symbol: e.symbol || null,
        providerSymbol: e.providerSymbol || null,
        price: e.price,
        previousClose: e.previousClose,
        change: e.change,
        changePercent: e.changePercent,
        marketTimestamp: e.marketTimestamp || null,
        fetchedAt: e.fetchedAt || now,
        dataStatus: projectedStatus,
        isStale: !!computedIsStale,
      };
    }catch(e){ continue; }
  }
  return out;
}

export function serializeLatestQuoteCache(cache: LatestQuoteCache){
  try{ return JSON.stringify(cache, null, 2); }catch(e){ return JSON.stringify({}); }
}

// default runtime-backed path outside `src/` to avoid accidental commits
export const DEFAULT_RUNTIME_CACHE_PATH = path.join(process.cwd(), 'runtime-data', 'latest-quote-cache.json');

export function loadPersistedLatestQuoteCache(filePath?: string): LatestQuoteCache {
  const p = filePath || DEFAULT_RUNTIME_CACHE_PATH;
  try{
    if (!fs.existsSync(p)) return createEmptyLatestQuoteCache();
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    return hydrateLatestQuoteCache(parsed || {});
  }catch(e){ return createEmptyLatestQuoteCache(); }
}

export function persistLatestQuoteCacheAtomic(cache: LatestQuoteCache, filePath?: string){
  const p = filePath || DEFAULT_RUNTIME_CACHE_PATH;
  try{
    const dir = path.dirname(p);
    try{ fs.mkdirSync(dir, { recursive: true }); }catch(_){ }
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, serializeLatestQuoteCache(cache), 'utf-8');
    try{ fs.renameSync(tmp, p); }catch(e){ fs.writeFileSync(p, serializeLatestQuoteCache(cache), 'utf-8'); }
  }catch(e){ console.error('persistLatestQuoteCacheAtomic failed', e); }
}
