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

  constructor(){
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) throw new Error('TWELVE_DATA_API_KEY must be set on server');
    this.apiKey = key;
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
    const tsRaw = raw.timestamp ?? raw.datetime ?? raw.updated_at ?? raw.status_time ?? raw.ts ?? raw.last_trade_time ?? raw.datetime_utc ?? null;
    // Normalize timestamp: handle epoch seconds (common) and ISO strings
    let tsDate: Date;
    try{
      if (tsRaw === null || tsRaw === undefined || tsRaw === '') {
        tsDate = new Date();
      } else if (typeof tsRaw === 'number') {
        // If value looks like seconds (<= 1e12), multiply to ms
        tsDate = new Date(tsRaw < 1e12 ? Math.floor(tsRaw * 1000) : tsRaw);
      } else if (/^[0-9]+$/.test(String(tsRaw))) {
        // numeric string
        const n = Number(tsRaw);
        tsDate = new Date(n < 1e12 ? Math.floor(n * 1000) : n);
      } else {
        tsDate = new Date(String(tsRaw));
      }
      if (!isFinite(tsDate.getTime())) tsDate = new Date();
    }catch(e){ tsDate = new Date(); }
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
}
