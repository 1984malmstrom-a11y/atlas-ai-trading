// Server-only market data provider interfaces and Twelve Data implementation
const _so = 'server' + '-only';
void import(_so).catch(() => {});

export type MarketQuote = {
  instrumentId: string;
  symbol: string;
  exchange: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  timestamp: string; // ISO
  source: 'twelve-data';
  isDelayed: boolean;
  isStale: boolean;
};

export interface MarketDataProvider {
  getQuote(symbol: string): Promise<MarketQuote>;
  getQuotes(symbols: string[]): Promise<MarketQuote[]>;
}

// Simple in-memory cache with TTL (server process scope)
class SimpleCache<T> {
  private map = new Map<string, { expires: number; v: T }>();
  constructor(private readonly ttlMs: number) {}
  get(key: string) {
    const now = Date.now();
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires < now) { this.map.delete(key); return undefined; }
    return e.v;
  }
  set(key: string, v: T) { this.map.set(key, { expires: Date.now() + this.ttlMs, v }); }
}

export class TwelveDataMarketDataProvider implements MarketDataProvider {
  private apiKey: string;
  private cache = new SimpleCache<MarketQuote>(45_000);

  constructor(){
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) throw new Error('TWELVE_DATA_API_KEY is required on server');
    this.apiKey = key;
  }

  private async fetchWithTimeout(url: string, timeout = 6_000){
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try{
      const res = await fetch(url, { signal: controller.signal });
      return res;
    }finally{ clearTimeout(id); }
  }

  private validateQuote(raw: any, requestedSymbol: string): MarketQuote {
    const p = Number(raw.price ?? raw.close ?? raw.last_price ?? NaN);
    const prev = Number(raw.prev_close ?? raw.previous_close ?? raw.close_prev ?? NaN);
    if (!Number.isFinite(p) || p <= 0) throw new Error('Invalid price from provider');
    const change = Number(raw.change ?? (p - prev)) || 0;
    const changePct = Number(raw.percent_change ?? raw.change_percent ?? ((prev && p)? ((p - prev) / prev * 100) : 0)) || 0;
    const quote: MarketQuote = {
      instrumentId: requestedSymbol,
      symbol: String(raw.symbol || requestedSymbol),
      exchange: String(raw.exchange || raw.exchange_short || 'UNKNOWN'),
      price: p,
      previousClose: Number(prev) || 0,
      change: change,
      changePercent: changePct,
      currency: String(raw.currency || 'SEK'),
      timestamp: new Date().toISOString(),
      source: 'twelve-data',
      isDelayed: false,
      isStale: false,
    };
    return quote;
  }

  async getQuote(symbol: string): Promise<MarketQuote> {
    const key = symbol.toUpperCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(key)}&apikey=${this.apiKey}`;
    const res = await this.fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Twelve Data request failed: ${res.status}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(`Twelve Data error: ${data.message || JSON.stringify(data)}`);
    const q = this.validateQuote(data, key);
    this.cache.set(key, q);
    return q;
  }

  async getQuotes(symbols: string[]): Promise<MarketQuote[]> {
    if (!symbols || symbols.length === 0) return [];
    // Try to leverage batch endpoint if available (comma separated)
    const out: MarketQuote[] = [];
    const toFetch: string[] = [];
    for (const s of symbols){ const k = s.toUpperCase(); const c = this.cache.get(k); if (c) out.push(c); else toFetch.push(k); }
    if (toFetch.length === 0) return out;
    const chunk = toFetch.join(',');
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(chunk)}&apikey=${this.apiKey}`;
    const res = await this.fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Twelve Data batch request failed: ${res.status}`);
    const data = await res.json();
    // If single symbol, api returns an object, if multiple symbols, it may return an object map
    if (Array.isArray(data)){
      for (const d of data){ try{ const q = this.validateQuote(d, d.symbol || ''); this.cache.set(q.symbol.toUpperCase(), q); out.push(q);}catch(e){}}
    } else if (typeof data === 'object'){
      // data may be a single quote object or a map
      if (data.symbol) { try{ const q = this.validateQuote(data, data.symbol); this.cache.set(q.symbol.toUpperCase(), q); out.push(q);}catch(e){} }
      else {
        for (const k of Object.keys(data)){
          const d = data[k]; try{ const q = this.validateQuote(d, k); this.cache.set(q.symbol.toUpperCase(), q); out.push(q);}catch(e){}
        }
      }
    }
    return out;
  }
}
