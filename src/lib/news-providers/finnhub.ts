import { RawNewsItem } from '../news-intelligence/index';

export class FinnhubNewsProviderError extends Error{
  name = 'FinnhubNewsProviderError';
  code: 'MISSING_API_KEY'|'INVALID_REQUEST'|'PROVIDER_FAILURE'|'INVALID_RESPONSE';
  failedSymbols: string[];
  constructor(code: FinnhubNewsProviderError['code'], message: string, failedSymbols: string[] = []){
    super(message);
    this.code = code;
    this.failedSymbols = failedSymbols;
    Object.setPrototypeOf(this, FinnhubNewsProviderError.prototype);
  }
}

function sanitizeMessage(msg: any){
  try{
    let s = String(msg || '');
    // redact apparent api keys (long alphanumeric)
    s = s.replace(/[A-Za-z0-9_-]{20,}/g, '[REDACTED]');
    // never include URLs or tokens
    s = s.replace(/https?:\/\/[\S]+/g,'[REDACTED_URL]');
    return s;
  }catch(e){ return 'error'; }
}

function normalizeSymbolsList(sym?: string[]){
  if(!Array.isArray(sym)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for(const s of sym){
    if(!s) continue;
    const v = String(s).trim().toUpperCase();
    if(!v) continue;
    if(seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if(out.length >= 25) break;
  }
  return out.slice(0,25);
}

function toISOFromUnixSeconds(val: any){
  const n = Number(val);
  if(!isFinite(n)) return null;
  try{ return new Date(n*1000).toISOString(); }catch(e){ return null; }
}

export function mapFinnhubNewsItem(item: any, symbol: string): RawNewsItem | null{
  // do not mutate item
  const headline = item.headline ? String(item.headline).trim() : '';
  if(!headline) return null;
  const summary = item.summary ? String(item.summary).trim() : '';
  const url = item.url ? String(item.url).trim() : null;
  const id = item.id !== undefined && item.id !== null ? String(item.id) : undefined;
  const publishedAt = item.datetime ? toISOFromUnixSeconds(item.datetime) : (item.publishedAt ? (isNaN(Date.parse(item.publishedAt)) ? null : new Date(item.publishedAt).toISOString()) : null);
  return {
    id,
    source: 'FINNHUB',
    headline,
    summary,
    url,
    symbols: [symbol],
    publishedAt: publishedAt || '',
    category: undefined,
    sentiment: undefined,
  } as RawNewsItem;
}

async function fetchWithTimeout(fetchImpl: any, url: string, opts: any){
  return fetchImpl(url, opts);
}

export async function fetchFinnhubCompanyNews(options: { symbols?: string[], from?: string, to?: string, apiKey?: string, fetchImpl?: typeof fetch }){
  const symbols = normalizeSymbolsList(options.symbols || []);
  if(symbols.length === 0) return [];
  const apiKey = options.apiKey || process.env.FINNHUB_API_KEY;
  if(!apiKey) throw new FinnhubNewsProviderError('MISSING_API_KEY', sanitizeMessage('Missing Finnhub API key'), []);
  const fetchImpl = options.fetchImpl || (globalThis as any).fetch;
  if(typeof fetchImpl !== 'function') throw new FinnhubNewsProviderError('INVALID_REQUEST', sanitizeMessage('No fetch implementation provided'), symbols);

  const from = options.from ? String(options.from) : undefined;
  const to = options.to ? String(options.to) : undefined;

  const resultsPerSymbol: Record<string, any[]> = {};
  const failed: string[] = [];
  const diagnostics: Record<string, { status?: number; statusText?: string; bodySnippet?: string; error?: string }> = {};


  // concurrency control: use a fixed pool of runner tasks so at most maxConcurrency promises exist
  const maxConcurrency = 5;
  const queue = symbols.slice();
  let inFlight = 0;

  async function doFetch(sym: string){
    inFlight++;
    try{
      const params = new URLSearchParams();
      if(from) params.set('from', from);
      if(to) params.set('to', to);
      params.set('symbol', sym);
      params.set('token', apiKey!);
      const url = `https://finnhub.io/api/v1/company-news?${params.toString()}`;
      const res = await fetchWithTimeout(fetchImpl, url, { method: 'GET' });
      if(!res || !res.ok){
        // try to capture a safe snippet of the response for diagnostics
        let snippet = '';
        try{ const txt = await res.text(); snippet = sanitizeMessage(String(txt || '').slice(0, 1000)); }catch(_e){ snippet = ''; }
        diagnostics[sym] = { status: res ? (res.status as number) : undefined, statusText: res ? (res.statusText || '') : undefined, bodySnippet: snippet };
        failed.push(sym); return;
      }
      let body: any;
      try{ body = await res.json(); }catch(e){
        let txt = '';
        try{ txt = await res.text(); }catch(_e){}
        diagnostics[sym] = { status: res.status, statusText: res.statusText, bodySnippet: sanitizeMessage(String(txt || '').slice(0, 1000)) };
        failed.push(sym); return;
      }
      if(!Array.isArray(body)) { diagnostics[sym] = { status: res.status, statusText: res.statusText, bodySnippet: sanitizeMessage(String(JSON.stringify(body)).slice(0,1000)) }; failed.push(sym); return; }
      // map items safely
      const mapped: RawNewsItem[] = [];
      for(const it of body){
        const mappedItem = mapFinnhubNewsItem(it, sym);
        if(mappedItem) mapped.push(mappedItem);
      }
      resultsPerSymbol[sym] = mapped;
    }catch(e:any){
      diagnostics[sym] = { error: sanitizeMessage(String(e && e.message ? e.message : e)) };
      failed.push(sym);
    }finally{ inFlight--; }
  }

  const runners: Promise<void>[] = [];
  const actualConcurrency = Math.min(maxConcurrency, queue.length);
  for(let i=0;i<actualConcurrency;i++){
    runners.push((async function runner(){
      while(true){
        const s = queue.shift();
        if(!s) break;
        await doFetch(s);
      }
    })());
  }
  await Promise.all(runners);


  const allSymbols = Object.keys(resultsPerSymbol);
  if(allSymbols.length === 0){
    // compile sanitized diagnostics summary
    let diagSummary = '';
    try{ diagSummary = sanitizeMessage(JSON.stringify(diagnostics || {})); }catch(e){ diagSummary = 'DIAGNOSTICS_UNAVAILABLE'; }
    throw new FinnhubNewsProviderError('PROVIDER_FAILURE', `All symbol requests failed: ${diagSummary}`, failed);
  }

  // collect and dedupe
  const groupedById = new Map<string, RawNewsItem[]>();
  const noIdGroups = new Map<string, RawNewsItem[]>();
  for(const sym of Object.keys(resultsPerSymbol)){
    for(const it of resultsPerSymbol[sym]){
      if(it.id){
        const arr = groupedById.get(it.id) || [];
        arr.push(it);
        groupedById.set(it.id, arr);
      }else{
        const key = (it.headline||'') + '|' + (it.publishedAt||'');
        const arr = noIdGroups.get(key) || [];
        arr.push(it);
        noIdGroups.set(key, arr);
      }
    }
  }

  const merged: RawNewsItem[] = [];
  for(const [id, arr] of groupedById.entries()){
    const head = arr[0];
    const symbols = Array.from(new Set(arr.flatMap(a=>a.symbols||[]))).sort();
    merged.push({ ...head, symbols });
  }
  for(const [k, arr] of noIdGroups.entries()){
    const head = arr[0];
    const symbols = Array.from(new Set(arr.flatMap(a=>a.symbols||[]))).sort();
    merged.push({ ...head, symbols });
  }

  // sort by publishedAt desc (null/empty last)
  merged.sort((a,b)=>{
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  // free intermediate structures to help GC
  try{
    for(const k of Object.keys(resultsPerSymbol)) delete resultsPerSymbol[k];
    failed.length = 0;
  }catch(e){}

  // attach non-enumerable diagnostics for tests

  return merged;
}

export default { fetchFinnhubCompanyNews, mapFinnhubNewsItem: mapFinnhubNewsItem, FinnhubNewsProviderError };
