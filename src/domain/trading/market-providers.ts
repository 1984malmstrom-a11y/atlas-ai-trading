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
  timestamp: string | null; // ISO or null when provider did not supply
  // optional: which raw provider field was chosen as the timestamp
  rawTimestampField?: string;
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
    // Prioritized intraday timestamp selection (do not accept date-only values)
    const isDateOnlyString = (s: string) => {
      if (!s) return false;
      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
      // YYYY-MM-DDT00:00:00(.000)Z or without Z
      if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?Z?$/.test(s)) return true;
      return false;
    };

    let isoTs: string | null = null;
    let chosenField: string | undefined;

    // Helper to normalize numeric candidates (seconds vs ms)
    const normalizeNumeric = (v: any) => {
      const n = Number(v);
      if (Number.isNaN(n)) return null;
      const ms = (Math.abs(n) < 1e12) ? n * 1000 : n;
      const d = new Date(ms);
      if (isNaN(d.getTime())) return null;
      // Reject date-only midnights as non-intraday timestamps
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) return null;
      return d.toISOString();
    };

    // Helper to parse string dates but reject date-only values
    const tryStringDate = (val: any, fieldName: string) => {
      if (typeof val !== 'string') return null;
      if (isDateOnlyString(val)) return null;
      const parsed = Date.parse(val);
      if (isNaN(parsed)) return null;
      return new Date(parsed).toISOString();
    };

    // Priority 1..3: numeric timestamp, epoch, ts
    if (typeof raw.timestamp !== 'undefined' && raw.timestamp !== null) {
      const normNum = normalizeNumeric(raw.timestamp);
      if (normNum) { isoTs = normNum; chosenField = 'timestamp'; }
      else if (typeof raw.timestamp === 'string') {
        // accept ISO-like string timestamp if it contains a time component
        const normStr = tryStringDate(raw.timestamp, 'timestamp');
        if (normStr) { isoTs = normStr; chosenField = 'timestamp'; }
      }
    }
    if (!isoTs && typeof raw.epoch !== 'undefined' && raw.epoch !== null) {
      const norm = normalizeNumeric(raw.epoch);
      if (norm) { isoTs = norm; chosenField = 'epoch'; }
    }
    if (!isoTs && typeof raw.ts !== 'undefined' && raw.ts !== null) {
      const norm = normalizeNumeric(raw.ts);
      if (norm) { isoTs = norm; chosenField = 'ts'; }
    }

    // Priority 4..5: datetime_utc, datetime — require an actual time component
    if (!isoTs && typeof raw.datetime_utc !== 'undefined' && raw.datetime_utc !== null) {
      const norm = tryStringDate(raw.datetime_utc, 'datetime_utc');
      if (norm) { isoTs = norm; chosenField = 'datetime_utc'; }
    }
    if (!isoTs && typeof raw.datetime !== 'undefined' && raw.datetime !== null) {
      const norm = tryStringDate(raw.datetime, 'datetime');
      if (norm) { isoTs = norm; chosenField = 'datetime'; }
    }

    // Priority 6: other intraday-like fields — updated_at, time, last_trade_time, datetimeEpoch, datetime_epoch
    if (!isoTs && typeof raw.updated_at !== 'undefined' && raw.updated_at !== null) {
      const norm = tryStringDate(raw.updated_at, 'updated_at');
      if (norm) { isoTs = norm; chosenField = 'updated_at'; }
    }
    if (!isoTs && typeof raw.time !== 'undefined' && raw.time !== null) {
      const norm = tryStringDate(raw.time, 'time');
      if (norm) { isoTs = norm; chosenField = 'time'; }
    }
    if (!isoTs && typeof raw.last_trade_time !== 'undefined' && raw.last_trade_time !== null) {
      const norm = tryStringDate(raw.last_trade_time, 'last_trade_time');
      if (norm) { isoTs = norm; chosenField = 'last_trade_time'; }
    }
    if (!isoTs && typeof raw.datetimeEpoch !== 'undefined' && raw.datetimeEpoch !== null) {
      const norm = normalizeNumeric(raw.datetimeEpoch);
      if (norm) { isoTs = norm; chosenField = 'datetimeEpoch'; }
    }
    if (!isoTs && typeof raw.datetime_epoch !== 'undefined' && raw.datetime_epoch !== null) {
      const norm = normalizeNumeric(raw.datetime_epoch);
      if (norm) { isoTs = norm; chosenField = 'datetime_epoch'; }
    }

    // Important: do NOT use `date` (YYYY-MM-DD) for freshness
    // If no valid intraday timestamp found, isoTs remains null

    const quote: MarketQuote = {
      instrumentId: requestedSymbol,
      symbol: String(raw.symbol || requestedSymbol),
      exchange: String(raw.exchange || raw.exchange_short || 'UNKNOWN'),
      price: p,
      previousClose: Number(prev) || 0,
      change: change,
      changePercent: changePct,
      currency: String(raw.currency || 'SEK'),
      timestamp: isoTs || null,
      rawTimestampField: chosenField,
      source: 'twelve-data',
      isDelayed: false,
      isStale: isoTs ? false : true,
    };
    return quote;
  }

  async getQuote(symbol: string): Promise<MarketQuote> {
    const key = symbol.toUpperCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    // Decide endpoint: prefer time_series for crypto symbols (heuristic: BASE/QUOTE where QUOTE is fiat and BASE not fiat)
    const fiatSet = new Set(['USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD','SEK']);
    const parts = key.split('/');
    const isCrypto = parts.length === 2 && fiatSet.has(parts[1]) && !fiatSet.has(parts[0]);
    if (isCrypto){
      // Fetch time_series for crypto
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(key)}&interval=1min&outputsize=1&timezone=UTC&apikey=${this.apiKey}`;
      const res = await this.fetchWithTimeout(url);
      if (!res.ok) throw new Error(`Twelve Data time_series request failed: ${res.status}`);
      const data = await res.json();
      if (data.status === 'error') throw new Error(`Twelve Data error: ${data.message || JSON.stringify(data)}`);
      // Expect data.values[0] with datetime and close
      const v = data.values && data.values[0];
      if (!v || typeof v.close === 'undefined' || Number(v.close) <= 0) throw new Error('No valid time_series data');
      // normalize datetime
      let isoTs: string | null = null;
      if (typeof v.datetime === 'string'){
        const s = v.datetime.trim();
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) isoTs = new Date(s.replace(' ', 'T') + 'Z').toISOString();
        else if (s.includes('T')){ const parsed = Date.parse(s); if (!isNaN(parsed)) isoTs = new Date(parsed).toISOString(); }
      }
      const quote: MarketQuote = {
        instrumentId: key,
        symbol: key,
        exchange: String((data.meta && data.meta.exchange) || 'UNKNOWN'),
        price: Number(v.close),
        previousClose: Number(data.values && data.values[1] && data.values[1].close) || 0,
        change: 0,
        changePercent: 0,
        currency: String((data.meta && data.meta.currency) || parts[1] || 'USD'),
        timestamp: isoTs,
        rawTimestampField: v && v.datetime ? 'values[0].datetime' : undefined,
        source: 'twelve-data',
        isDelayed: false,
        isStale: isoTs ? false : true,
      };
      this.cache.set(key, quote);
      return quote;
    }
    // fallback: quote endpoint for non-crypto
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

    const fiatSet = new Set(['USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD','SEK']);
    const quoteBatch: string[] = [];
    // Fetch crypto individually via time_series, others in batch quote
    for (const k of toFetch){
      const parts = k.split('/');
      const isCrypto = parts.length === 2 && fiatSet.has(parts[1]) && !fiatSet.has(parts[0]);
      if (isCrypto){
        try{
          const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(k)}&interval=1min&outputsize=1&timezone=UTC&apikey=${this.apiKey}`;
          const res = await this.fetchWithTimeout(url);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.status === 'error') continue;
          const v = data.values && data.values[0];
          if (!v || typeof v.close === 'undefined' || Number(v.close) <= 0) continue;
          let isoTs: string | null = null;
          if (typeof v.datetime === 'string'){
            const s = v.datetime.trim();
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) isoTs = new Date(s.replace(' ', 'T') + 'Z').toISOString();
            else if (s.includes('T')){ const parsed = Date.parse(s); if (!isNaN(parsed)) isoTs = new Date(parsed).toISOString(); }
          }
          const quote: MarketQuote = {
            instrumentId: k,
            symbol: k,
            exchange: String((data.meta && data.meta.exchange) || 'UNKNOWN'),
            price: Number(v.close),
            previousClose: Number(data.values && data.values[1] && data.values[1].close) || 0,
            change: 0,
            changePercent: 0,
            currency: String((data.meta && data.meta.currency) || parts[1] || 'USD'),
            timestamp: isoTs,
            rawTimestampField: v && v.datetime ? 'values[0].datetime' : undefined,
            source: 'twelve-data',
            isDelayed: false,
            isStale: isoTs ? false : true,
          };
          this.cache.set(k, quote);
          out.push(quote);
        }catch(e){ /* ignore crypto fetch issues here */ }
      } else { quoteBatch.push(k); }
    }

    if (quoteBatch.length === 0) return out;
    const chunk = quoteBatch.join(',');
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
