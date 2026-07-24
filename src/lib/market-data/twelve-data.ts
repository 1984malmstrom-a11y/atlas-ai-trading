/* Server-side Twelve Data provider implementation */
const _so = 'server' + '-only';
void import(_so).catch(()=>{});

import type { MarketDataProvider, MarketQuote } from './types';
import { TRADABLE_INSTRUMENTS, findInstrumentById } from './instruments';

type TDSearchResult = {
  symbol: string;
  exchange: string;
  currency: string;
  name?: string;
};

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

  constructor(){
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) throw new Error('TWELVE_DATA_API_KEY must be set on server');
    this.apiKey = key;
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
        const pairs: { date: string; close: number }[] = [];
        for (const it of items){
          const rawDate = (it.datetime || it.date || it.timestamp || '').toString();
          const closeRaw = it.close ?? it.c ?? it.value ?? null;
          const close = typeof closeRaw === 'string' ? Number(closeRaw) : Number(closeRaw);
          if (!rawDate || !Number.isFinite(close) || close <= 0) continue;
          // Normalize to YYYY-MM-DD (first 10 chars) if possible
          const cand = rawDate.length >= 10 ? rawDate.slice(0,10) : rawDate;
          // Accept only valid YYYY-MM-DD strings
          if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(cand)) continue;
          pairs.push({ date: cand, close });
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
        const byDate = new Map<string, number>();
        for (const p of filtered){ byDate.set(p.date, p.close); }
        const sortedDates = Array.from(byDate.keys()).sort((a,b)=> a < b ? -1 : a > b ? 1 : 0);
        const closes = sortedDates.map(d => byDate.get(d) as number);

        // Ensure at least 20 completed days after filtering
        if (closes.length < 20) throw Object.assign(new Error(`Insufficient history: have ${closes.length}`), { code: 'INSUFFICIENT_HISTORY' });

        const out = { symbol: sym, closes, dates: sortedDates, source: 'twelve-data', fetchedAt: new Date().toISOString() };
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

  private parseQuoteResponse(raw: any, instrumentId: string): MarketQuote {
    // raw expected to include price/close/previous_close etc.
    const price = Number(raw.price ?? raw.close ?? raw.last_price ?? NaN);
    const prev = Number(raw.previous_close ?? raw.prev_close ?? raw.close_prev ?? raw.close ?? NaN);
    if (!this.isValidNumber(price) || price <= 0) throw new Error('Invalid price from provider');
    const change = this.isValidNumber(raw.change) ? Number(raw.change) : (this.isValidNumber(price) && this.isValidNumber(prev) ? price - prev : 0);
    const changePct = this.isValidNumber(raw.percent_change) ? Number(raw.percent_change) : (this.isValidNumber(prev) && prev !== 0 ? (price - prev) / prev * 100 : 0);
    const sym = String(raw.symbol || raw.ticker || '').toUpperCase();
    const exchange = String(raw.exchange || raw.exchange_short || '').toUpperCase() || 'UNKNOWN';
    const name = String(raw.name || '');
    const currency = String(raw.currency || raw.currency_base || raw.currency_quote || '').toUpperCase() || 'UNKNOWN';
    // Prefer the freshest timestamp candidates from Twelve Data:
    // 1) last_quote_at, 2) last_trade_time, 3) updated_at, 4) timestamp, then other fallbacks
    const tsRaw = raw.last_quote_at ?? raw.last_trade_time ?? raw.updated_at ?? raw.timestamp ?? raw.datetime ?? raw.status_time ?? raw.ts ?? raw.datetime_utc ?? null;
    // Normalize timestamp: try candidates in priority order and fall through invalid values
    const tsCandidates = [raw.last_quote_at, raw.last_trade_time, raw.updated_at, raw.timestamp, raw.datetime, raw.status_time, raw.ts, raw.datetime_utc];
    let tsDate: Date | null = null;
    for (const cand of tsCandidates){
      if (cand === null || cand === undefined || cand === '') continue;
      try{
        let candidateDate: Date;
        if (typeof cand === 'number') candidateDate = new Date(cand < 1e12 ? Math.floor(cand * 1000) : cand);
        else if (/^[0-9]+$/.test(String(cand))) { const n = Number(cand); candidateDate = new Date(n < 1e12 ? Math.floor(n * 1000) : n); }
        else candidateDate = new Date(String(cand));
        if (isFinite(candidateDate.getTime())){ tsDate = candidateDate; break; }
      }catch(e){ /* try next candidate */ }
    }
    if (!tsDate) tsDate = new Date();
    const timestamp = tsDate.toISOString();
    const isStale = (()=>{
      try{ const ageSec = (Date.now() - tsDate.getTime())/1000; return ageSec > 120; }catch(e){ return true; }
    })();
    // Determine data status: prefer explicit provider hint, otherwise unknown
    const dataStatus: 'REALTIME' | 'DELAYED' | 'UNKNOWN' = ((): any => {
      try{
        if (raw.is_market_open === true) return 'REALTIME';
        if (raw.is_market_open === false) return 'DELAYED';
        if (raw.is_realtime === true || raw.is_realtime === 'true') return 'REALTIME';
        return 'UNKNOWN';
      }catch(e){ return 'UNKNOWN'; }
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
        const res = await this.fetchWithTimeout(url);
        if (!res.ok) throw new Error(`Twelve Data quote request failed: ${res.status}`);
        const data = await res.json();
        if (data.status === 'error') throw new Error(String(data.message || JSON.stringify(data)));
        const q = this.parseQuoteResponse(data, instrumentId);
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
        // data may be an object per symbol or a single object; normalize
        if (Array.isArray(data)){
          for (const d of data){ try{ const id = Array.from(idToSymbol.entries()).find(([,s])=> s.toUpperCase() === String(d.symbol||'').toUpperCase())?.[0]; if (!id) continue; const q = this.parseQuoteResponse(d, id); this.cacheSet(id, q); out.push(q); }catch(e){}}
        } else if (data && typeof data === 'object'){
          // if single symbol returned
          if (data.symbol){
            const id = Array.from(idToSymbol.entries()).find(([,s])=> s.toUpperCase() === String(data.symbol||'').toUpperCase())?.[0];
            if (id){ const q = this.parseQuoteResponse(data, id); this.cacheSet(id, q); out.push(q); }
            else {
              // map over possible keys
              for (const [idk, sym] of idToSymbol.entries()){
                const d = data[sym] || data[idk];
                if (d) try{ const q = this.parseQuoteResponse(d, idk); this.cacheSet(idk, q); out.push(q); }catch(e){}
              }
            }
          } else {
            for (const [idk, sym] of idToSymbol.entries()){
              const d = data[sym] || data[idk];
              if (!d) continue;
              try{ const q = this.parseQuoteResponse(d, idk); this.cacheSet(idk, q); out.push(q); }catch(e){}
            }
          }
        }
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
