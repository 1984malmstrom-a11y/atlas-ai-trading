/* Server-side Twelve Data provider implementation */
import path from 'path';
import type { MarketDataProvider, MarketQuote } from './types';
import { TRADABLE_INSTRUMENTS, findInstrumentById } from './instruments';
// Diagnostics file I/O is handled by a server-only helper to avoid client bundling.
// NOTE: do not import 'server-only' or `fs` at module top-level — this file
// is consumed by both server and client code paths. Diagnostics are handled
// best-effort via an in-memory server-side queue to avoid client bundle leaks.

  // Get FX rate from `fromCurrency` to SEK. Returns positive finite number or null on failure.

// Exported small parser for Twelve Data timestamps. Kept minimal and deterministic.
export function parseTwelveTimestamp(cand: any): Date | null {
  try{
    if (cand === null || cand === undefined || cand === '') return null;
    // numbers: detect seconds (10-digit) vs milliseconds (13-digit)
    if (typeof cand === 'number'){
      const n = Number(cand);
      if (!Number.isFinite(n)) return null;
      if (n > 1e12) return new Date(n); // ms
      return new Date(Math.floor(n * 1000)); // seconds
    }
    const s = String(cand).trim();
    if (/^[0-9]+$/.test(s)){
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      if (s.length === 13 || n > 1e12) return new Date(n);
      return new Date(Math.floor(n * 1000));
    }

    // Provider local datetime without offset (e.g. "2026-07-29 06:24:00")
    // When requests used timezone=UTC we must treat this as UTC (append 'Z')
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)){
      const iso = s.replace(' ', 'T') + 'Z';
      const d = new Date(iso);
      return isFinite(d.getTime()) ? d : null;
    }

    // Date only YYYY-MM-DD -> treat as UTC midnight
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)){
      const [y, m, day] = s.split('-').map(x => Number(x));
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(day)){
        return new Date(Date.UTC(y, m-1, day, 0, 0, 0));
      }
    }

    // ISO with Z or offset — let Date parse reliably
    const dAuto = new Date(s);
    return isFinite(dAuto.getTime()) ? dAuto : null;
  }catch(e){ return null; }
}

// --- Fundamental capability detection and lightweight adapters ---
export type FundamentalCapabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'PLAN_RESTRICTED' | 'SYMBOL_UNSUPPORTED' | 'PROVIDER_ERROR';
export type FundamentalCapabilities = {
  checkedAt: string;
  profile: FundamentalCapabilityStatus;
  statistics: FundamentalCapabilityStatus;
  incomeStatement: FundamentalCapabilityStatus;
  balanceSheet: FundamentalCapabilityStatus;
  cashFlow: FundamentalCapabilityStatus;
  earnings: FundamentalCapabilityStatus;
};

async function safeFetchJson(url: string, timeout = 7000): Promise<any>{
  const controller = new AbortController();
  const id = setTimeout(()=> controller.abort(), timeout);
  try{ const res = await fetch(url, { signal: controller.signal }); const txt = await res.text(); try{ return JSON.parse(txt); }catch(e){ return null; } }
  finally{ clearTimeout(id); }
}

function interpretTdErrorMessage(msg: string | undefined): FundamentalCapabilityStatus {
  if (!msg) return 'UNAVAILABLE';
  const m = String(msg || '').toLowerCase();
  if (m.includes('invalid symbol') || m.includes('unsupported symbol') || m.includes('not found')) return 'SYMBOL_UNSUPPORTED';
  if (m.includes('subscription') || m.includes('premium') || m.includes('plan')) return 'PLAN_RESTRICTED';
  return 'UNAVAILABLE';
}

export async function detectFundamentalCapabilities(symbol: string): Promise<FundamentalCapabilities> {
  try{
    const key = process.env.TWELVE_DATA_API_KEY;
    const checkedAt = new Date().toISOString();
    if (!key) return { checkedAt, profile: 'PROVIDER_ERROR', statistics: 'PROVIDER_ERROR', incomeStatement: 'PROVIDER_ERROR', balanceSheet: 'PROVIDER_ERROR', cashFlow: 'PROVIDER_ERROR', earnings: 'PROVIDER_ERROR' };
    const sym = encodeURIComponent(String(symbol || '').trim());
    if (!sym) return { checkedAt, profile: 'SYMBOL_UNSUPPORTED', statistics: 'SYMBOL_UNSUPPORTED', incomeStatement: 'SYMBOL_UNSUPPORTED', balanceSheet: 'SYMBOL_UNSUPPORTED', cashFlow: 'SYMBOL_UNSUPPORTED', earnings: 'SYMBOL_UNSUPPORTED' };

    const endpoints: [keyof Omit<FundamentalCapabilities,'checkedAt'>, string][] = [
      ['profile', `https://api.twelvedata.com/profile?symbol=${sym}&apikey=${key}`],
      ['statistics', `https://api.twelvedata.com/statistics?symbol=${sym}&apikey=${key}`],
      ['incomeStatement', `https://api.twelvedata.com/income_statement?symbol=${sym}&apikey=${key}&interval=annual&outputsize=1`],
      ['balanceSheet', `https://api.twelvedata.com/balance_sheet?symbol=${sym}&apikey=${key}&interval=annual&outputsize=1`],
      ['cashFlow', `https://api.twelvedata.com/cash_flow?symbol=${sym}&apikey=${key}&interval=annual&outputsize=1`],
      ['earnings', `https://api.twelvedata.com/earnings?symbol=${sym}&apikey=${key}`],
    ];

    const results = await Promise.all(endpoints.map(async ([k, url])=>{
      try{
        const data = await safeFetchJson(url, 7000);
        if (!data) return [k, 'UNAVAILABLE'] as const;
        if (data.status === 'error' || (data.message && typeof data.message === 'string')){
          const code = interpretTdErrorMessage(data.message || data.status || undefined);
          return [k, code] as const;
        }
        // Some endpoints return arrays or objects — treat non-empty as AVAILABLE
        const hasPayload = (Array.isArray(data) && data.length > 0) || (data && typeof data === 'object' && Object.keys(data).length > 0);
        return [k, hasPayload ? 'AVAILABLE' : 'UNAVAILABLE'] as const;
      }catch(e){ return [k, 'UNAVAILABLE'] as const; }
    }));

    const out: any = { checkedAt };
    for (const [k, v] of results){ out[k as string] = v; }
    // ensure all keys present
    return { checkedAt, profile: out.profile || 'UNAVAILABLE', statistics: out.statistics || 'UNAVAILABLE', incomeStatement: out.incomeStatement || 'UNAVAILABLE', balanceSheet: out.balanceSheet || 'UNAVAILABLE', cashFlow: out.cashFlow || 'UNAVAILABLE', earnings: out.earnings || 'UNAVAILABLE' };
  }catch(e){ return { checkedAt: new Date().toISOString(), profile: 'PROVIDER_ERROR', statistics: 'PROVIDER_ERROR', incomeStatement: 'PROVIDER_ERROR', balanceSheet: 'PROVIDER_ERROR', cashFlow: 'PROVIDER_ERROR', earnings: 'PROVIDER_ERROR' }; }
}

