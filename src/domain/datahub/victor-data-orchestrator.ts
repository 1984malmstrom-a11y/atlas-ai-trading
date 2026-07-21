import registry from './provider-registry';
import { ProviderFetchResult } from './orchestrator-types';
import { VictorDataProvider, VictorEvidence } from './types';

type OrchestratorOpts = { timeoutMs?: number; retries?: number; cacheTtls?: Record<string, number> };

const DEFAULTS: OrchestratorOpts = { timeoutMs: 5000, retries: 1, cacheTtls: {} };

// in-memory cache: key -> { data, fetchedAt, ttl }
const cache = new Map<string, { data: VictorEvidence[]; fetchedAt: number; ttlMs: number }>();

function cacheKey(providerId: string, symbol?: string){ return `${providerId}::${symbol||''}`; }

export function clearCache(){ cache.clear(); }

function now(){ return Date.now(); }

async function callWithTimeout<T>(p: Promise<T>, ms: number): Promise<{ ok: boolean; result?: T; timedOut?: boolean; error?: any }>{
  let timer: NodeJS.Timeout;
  return new Promise(resolve=>{
    const to = setTimeout(()=>{ timer = to; resolve({ ok: false, timedOut: true }); }, ms);
    p.then(r=>{ clearTimeout(to); resolve({ ok: true, result: r }); }).catch(e=>{ clearTimeout(to); resolve({ ok: false, error: e }); });
  });
}

export async function fetchAllProviders(symbol?: string, opts?: OrchestratorOpts): Promise<ProviderFetchResult[]>{
  const cfg = { ...DEFAULTS, ...(opts||{}) };
  const providers = registry.getProviders();
  const results: ProviderFetchResult[] = [];
  await Promise.all(providers.map(async (p: VictorDataProvider)=>{
    const key = cacheKey(p.providerId, symbol);
    const ttlMs = cfg.cacheTtls && cfg.cacheTtls[p.categories[0]] ? cfg.cacheTtls[p.categories[0]] : 60000;
    const cached = cache.get(key);
    if (cached && (now() - cached.fetchedAt) <= cached.ttlMs){
      results.push({ providerId: p.providerId, providerName: p.providerName, status: 'Cached', evidence: cached.data, durationMs: 0, fetchedAt: new Date(cached.fetchedAt).toISOString(), fromCache: true, retryCount: 0 });
      return;
    }

    // check availability (await if needed)
    let available = true;
    try{ const av = p.isAvailable ? p.isAvailable() : true; available = (typeof av === 'boolean') ? av : await av; }catch(e){ available = false; }
    if (!available){ results.push({ providerId: p.providerId, providerName: p.providerName, status: 'Failed', evidence: [], error: 'Unavailable', durationMs: 0, fetchedAt: new Date().toISOString(), retryCount: 0 }); return; }

    // attempt fetch with retries
    let attempt = 0; let ok = false; let lastErr: any = null; let fetched: VictorEvidence[] = [];
    const start = now();
    for(; attempt <= (cfg.retries||0); attempt++){
      try{
        const call = p.fetchEvidence(symbol);
        const res = await callWithTimeout(call, cfg.timeoutMs || 5000);
        if (res.timedOut){ lastErr = 'Timeout'; continue; }
        if (!res.ok){ lastErr = res.error; continue; }
        fetched = Array.isArray(res.result) ? res.result as VictorEvidence[] : [];
        ok = true; break;
      }catch(err){ lastErr = err; }
    }
    const duration = now() - start;
    if (ok){
      // store cached entry
      cache.set(key, { data: fetched, fetchedAt: now(), ttlMs });
      results.push({ providerId: p.providerId, providerName: p.providerName, status: 'Success', evidence: fetched, error: null, durationMs: duration, fetchedAt: new Date().toISOString(), fromCache: false, retryCount: attempt });
    } else {
      // fallback to stale cache if exists
      if (cached){
        results.push({ providerId: p.providerId, providerName: p.providerName, status: 'Cached', evidence: cached.data, error: String(lastErr), durationMs: duration, fetchedAt: new Date(cached.fetchedAt).toISOString(), fromCache: true, retryCount: attempt });
      } else {
        results.push({ providerId: p.providerId, providerName: p.providerName, status: lastErr === 'Timeout' ? 'Timeout' : 'Failed', evidence: [], error: String(lastErr), durationMs: duration, fetchedAt: new Date().toISOString(), fromCache: false, retryCount: attempt });
      }
    }
  }));
  return results;
}

const orchestrator = { fetchAllProviders, clearCache };
export default orchestrator;