// Lightweight fetch adapters that return small typed objects or null on failure. Keep parsing defensive and numeric conversions safe.
function toNumberSafe(v: any): number | undefined { if (v === null || v === undefined || v === '') return undefined; const n = typeof v === 'number' ? v : Number(v); if (!Number.isFinite(n)) return undefined; return n; }

export async function fetchCompanyProfile(symbol: string): Promise<any | null> {
  try{
    const key = process.env.TWELVE_DATA_API_KEY; if (!key) return null;
    const sym = encodeURIComponent(String(symbol || '').trim()); if (!sym) return null;
    const url = `https://api.twelvedata.com/profile?symbol=${sym}&apikey=${key}`;
    const data = await safeFetchJson(url, 7000); if (!data) return null;
    if (data.status === 'error') return null;
    return { name: data.name || data.description, sector: data.sector, industry: data.industry, country: data.country, exchange: data.exchange, website: data.website };
  }catch(e){ return null; }
}

export async function fetchCompanyStatistics(symbol: string): Promise<any | null> {
  try{
    const key = process.env.TWELVE_DATA_API_KEY; if (!key) return null;
    const sym = encodeURIComponent(String(symbol || '').trim()); if (!sym) return null;
    const url = `https://api.twelvedata.com/statistics?symbol=${sym}&apikey=${key}`;
    const data = await safeFetchJson(url, 7000); if (!data) return null;
    if (data.status === 'error') return null;
    // map selected fields
    const out: any = {};
    out.currency = data.currency || data.fiscal_currency;
    out.revenue = toNumberSafe(data.revenue ?? data.total_revenue ?? data.annual_revenue);
    out.netIncome = toNumberSafe(data.net_income ?? data.netprofit ?? data.net_profit);
    out.grossMarginPercent = toNumberSafe(data.gross_margin ?? data.grossMargin ?? data.gross_margin_percent);
    out.operatingMarginPercent = toNumberSafe(data.operating_margin ?? data.operatingMargin ?? data.operating_margin_percent);
    out.netMarginPercent = toNumberSafe(data.net_margin ?? data.netMargin ?? data.net_margin_percent);
    out.returnOnEquityPercent = toNumberSafe(data.return_on_equity ?? data.returnOnEquity ?? data.roe);
    out.debtToEquity = toNumberSafe(data.debt_to_equity ?? data.debtToEquity ?? data.debt_equity_ratio);
    out.currentRatio = toNumberSafe(data.current_ratio ?? data.currentRatio);
    out.interestCoverage = toNumberSafe(data.interest_coverage ?? data.ebit_interest_coverage);
    out.marketCapitalization = toNumberSafe(data.market_capitalization ?? data.market_cap ?? data.marketCapitalization);
    out.trailingPe = toNumberSafe(data.pe ?? data.trailing_pe ?? data.trailingPe);
    out.forwardPe = toNumberSafe(data.forward_pe ?? data.forwardPe);
    return out;
  }catch(e){ return null; }
}

async function fetchSingleAnnualEndpoint(symbol: string, endpoint: string): Promise<any[] | null> {
  try{
    const key = process.env.TWELVE_DATA_API_KEY; if (!key) return null;
    const sym = encodeURIComponent(String(symbol || '').trim()); if (!sym) return null;
    const url = `${endpoint}?symbol=${sym}&apikey=${key}&interval=annual&outputsize=5`;
    const data = await safeFetchJson(url, 8000); if (!data) return null;
    if (data.status === 'error') return null;
    const values = Array.isArray(data.values) ? data.values : (Array.isArray(data.data) ? data.data : []);
    if (!Array.isArray(values) || values.length === 0) return null;
    // Normalize to array oldest->newest
    const out = values.slice().map((v:any)=> v).filter(Boolean);
    return out.length ? out : null;
  }catch(e){ return null; }
}

export async function fetchIncomeStatement(symbol: string): Promise<any[] | null> { return fetchSingleAnnualEndpoint(symbol, 'https://api.twelvedata.com/income_statement'); }
export async function fetchBalanceSheet(symbol: string): Promise<any[] | null> { return fetchSingleAnnualEndpoint(symbol, 'https://api.twelvedata.com/balance_sheet'); }
export async function fetchCashFlow(symbol: string): Promise<any[] | null> { return fetchSingleAnnualEndpoint(symbol, 'https://api.twelvedata.com/cash_flow'); }

export async function fetchEarnings(symbol: string): Promise<any[] | null> {
  try{
    const key = process.env.TWELVE_DATA_API_KEY; if (!key) return null;
    const sym = encodeURIComponent(String(symbol || '').trim()); if (!sym) return null;
    const url = `https://api.twelvedata.com/earnings?symbol=${sym}&apikey=${key}&outputsize=5`;
    const data = await safeFetchJson(url, 7000); if (!data) return null;
    if (data.status === 'error') return null;
    const values = Array.isArray(data.values) ? data.values : (Array.isArray(data.data) ? data.data : []);
    if (!Array.isArray(values) || values.length === 0) return null;
    return values.slice();
  }catch(e){ return null; }
}


// Extracted quote parser so batch-mapping and class methods can share logic.
export function parseQuoteResponse(raw: any, instrumentId: string): MarketQuote {
  // reuse logic from former class method
  const price = Number(raw.price ?? raw.close ?? raw.last_price ?? NaN);
  const prev = Number(raw.previous_close ?? raw.prev_close ?? raw.close_prev ?? raw.close ?? NaN);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid price from provider');
  const change = Number.isFinite(Number(raw.change)) ? Number(raw.change) : (Number.isFinite(price) && Number.isFinite(prev) ? price - prev : 0);
  const changePct = Number.isFinite(Number(raw.percent_change)) ? Number(raw.percent_change) : (Number.isFinite(prev) && prev !== 0 ? (price - prev) / prev * 100 : 0);
  const sym = String(raw.symbol || raw.ticker || '').toUpperCase();
  const exchange = String(raw.exchange || raw.exchange_short || '').toUpperCase() || 'UNKNOWN';
  const name = String(raw.name || '');
  const currency = String(raw.currency || raw.currency_base || raw.currency_quote || '').toUpperCase() || 'UNKNOWN';
  // pick best timestamp candidates
  const tsCandidates = [raw.last_quote_at, raw.last_trade_time, raw.updated_at, raw.timestamp, raw.datetime, raw.status_time, raw.ts, raw.datetime_utc];
  let tsDate: Date | null = null;
  for (const cand of tsCandidates){
    if (cand === null || cand === undefined || cand === '') continue;
    try{ const parsed = parseTwelveTimestamp(cand); if (parsed){ tsDate = parsed; break; } }catch(e){ }
  }
  if (!tsDate) tsDate = new Date();
  const timestamp = tsDate.toISOString();
  const isStale = (()=>{ try{ const ageSec = (Date.now() - tsDate.getTime())/1000; return ageSec > 120; }catch(e){ return true; } })();
  const dataStatus: 'REALTIME' | 'DELAYED' | 'UNKNOWN' = ((): any => {
    try{ if (raw.is_market_open === true) return 'REALTIME'; if (raw.is_market_open === false) return 'DELAYED'; if (raw.is_realtime === true || raw.is_realtime === 'true') return 'REALTIME'; return 'UNKNOWN'; }catch(e){ return 'UNKNOWN'; }
  })();

  return {
    instrumentId,
    symbol: sym || instrumentId,
    exchange,
    name,
    price: price,
    previousClose: Number(prev) || 0,
    change: Number(change) || 0,
    changePercent: Number(changePct) || 0,
    currency,
    timestamp,
    source: 'twelve-data',
    isStale,
    dataStatus,
  };
}

// Robust mapper that handles multiple Twelve Data batch response shapes and returns parsed MarketQuote[]
export function mapProviderBatchResponse(data: any, idToSymbol: Map<string,string>): any[] {
  const out: any[] = [];
  // Build reverse lookup: providerSymbolUpper -> instrumentId
  const providerToId = new Map<string,string>();
  for (const [id, sym] of idToSymbol.entries()){
    if (sym) providerToId.set(String(sym).toUpperCase(), id);
    providerToId.set(String(id).toUpperCase(), id); // allow instrument id as fallback key
  }

  // Helper to try to resolve a provider object to instrument id
  const resolveAndParse = (rawObj: any, providerKeyCandidate?: string) => {
    try{
      // read possible symbol fields
      const fields = [rawObj.symbol, rawObj.ticker, providerKeyCandidate, rawObj.requestedSymbol, rawObj.exchange_symbol, rawObj.s];
      for (const f of fields){
        if (!f) continue;
        const up = String(f).toUpperCase();
        const id = providerToId.get(up);
        if (id){
          const parsed: any = parseQuoteResponse(rawObj, id) as any;
          // ensure providerSymbol is set on output
          try{ if (!parsed.provider) parsed.provider = 'twelve-data'; }catch(_){ }
          try{ parsed.providerSymbol = (idToSymbol.get(id) || up); }catch(_){ parsed.providerSymbol = up; }
          return parsed;
        }
      }
      return null;
    }catch(e){ return null; }
  };

  // Case 1: array of quote objects
  if (Array.isArray(data)){
    for (const d of data){
      const p = resolveAndParse(d);
      if (p) out.push(p);
    }
    return out;
  }

  // Case 2: object keyed by provider symbols or instrument ids (e.g. { MSFT: {...}, AAPL: {...} })
  if (data && typeof data === 'object'){
    // If object directly represents a single quote (has symbol), try parsing it first
    if (data.symbol || data.ticker || data.price || data.close){
      const p = resolveAndParse(data);
      if (p) out.push(p);
      return out;
    }

    // Otherwise iterate keys
    for (const key of Object.keys(data)){
      try{
        const val = (data as any)[key];
        if (!val) continue;
        // key might be providerSymbol; try parse with key as hint
        const p = resolveAndParse(val, key);
        if (p) out.push(p);
      }catch(e){ continue; }
    }
    return out;
  }

  // Unknown shape -> return empty (caller may fall back to per-id fetch)
  return out;
}

type TDSearchResult = {
  symbol: string;
  exchange: string;
  currency: string;
  name?: string;
};

// Public symbol lookup: validate an exact configured provider symbol without exposing raw provider payloads
export async function lookupTwelveSymbolExact(providerSymbol: string, timeout = 8000): Promise<{ found: boolean; exactMatch: boolean; assetType?: string; exchange?: string; error?: string | null }>{
  try{
    if (!providerSymbol || typeof providerSymbol !== 'string') return { found: false, exactMatch: false, error: 'PROVIDER_ERROR' };
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) return { found: false, exactMatch: false, error: 'PROVIDER_ERROR' };
    const sym = String(providerSymbol).trim();
    if (!sym) return { found: false, exactMatch: false, error: 'PROVIDER_ERROR' };
    const q = encodeURIComponent(sym);
    const url = `https://api.twelvedata.com/symbol_search?symbol=${q}&apikey=${key}`;
    const controller = new AbortController();
    const id = setTimeout(()=> controller.abort(), timeout);
    let res: any = null;
    try{ res = await fetch(url, { signal: controller.signal }); }catch(e){ return { found: false, exactMatch: false, error: 'PROVIDER_ERROR' }; }finally{ clearTimeout(id); }
    if (!res || !res.ok) return { found: false, exactMatch: false, error: 'PROVIDER_ERROR' };
    let data: any = null;
    try{ data = await res.json(); }catch(e){ return { found: false, exactMatch: false, error: 'PROVIDER_ERROR' }; }
    const candidates: any[] = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
    if (!Array.isArray(candidates) || candidates.length === 0) return { found: false, exactMatch: false, error: null };
    // try to find exact symbol match (case-insensitive)
    const upper = sym.toUpperCase();
    for (const c of candidates){
      try{
        const csym = String(c.symbol || c.exchange_symbol || c.ticker || '').toUpperCase().trim();
        if (csym === upper){
          const assetType = (c.type || c.asset_type || c.instrument_type || c.security_type || c.category || '') as string;
          const exchange = String(c.exchange || c.exchange_short || c.region || '').trim() || undefined;
          return { found: true, exactMatch: true, assetType: assetType || undefined, exchange: exchange || undefined, error: null };
        }
      }catch(e){ continue; }
    }
    // candidates exist but none matched exactly
    return { found: true, exactMatch: false, error: null };
  }catch(e){ return { found: false, exactMatch: false, error: 'PROVIDER_ERROR' }; }
}

export type TwelveSymbolCandidate = {
  symbol: string;
  instrumentName?: string;
  instrumentType?: string;
  exchange?: string;
  country?: string;
};
// Internal: normalize a raw provider candidate to our public TwelveSymbolCandidate shape.
function normalizeTdCandidate(raw: any): TwelveSymbolCandidate | null {
  try{
    if (!raw || typeof raw !== 'object') return null;
    // Accept many possible field names
    const symbol = String(raw.symbol || raw.exchange_symbol || raw.ticker || raw.s || raw.code || '').trim();
    if (!symbol) return null;
    const instrumentName = String(raw.instrument_name || raw.instrumentName || raw.name || raw.title || raw.description || '').trim() || undefined;
    const instrumentType = String(raw.instrument_type || raw.instrumentType || raw.type || raw.security_type || raw.category || '').trim() || undefined;
    const exchange = String(raw.exchange || raw.exchange_short || raw.region || raw.mic_code || '').trim() || undefined;
    const country = String(raw.country || raw.region || raw.country_code || '').trim() || undefined;
    return {
      symbol: symbol.toUpperCase(),
      instrumentName: instrumentName || undefined,
      instrumentType: instrumentType || undefined,
      exchange: exchange || undefined,
      country: country || undefined,
    };
  }catch(e){ return null; }
}

export async function searchTwelveSymbolCandidates(query: string, timeout = 8000): Promise<TwelveSymbolCandidate[]>{
  try{
    const q = String(query || '').trim();
    if (!q) return [];
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) return [];
    const encoded = encodeURIComponent(q);
    const url = `https://api.twelvedata.com/symbol_search?symbol=${encoded}&apikey=${key}`;
    const controller = new AbortController();
    const id = setTimeout(()=> controller.abort(), timeout);
    let res: any = null;
    try{ res = await fetch(url, { signal: controller.signal }); }catch(e){ return []; }finally{ clearTimeout(id); }
    if (!res || !res.ok) return [];
    let data: any = null;
    try{ data = await res.json(); }catch(e){ return []; }
    const candidatesRaw: any[] = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
    if (!Array.isArray(candidatesRaw) || candidatesRaw.length === 0) return [];
    const seen = new Set<string>();
    const out: TwelveSymbolCandidate[] = [];
    for (const raw of candidatesRaw){
      try{
        const c = normalizeTdCandidate(raw);
        if (!c) continue;
        const keyId = (c.symbol + '|' + (c.exchange || '')).toUpperCase();
        if (seen.has(keyId)) continue;
        seen.add(keyId);
        out.push(c);
        if (out.length >= 10) break;
      }catch(e){ continue; }
    }
    return out;
  }catch(e){ return []; }
}

export class TwelveDataMarketDataProvider implements MarketDataProvider {
  private apiKey: string;
  private ttlMs = 45_000;
  private cache = new Map<string, { expires: number; v: MarketQuote }>();
  private pending = new Map<string, Promise<MarketQuote>>();
  // FX cache and pending promises for in-flight deduplication
  private fxTtlMs = 5 * 60_000; // 5 minutes
  // cache richer FX payloads: { rate, previous_close?, change?, percent_change?, open?, timestamp? }
  private fxCache = new Map<string, { expires: number; v: any }>();
  private fxPending = new Map<string, Promise<any | null>>();
  // daily reference cache (time_series) to avoid fetching every poll — 6 hours TTL
  private fxDailyTtlMs = 6 * 60 * 60_000; // 6 hours
  private fxDailyCache = new Map<string, { expires: number; v: any }>();
  private fxDailyPending = new Map<string, Promise<any | null>>();
  // historical time_series cache for daily closes: key -> { expires, v }
  private histTtlMs = 6 * 60 * 60_000; // 6 hours
  private histCache = new Map<string, { expires: number; v: { symbol: string; closes: number[]; dates: string[]; source: string; fetchedAt: string } }>();
  private histPending = new Map<string, Promise<any>>();
  // intraday cache and in-flight dedupe per symbol|interval
  private intradayTtlMs = 3 * 60 * 1000; // 3 minutes
  private intradayCache = new Map<string, { expires: number; v: { symbol: string; interval: string; fetchedAt: string; candles: any[] } }>();
  private intradayPending = new Map<string, Promise<any>>();

  constructor(){
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) throw new Error('TWELVE_DATA_API_KEY must be set on server');
    this.apiKey = key;
  }

  // Fetch intraday candles using Twelve Data time_series endpoint (5min|15min). Returns normalized candles oldest->newest
  async getIntradayCandles(providerSymbol: string, interval: '5min' | '15min', limit = 64, timeout = 10_000) {
    try{
      if (!providerSymbol || typeof providerSymbol !== 'string') throw Object.assign(new Error('Invalid symbol'), { code: 'UNSUPPORTED_SYMBOL' });
      const sym = String(providerSymbol).toUpperCase();
      if (interval !== '5min' && interval !== '15min') throw Object.assign(new Error('Invalid interval'), { code: 'INVALID_INTERVAL' });
      // clamp limit
      const lim = Math.max(20, Math.min(96, Math.floor(Number(limit) || 64)));
      const key = `${sym}|${interval}|${lim}`;
      const cached = this.intradayCache.get(key);
      if (cached && cached.expires > Date.now()) return cached.v;
      const pending = this.intradayPending.get(key);
      if (pending) return pending;

      const p = (async ()=>{
        try{
          const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${interval}&outputsize=${lim}&timezone=UTC&apikey=${this.apiKey}`;
          const res = await this.fetchWithTimeout(url, timeout).catch(e=>{ throw Object.assign(new Error('INTRADAY_TIMEOUT'), { code: 'INTRADAY_TIMEOUT' }); });
          if (!res.ok){ if (res.status === 429) throw Object.assign(new Error('Rate limited'), { code: 'INTRADAY_RATE_LIMITED' }); throw Object.assign(new Error(`Provider status ${res.status}`), { code: 'INTRADAY_PROVIDER_UNAVAILABLE' }); }
          const data = await res.json().catch(()=> null);
          if (!data) throw Object.assign(new Error('Invalid provider response'), { code: 'INTRADAY_PAYLOAD_INVALID' });
          if (data.status === 'error'){
            const msg = String(data.message || 'provider error');
            if (/Invalid symbol/i.test(msg) || /not found/i.test(msg)) throw Object.assign(new Error('Unsupported symbol'), { code: 'UNSUPPORTED_SYMBOL' });
            throw Object.assign(new Error('Provider error'), { code: 'INTRADAY_PROVIDER_UNAVAILABLE' });
          }

          const values = Array.isArray(data.values) ? data.values : (Array.isArray(data.data) ? data.data : []);
          if (!Array.isArray(values)) throw Object.assign(new Error('Invalid provider payload'), { code: 'INTRADAY_PAYLOAD_INVALID' });

          // Build records preserving original index so duplicates keep last-seen
          const records: { ts: string; tsDate: Date; open: number; high: number; low: number; close: number; volume: number | null; idx: number }[] = [];
          const now = Date.now();
          for (let i = 0; i < values.length; i++){
            const it = values[i];
            if (!it) continue;
            // read fields defensively
            const rawTs = it.datetime ?? it.timestamp ?? it.time ?? it.dt ?? it.datetime_utc ?? it.datetimeEpoch ?? it.datetime_epoch ?? null;
            const dt = rawTs === null ? null : parseTwelveTimestamp(rawTs);
            if (!dt) continue; // invalid timestamp
            // reject far-future beyond 2 minutes
            if (dt.getTime() > now + 2*60*1000) continue;
            const openRaw = it.open ?? it.o ?? null; const highRaw = it.high ?? it.h ?? null; const lowRaw = it.low ?? it.l ?? null; const closeRaw = it.close ?? it.c ?? null; const volRaw = it.volume ?? it.v ?? it.vol ?? null;
            const open = typeof openRaw === 'string' ? Number(openRaw) : Number(openRaw);
            const high = typeof highRaw === 'string' ? Number(highRaw) : Number(highRaw);
            const low = typeof lowRaw === 'string' ? Number(lowRaw) : Number(lowRaw);
            const close = typeof closeRaw === 'string' ? Number(closeRaw) : Number(closeRaw);
            let volume: number | null = null;
            if (volRaw !== null && volRaw !== undefined){ const v = typeof volRaw === 'string' ? Number(volRaw) : Number(volRaw); if (Number.isFinite(v) && v >= 0) volume = v; else volume = null; }
            if (!this.isValidNumber(open) || open <= 0) continue;
            if (!this.isValidNumber(high) || high <= 0) continue;
            if (!this.isValidNumber(low) || low <= 0) continue;
            if (!this.isValidNumber(close) || close <= 0) continue;
            // relational checks
            if (!(high >= open && high >= close && high >= low)) continue;
            if (!(low <= open && low <= close)) continue;
            records.push({ ts: dt.toISOString(), tsDate: dt, open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume, idx: i });
          }

          if (records.length === 0) throw Object.assign(new Error('No valid candles'), { code: 'INTRADAY_NO_VALID_CANDLES' });

          // Collapse duplicates keeping the last seen (higher idx), sort oldest->newest
          // Map timestamp -> record (keep later idx)
          const mapByTs = new Map<string, { rec: any; idx: number }>();
          for (const r of records){ const ex = mapByTs.get(r.ts); if (!ex || r.idx >= ex.idx) mapByTs.set(r.ts, { rec: r, idx: r.idx }); }
          const tsList = Array.from(mapByTs.keys()).sort((a,b)=> a < b ? -1 : a > b ? 1 : 0);
          const candles = tsList.map(ts => {
            const r = mapByTs.get(ts)!.rec;
            return { timestamp: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume };
          });

          const out = { symbol: sym, interval, fetchedAt: new Date().toISOString(), candles };
          this.intradayCache.set(key, { expires: Date.now() + this.intradayTtlMs, v: out });
          return out;
        }catch(e){
          // Normalize thrown errors into stable error codes
          if (e && (e as any).code) throw e;
          throw Object.assign(new Error('INTRADAY_PROVIDER_UNAVAILABLE'), { code: 'INTRADAY_PROVIDER_UNAVAILABLE' });
        }finally{ this.intradayPending.delete(key); }
      })();

      this.intradayPending.set(key, p as Promise<any>);
      return p;
    }catch(e){ throw e; }
  }

  // Public: fetch normalized daily closes for a provider symbol (e.g. 'MSFT')
  // Returns { symbol, closes[], dates[], source: 'twelve-data', fetchedAt }
  async getHistoricalDailyCloses(providerSymbol: string, outputSize = 100, timeout = 10_000) {
    if (!providerSymbol || typeof providerSymbol !== 'string') throw Object.assign(new Error('Invalid symbol'), { code: 'UNSUPPORTED_SYMBOL' });
    const sym = String(providerSymbol).toUpperCase();
    const key = `${sym}:${outputSize}`;
    const cached = this.histCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.v;
    const pending = this.histPending.get(key);
    if (pending) return pending;

    const p = (async ()=>{
      try{
        const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=${Number(outputSize)}&timezone=UTC&apikey=${this.apiKey}`;
        const res = await this.fetchWithTimeout(url, timeout);
        if (!res.ok){
          if (res.status === 429) throw Object.assign(new Error('Rate limit from provider'), { code: 'RATE_LIMIT' });
          throw Object.assign(new Error(`Provider returned status ${res.status}`), { code: 'PROVIDER_ERROR' });
        }
        const data = await res.json();
        if (!data) throw Object.assign(new Error('Empty provider response'), { code: 'INVALID_RESPONSE' });
        if (data.status === 'error'){
          const msg = String(data.message || JSON.stringify(data));
          if (/Invalid symbol/i.test(msg) || /not found/i.test(msg)) throw Object.assign(new Error('Unsupported symbol'), { code: 'UNSUPPORTED_SYMBOL', message: msg });
          throw Object.assign(new Error(msg), { code: 'PROVIDER_ERROR' });
        }

        const values = Array.isArray(data.values) ? data.values : (Array.isArray(data.data) ? data.data : []);
        if (!Array.isArray(values)) throw Object.assign(new Error('Invalid provider response structure'), { code: 'INVALID_RESPONSE' });

        // Normalize: values[0] is newest — drop today's incomplete candle if present
        const items = values.slice();
        // Build (date, close) pairs, filter invalid/negative prices
              // Build (date, close, volume?) pairs, filter invalid/negative prices; accept numeric strings for close/volume
              const pairs: { date: string; close: number; volume?: number | null }[] = [];
              for (const it of items){
                const rawDate = (it.datetime || it.date || it.timestamp || '').toString();
                const closeRaw = it.close ?? it.c ?? it.value ?? null;
                const volumeRaw = it.volume ?? it.v ?? it.vol ?? null;
                const close = typeof closeRaw === 'string' ? Number(closeRaw) : Number(closeRaw);
                let volume: number | null = null;
                if (volumeRaw !== null && volumeRaw !== undefined){
                  const parsed = typeof volumeRaw === 'string' ? Number(volumeRaw) : Number(volumeRaw);
                  if (Number.isFinite(parsed) && parsed >= 0) volume = parsed;
                  else volume = null;
                }
                if (!rawDate || !Number.isFinite(close) || close <= 0) continue; // ignore rows without valid close
                // Normalize to YYYY-MM-DD (first 10 chars) if possible
                const cand = rawDate.length >= 10 ? rawDate.slice(0,10) : rawDate;
                // Accept only valid YYYY-MM-DD strings
                if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(cand)) continue;
                pairs.push({ date: cand, close, volume });
              }

        if (pairs.length === 0) throw Object.assign(new Error('No valid historical values'), { code: 'INSUFFICIENT_HISTORY' });

        // Deterministic UTC rule: exclude today's UTC date and any future dates
        const todayUtc = new Date().toISOString().slice(0,10);

        const filtered = pairs.filter(p => {
          // Exclude non-YYYY-MM-DD already removed; exclude today's UTC date and any future dates
          if (p.date >= todayUtc) return false;
          return true;
        });

        // Remove duplicates keeping the last seen (newest) for a date, then sort oldest->newest
        const byDateClose = new Map<string, number>();
        const byDateVolume = new Map<string, number | null>();
        for (const p of filtered){ byDateClose.set(p.date, p.close); byDateVolume.set(p.date, (p.volume !== undefined ? p.volume : null)); }
        const sortedDates = Array.from(byDateClose.keys()).sort((a,b)=> a < b ? -1 : a > b ? 1 : 0);
        const closes = sortedDates.map(d => byDateClose.get(d) as number);
        const volumes = sortedDates.map(d => byDateVolume.has(d) ? (byDateVolume.get(d) as number | null) : null);

        // Ensure at least 20 completed days after filtering
        if (closes.length < 20) throw Object.assign(new Error(`Insufficient history: have ${closes.length}`), { code: 'INSUFFICIENT_HISTORY' });

        // Only return volumes if we have enough valid lined volume values (all entries must be valid numbers)
        const validVolumeCount = volumes.filter(v => Number.isFinite(v) && (v as number) >= 0).length;
        const out: any = { symbol: sym, closes, dates: sortedDates, source: 'twelve-data', fetchedAt: new Date().toISOString() };
        if (validVolumeCount === volumes.length && validVolumeCount >= 10){ out.volumes = volumes.map(v => Number(v)); }
        this.histCache.set(key, { expires: Date.now() + this.histTtlMs, v: out });
        return out;
      }finally{ this.histPending.delete(key); }
    })();

    this.histPending.set(key, p as Promise<any>);
    return p;
  }

  private async fetchWithTimeout(url: string, timeout = 8_000){
    const controller = new AbortController();
    const id = setTimeout(()=> controller.abort(), timeout);
    try{
      const res = await fetch(url, { signal: controller.signal });
      return res;
    }finally{ clearTimeout(id); }
  }

  private isValidNumber(n: any){ return typeof n === 'number' && Number.isFinite(n) && !Number.isNaN(n); }

  private async resolveProviderSymbolByName(name: string, exchangeHint?: string): Promise<TDSearchResult | null> {
    // Use Twelve Data symbol search endpoint
    const q = encodeURIComponent(name);
    const url = `https://api.twelvedata.com/symbol_search?symbol=${q}&apikey=${this.apiKey}`;
    const res = await this.fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Twelve Data search failed: ${res.status}`);
    const data = await res.json();
    // data may have 'data' array or be an object map; normalize
    const candidates: any[] = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
    for (const c of candidates){
      try{
        const sym = String(c.symbol || c.exchange_symbol || c.ticker || '').trim();
        const ex = String(c.exchange || c.exchange_short || c.region || '').trim();
        const cur = String(c.currency || c.currency_base || c.currency_quote || '').trim();
        if (!sym) continue;
        if (exchangeHint && ex && !ex.toUpperCase().includes(String(exchangeHint).toUpperCase())) continue;
        return { symbol: sym, exchange: ex || 'UNKNOWN', currency: cur || 'UNKNOWN', name: String(c.name || name) };
      }catch(e){ continue; }
    }
    return null;
  }



  private cacheSet(key: string, v: MarketQuote){ this.cache.set(key, { expires: Date.now() + this.ttlMs, v }); }
  private cacheGet(key: string){ const e = this.cache.get(key); if (!e) return undefined; if (e.expires < Date.now()){ this.cache.delete(key); return undefined; } return e.v; }

  async getQuote(instrumentId: string): Promise<MarketQuote> {
    const inst = findInstrumentById(instrumentId);
    if (!inst) throw new Error(`Unknown instrumentId: ${instrumentId}`);

    // check cache
    const cached = this.cacheGet(instrumentId);
    if (cached) return cached;

    // deduplicate pending
    const pending = this.pending.get(instrumentId);
    if (pending) return pending;

    const promise = (async ()=>{
      try{
        // if providerSymbol missing, attempt verification
        let providerSymbol = inst.providerSymbol;
        if (!providerSymbol){
          const found = await this.resolveProviderSymbolByName(inst.name, inst.exchange);
          if (!found) throw new Error(`Unable to verify provider symbol for ${inst.name}`);
          providerSymbol = found.symbol;
        }

        // fetch quote
        const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(providerSymbol)}&apikey=${this.apiKey}`;
        const diagBase: any = { requestedSymbol: providerSymbol, providerSymbol, instrumentId, timestamp: new Date().toISOString() };
        let httpStatus: number | null = null;
        let providerErrorCode: string | null = null;
        let providerErrorMessage: string | null = null;
        let responseFieldNames: string[] = [];
        let rawPriceValue: any = null;
        let parsedPrice: number | null = null;
        let rawTimestampValue: any = null;
        let parsedTimestamp: string | null = null;
        let timestampUnitDetected: string | null = null;
        let quoteAgeSeconds: number | null = null;
        let stale = true;
        let finalRuntimeKey: string | null = providerSymbol;
        let accepted = false;

        const res = await this.fetchWithTimeout(url).catch(e=>{ throw e; });
        httpStatus = res && typeof res.status === 'number' ? res.status : null;
        let data: any = null;
        try{ data = await res.json(); }catch(e){ data = null; }
        if (data && typeof data === 'object') responseFieldNames = Object.keys(data);
        // Avoid logging full payload. Extract candidate price/timestamp fields only
        rawPriceValue = data ? (data.price ?? data.close ?? data.last_price ?? data.close_price ?? null) : null;
        rawTimestampValue = data ? (data.last_quote_at ?? data.last_trade_time ?? data.updated_at ?? data.timestamp ?? data.datetime ?? data.ts ?? null) : null;

        // detect timestamp unit
        try{
          if (rawTimestampValue !== null && rawTimestampValue !== undefined){
            if (typeof rawTimestampValue === 'number'){
              if (rawTimestampValue > 1e12) timestampUnitDetected = 'milliseconds';
              else if (rawTimestampValue > 1e9) timestampUnitDetected = 'seconds';
              else timestampUnitDetected = 'seconds';
              const ms = (timestampUnitDetected === 'milliseconds') ? Number(rawTimestampValue) : Math.floor(Number(rawTimestampValue) * 1000);
              const dt = new Date(ms);
              if (isFinite(dt.getTime())){ parsedTimestamp = dt.toISOString(); quoteAgeSeconds = Math.round((Date.now()-dt.getTime())/1000); stale = quoteAgeSeconds > 120; }
            } else {
              const dt = new Date(String(rawTimestampValue));
              if (isFinite(dt.getTime())){ parsedTimestamp = dt.toISOString(); quoteAgeSeconds = Math.round((Date.now()-dt.getTime())/1000); stale = quoteAgeSeconds > 120; timestampUnitDetected = 'iso'; }
            }
          }
        }catch(e){ /* swallow */ }

        // parse numerical price candidate
        try{ parsedPrice = rawPriceValue === null || rawPriceValue === undefined ? null : Number(rawPriceValue); if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) parsedPrice = null; }catch(e){ parsedPrice = null; }

        // evaluate acceptance
        accepted = parsedPrice !== null && parsedPrice > 0 && parsedTimestamp !== null && stale === false && typeof httpStatus === 'number' && httpStatus >= 200 && httpStatus < 300;

        // capture provider-level errors
        if (!res.ok){ providerErrorMessage = `HTTP ${res.status}`; providerErrorCode = 'HTTP_ERROR'; }
        if (data && data.status === 'error'){ providerErrorCode = (data.code && String(data.code)) || providerErrorCode || 'PROVIDER_ERROR'; providerErrorMessage = String(data.message || JSON.stringify(data)); }

        // append diagnostic only for NVDA instrument to avoid noise
        try{
          if (String(instrumentId).toLowerCase() === 'nvidia' || String(providerSymbol).toUpperCase() === 'NVDA'){
            const diag = Object.assign({}, diagBase, { httpStatus, providerErrorCode, providerErrorMessage, responseFieldNames, rawPriceValue, parsedPrice, rawTimestampValue, parsedTimestamp, timestampUnitDetected, quoteAgeSeconds, stale: !!stale, instrumentId, finalRuntimeKey, accepted });
            if (typeof window === 'undefined'){
              try{
                // Best-effort diagnostics: avoid importing server-only modules from
                // a module that is included in both server and client bundles.
                // Keep diagnostics in-memory on the server so failures don't block
                // provider behavior. A separate server-only persistence hook may
                // pick up these diagnostics if available.
                try{ (globalThis as any).__twelveDiagnostics = (globalThis as any).__twelveDiagnostics || []; (globalThis as any).__twelveDiagnostics.push(diag); }catch(_){ }
              }catch(e){
                // keep provider behavior unchanged if diagnostics fail
              }
            }
          }
        }catch(e){}

        if (!res.ok) throw new Error(`Twelve Data quote request failed: ${res.status}`);
        if (data && data.status === 'error') throw new Error(String(data.message || JSON.stringify(data)));
        const q = parseQuoteResponse(data, instrumentId);
        // mark instrument enabled once we've successfully verified a real quote
        try{ const instRef = findInstrumentById(instrumentId); if (instRef) instRef.enabled = true; }catch(e){}
        this.cacheSet(instrumentId, q);
        return q;
      }finally{ this.pending.delete(instrumentId); }
    })();

    this.pending.set(instrumentId, promise);
    return promise;
  }

  async getQuotes(instrumentIds: string[]): Promise<MarketQuote[]> {
    const out: MarketQuote[] = [];
    // Respect Twelve Data batch capability by attempting to build a comma list for verified provider symbols
    const toFetchIds: string[] = [];
    const idToSymbol = new Map<string,string>();

    for (const id of instrumentIds){
      const inst = findInstrumentById(id);
      if (!inst) throw new Error(`Unknown instrumentId: ${id}`);
      const c = this.cacheGet(id);
      if (c) out.push(c);
      else toFetchIds.push(id);
    }

    if (toFetchIds.length === 0) return out;

    // Resolve provider symbols (sequential to avoid aggressive parallelism)
    for (const id of toFetchIds){
      const inst = findInstrumentById(id)!;
      if (!inst.providerSymbol){
        try{
          const found = await this.resolveProviderSymbolByName(inst.name, inst.exchange);
          if (found) inst.providerSymbol = found.symbol; else inst.enabled = false;
        }catch(e){ inst.enabled = false; }
      }
      if (inst.enabled && inst.providerSymbol) idToSymbol.set(id, inst.providerSymbol);
    }

    // Group symbols for batch call
    const symbols = Array.from(idToSymbol.values()).map(s => s.toUpperCase());
    if (symbols.length > 0){
      const chunk = symbols.join(',');
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(chunk)}&apikey=${this.apiKey}`;
      const res = await this.fetchWithTimeout(url);
      if (res.ok){
        const data = await res.json();
        try{
          // Use robust batch mapping helper to extract per-instrument quotes without dropping others on errors
          const mapped = mapProviderBatchResponse(data, idToSymbol);
          for (const item of mapped){ this.cacheSet(item.instrumentId, item); out.push(item); }
        }catch(e){ /* preserve fallback behavior — continue to per-id fetch below */ }
      }
    }

    // For any remaining ids without cached quote, fetch sequentially with dedup
    for (const id of toFetchIds){ if (!this.cacheGet(id)){
      try{ const q = await this.getQuote(id); out.push(q); }catch(e){ /* skip errors here, allow partial results */ }
    }}

    return out;
  }

  // Get FX rate from `fromCurrency` to SEK. Returns positive finite number or null on failure.
  async getFxRate(fromCurrency: string, toCurrency: 'SEK'): Promise<any | null> {
    try{
      const from = String(fromCurrency || '').toUpperCase();
      const to = String(toCurrency || '').toUpperCase();
      if (to !== 'SEK') return null;
      if (!from) return null;
      if (from === 'SEK') return 1;

      const key = `${from}->${to}`;
      // check cache
      const cached = this.fxCache.get(key);
      if (cached && cached.expires > Date.now()) return cached.v;

      // dedupe pending
      const pending = this.fxPending.get(key);
      if (pending) return pending;

      const p = (async ()=>{
        try{
          // Use the dedicated exchange_rate endpoint and parse only the `rate` field
          const sym = `${from}/${to}`;
          const url = `https://api.twelvedata.com/exchange_rate?symbol=${encodeURIComponent(sym)}&apikey=${this.apiKey}`;
          const res = await this.fetchWithTimeout(url);
          if (!res.ok) return null;
          const data = await res.json();
          if (data && data.status === 'error') return null;
          const rate = Number(data?.rate);
          if (!this.isValidNumber(rate) || rate <= 0) return null;
          // assemble richer payload if provider returned fields like previous_close/percent_change/change/open
          const payload: any = { rate: Number(rate) };
          if (data?.previous_close !== undefined) payload.previous_close = Number(data.previous_close);
          if (data?.prev_close !== undefined) payload.previous_close = Number(data.prev_close);
          if (data?.change !== undefined) payload.change = Number(data.change);
          if (data?.percent_change !== undefined) payload.percent_change = Number(data.percent_change);
          if (data?.open !== undefined) payload.open = Number(data.open);
          if (data?.timestamp !== undefined) payload.timestamp = String(data.timestamp);
          // Do NOT fallback to `quote` here — keep exchange_rate as the authoritative current rate.
          // Use a separate cached `time_series` lookup to obtain the previous close for daily percent calculation.
          try{
            const daily = await this.getFxDailyReference(from, to).catch(()=>null);
            if (daily && typeof daily.previous_close === 'number'){
              payload.previous_close = Number(daily.previous_close);
              // compute change and percent based on current rate and previous_close
              try{
                const prev = Number(daily.previous_close);
                if (Number.isFinite(prev) && prev !== 0){
                  payload.change = Number(payload.rate - prev);
                  payload.percent_change = Number(((payload.rate - prev) / Math.abs(prev)) * 100);
                }
              }catch(e){}
            }
          }catch(e){ /* non-fatal */ }
          // cache positive rates
          this.fxCache.set(key, { expires: Date.now() + this.fxTtlMs, v: payload });
          return payload;
        }catch(e){ return null; }
        finally { this.fxPending.delete(key); }
      })();

      this.fxPending.set(key, p);
      return p;
    }catch(e){ return null; }
  }

  // Obtain a cached daily reference (previous close) using Twelve Data time_series endpoint.
  // Returns { previous_close, timestamp } or null.
  private async getFxDailyReference(fromCurrency: string, toCurrency: 'SEK'): Promise<any | null> {
    try{
      const from = String(fromCurrency || '').toUpperCase();
      const to = String(toCurrency || '').toUpperCase();
      if (to !== 'SEK') return null;
      if (!from) return null;
      if (from === 'SEK') return { previous_close: 1, timestamp: new Date().toISOString() };

      const key = `${from}->${to}`;
      const cached = this.fxDailyCache.get(key);
      if (cached && cached.expires > Date.now()) return cached.v;

      const pending = this.fxDailyPending.get(key);
      if (pending) return pending;

      const p = (async ()=>{
        try{
          const sym = `${from}/${to}`;
          const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=2&timezone=UTC&apikey=${this.apiKey}`;
          const res = await this.fetchWithTimeout(url, 10_000);
          if (!res.ok) return null;
          const data = await res.json();
          if (!data) return null;
          if (data.status === 'error') return null;
          const values = Array.isArray(data.values) ? data.values : (Array.isArray(data.data) ? data.data : []);
          if (!values || values.length === 0) return null;
          // values[0] is newest; avoid using today's incomplete candle. Compare date part in UTC.
          const first = values[0];
          let ref = null;
          try{
            const now = new Date();
            const todayUTC = now.toISOString().slice(0,10);
            const firstDate = (first.datetime || first.date || '').toString().slice(0,10);
            if (firstDate === todayUTC && values.length > 1){ ref = values[1]; }
            else { ref = first; }
          }catch(e){ ref = values[0]; }
          if (!ref || ref.close === undefined) return null;
          const prevClose = Number(ref.close);
          if (!this.isValidNumber(prevClose)) return null;
          const out = { previous_close: prevClose, timestamp: ref.datetime || ref.date || null };
          this.fxDailyCache.set(key, { expires: Date.now() + this.fxDailyTtlMs, v: out });
          return out;
        }catch(e){ return null; }
        finally { this.fxDailyPending.delete(key); }
      })();

      this.fxDailyPending.set(key, p);
      return p;
    }catch(e){ return null; }
  }
}
