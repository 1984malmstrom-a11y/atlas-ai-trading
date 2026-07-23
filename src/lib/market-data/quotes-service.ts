import type { MarketQuote, MarketDataProvider } from './types';
import { TRADABLE_INSTRUMENTS } from './instruments';

// Threshold for considering a quote stale (ms)
export const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

// Sanitize error messages to avoid leaking secrets or large objects
export function sanitizeErrorMessage(input: unknown) {
  try {
    const s = typeof input === 'string' ? input : JSON.stringify(input);
    return s.replace(/(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/ig, '$1:[REDACTED]');
  } catch (e) { return String(input); }
}

// classifyQuoteStatus: pure helper to determine dataStatus and isStale
export function classifyQuoteStatus(opts: { currentTime?: string|Date, marketTimestamp?: string|null, hasValidPrice: boolean, provider?: unknown }){
  const { currentTime, marketTimestamp, hasValidPrice, provider } = opts;
  const now = currentTime ? new Date(currentTime) : new Date();

  const pad = (n:number)=> String(n).padStart(2,'0');
  const getLatestTradingDateString = (d:Date)=>{
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = f.formatToParts(d).reduce((acc: Record<string,string>, p: Intl.DateTimeFormatPart)=>{ acc[p.type]=p.value; return acc; },{} as Record<string,string>);
    const y = Number(parts.year), m = Number(parts.month), day = Number(parts.day), h = Number(parts.hour), min = Number(parts.minute);
    const beforeOpen = (h < 9) || (h === 9 && min < 30);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d);
    let latest = new Date(Date.UTC(y, m-1, day));
    if (weekday === 'Sat') latest.setUTCDate(latest.getUTCDate() - 1);
    else if (weekday === 'Sun') latest.setUTCDate(latest.getUTCDate() - 2);
    else if (weekday === 'Mon' && beforeOpen) latest.setUTCDate(latest.getUTCDate() - 3);
    else if (beforeOpen && weekday !== 'Mon') latest.setUTCDate(latest.getUTCDate() - 1);
    const yy = latest.getUTCFullYear(); const mm = pad(latest.getUTCMonth()+1); const dd = pad(latest.getUTCDate());
    return `${yy}-${mm}-${dd}`;
  };

  const latestTradeDateStr = getLatestTradingDateString(now);

  const marketDateStr = (()=>{
    if (!marketTimestamp) return null;
    try{
      const d = new Date(String(marketTimestamp));
      if (!isFinite(d.getTime())) return null;
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).reduce((acc: Record<string,string>, p: Intl.DateTimeFormatPart)=>{ acc[p.type]=p.value; return acc; },{} as Record<string,string>);
      return `${parts.year}-${parts.month}-${parts.day}`;
    }catch(e){ return null; }
  })();

  const tsMs = marketTimestamp ? Date.parse(String(marketTimestamp)) : NaN;
  const ageMs = isFinite(tsMs) ? (Date.now() - tsMs) : Infinity;

  let providerIsMarketOpen = false;
  if (provider && typeof provider === 'object'){
    const p = provider as Record<string, unknown>;
    const isMarketOpenProp = p['is_market_open'];
    const isRealtimeProp = p['is_realtime'];
    providerIsMarketOpen = (isMarketOpenProp === true) || (isRealtimeProp === true) || (String(isMarketOpenProp).toLowerCase() === 'true');
  }

  let isOld = !isFinite(tsMs) ? true : (ageMs > STALE_THRESHOLD_MS);
  if (marketDateStr && marketDateStr === latestTradeDateStr) isOld = false;

  let dataStatus: 'LIVE'|'DELAYED'|'STALE'|'UNAVAILABLE' = 'UNAVAILABLE';
  if (!hasValidPrice) dataStatus = 'UNAVAILABLE';
  else if (isOld) dataStatus = 'STALE';
  else dataStatus = providerIsMarketOpen ? 'LIVE' : 'DELAYED';

  return { dataStatus, isStale: dataStatus === 'STALE' };
}

// Reusable function to fetch and normalize quotes. Exported so other server endpoints can reuse the exact same behavior.
// Explicit FX payload type matching what providers (e.g. Twelve Data) return
export type FxRatePayload = {
  rate: number;
  previous_close?: number | null;
  change?: number | null;
  percent_change?: number | null;
  open?: number | null;
  timestamp?: string | null;
};

// FxRateGetter may return either a primitive number (for convenience) or a richer payload object, or null on failure.
export type FxRateGetter = (fromCurrency: string, toCurrency: 'SEK') => Promise<number | FxRatePayload | null>;
export type GetNormalizedQuotesOptions = { getFxRate?: FxRateGetter };

// Module-scoped cache and in-flight dedupe for standard getNormalizedQuotes() calls
const STANDARD_CACHE_TTL_MS = 15 * 60_000; // 15 minutes
let _standardNormalizedCache: { expires: number; v: any } | null = null;
let _standardNormalizedPending: Promise<any> | null = null;

export async function getNormalizedQuotes(providerOverride?: MarketDataProvider, options?: GetNormalizedQuotesOptions){
  // Lazy import provider to avoid requiring Twelve Data API key in modules that only import helpers
  const provider = providerOverride || (await import('./index')).default;
  const getFxRate = options?.getFxRate;

  // Determine whether this is a standard call we are allowed to cache:
  // - no provider override
  // - no custom getFxRate injected
  const isStandardCall = !providerOverride && !(options && typeof options.getFxRate === 'function');

  // Serve from module cache if valid
  if (isStandardCall){
    if (_standardNormalizedCache && _standardNormalizedCache.expires > Date.now()){
      // Return cached normalized result, but refresh FX entries (USD/SEK, EUR/SEK)
      // using provider.getFxRate() (or real provider) so FX can update at poll interval
      const cached = _standardNormalizedCache.v;
      try{
        let fxGetter: ((from:string,to:'SEK') => Promise<number|null>) | undefined = undefined;
        try{
          const md = await import('./index');
          const real = typeof md.getMarketDataProvider === 'function' ? md.getMarketDataProvider() : undefined;
          if (real && typeof (real as any).getFxRate === 'function') fxGetter = (real as any).getFxRate.bind(real);
        }catch(e){}
        if (!fxGetter && provider && typeof (provider as any).getFxRate === 'function') fxGetter = (provider as any).getFxRate.bind(provider);

        if (typeof fxGetter === 'function'){
          const prevUsd = Array.isArray(cached.quotes) ? cached.quotes.find((q:any)=> q && q.instrumentId === 'usd-sek') : undefined;
          const prevEur = Array.isArray(cached.quotes) ? cached.quotes.find((q:any)=> q && q.instrumentId === 'eur-sek') : undefined;
          const [rawUsd, rawEur] = await Promise.all([ fxGetter('USD','SEK'), fxGetter('EUR','SEK') ]);
          const nowIso = new Date().toISOString();
          const out = { ...cached, quotes: Array.isArray(cached.quotes) ? [...cached.quotes.filter((q:any)=> q.instrumentId !== 'usd-sek' && q.instrumentId !== 'eur-sek')] : [] };

          const processFx = (raw:any, prev:any, id:string, sym:string) => {
            if (raw === null || raw === undefined) return null;
            if (typeof raw === 'number'){
              return { rate: Number(raw) };
            }
            if (raw && typeof raw === 'object' && raw.rate && Number.isFinite(Number(raw.rate))){
              return { rate: Number(raw.rate), previous_close: raw.previous_close ?? raw.prev_close ?? null, change: raw.change ?? null, percent_change: raw.percent_change ?? raw.percentChange ?? null, timestamp: raw.timestamp ?? null };
            }
            return null;
          };

          const usd = processFx(rawUsd, prevUsd, 'usd-sek', 'USD/SEK');
          const eur = processFx(rawEur, prevEur, 'eur-sek', 'EUR/SEK');

          if (usd && usd.rate){
            out.quotes.push({ instrumentId: 'usd-sek', symbol: 'USD/SEK', name: 'USD/SEK', currency: 'SEK', price: Number(usd.rate), priceSek: Number(usd.rate), fxRateSek: Number(usd.rate), previousClose: usd.previous_close !== null && usd.previous_close !== undefined ? Number(usd.previous_close) : null, change: usd.change !== null && usd.change !== undefined ? Number(usd.change) : null, changePercent: usd.percent_change !== null && usd.percent_change !== undefined ? Number(usd.percent_change) : null, marketTimestamp: usd.timestamp || nowIso, fetchedAt: nowIso, dataStatus: 'LIVE', isStale: false, provider: 'twelve-data' });
          } else if (prevUsd){
            out.quotes.push(prevUsd);
          } else {
            out.quotes.push({ instrumentId: 'usd-sek', symbol: 'USD/SEK', name: 'USD/SEK', currency: 'SEK', price: null, previousClose: null, change: null, changePercent: null, marketTimestamp: null, fetchedAt: nowIso, dataStatus: 'UNAVAILABLE', isStale: true, provider: 'twelve-data' });
          }

          if (eur && eur.rate){
            out.quotes.push({ instrumentId: 'eur-sek', symbol: 'EUR/SEK', name: 'EUR/SEK', currency: 'SEK', price: Number(eur.rate), priceSek: Number(eur.rate), fxRateSek: Number(eur.rate), previousClose: eur.previous_close !== null && eur.previous_close !== undefined ? Number(eur.previous_close) : null, change: eur.change !== null && eur.change !== undefined ? Number(eur.change) : null, changePercent: eur.percent_change !== null && eur.percent_change !== undefined ? Number(eur.percent_change) : null, marketTimestamp: eur.timestamp || nowIso, fetchedAt: nowIso, dataStatus: 'LIVE', isStale: false, provider: 'twelve-data' });
          } else if (prevEur){
            out.quotes.push(prevEur);
          } else {
            out.quotes.push({ instrumentId: 'eur-sek', symbol: 'EUR/SEK', name: 'EUR/SEK', currency: 'SEK', price: null, previousClose: null, change: null, changePercent: null, marketTimestamp: null, fetchedAt: nowIso, dataStatus: 'UNAVAILABLE', isStale: true, provider: 'twelve-data' });
          }
          return out;
        }
      }catch(e){ /* ignore and fallback to returning cached */ }
      return _standardNormalizedCache.v;
    }
    if (_standardNormalizedPending) return _standardNormalizedPending;
  }

  // Wrap main execution so we can set pending for standard calls and ensure pending cleared
  const execute = async () => {
    // Separate instruments that should be fetched for market data (marketDataEnabled)
    // Keep `enabled` for backward compatibility but prefer explicit `marketDataEnabled`.
    const enabledInstruments = TRADABLE_INSTRUMENTS.filter(i => i.marketDataEnabled === true || (i.marketDataEnabled === undefined && i.enabled === true));
    const disabledInstruments = TRADABLE_INSTRUMENTS.filter(i => !(i.marketDataEnabled === true || (i.marketDataEnabled === undefined && i.enabled === true))).map(i => ({ instrumentId: i.id, providerSymbol: i.providerSymbol || null, disabledReason: i.disabledReason || null }));

    type NormalizedQuote = {
      instrumentId: string;
      symbol: string | null;
      name: string | null;
      currency: string | null;
      price: number | null;
      priceSek?: number;
      fxRateSek?: number;
      previousClose: number | null;
      change: number | null;
      changePercent: number | null;
      marketTimestamp: string | null;
      fetchedAt: string;
      dataStatus: 'LIVE'|'DELAYED'|'STALE'|'UNAVAILABLE';
      isStale: boolean;
      provider: string;
    };
    type ServiceError = { instrumentId: string; symbol: string | null; code: string; message: string };

    const quotesOut: NormalizedQuote[] = [];
    const errors: ServiceError[] = [];

    // If no enabled instruments, return empty quotes and disabled list
    if (enabledInstruments.length === 0){
      return { quotes: [], errors: [], disabledInstruments, fetchedAt: new Date().toISOString() };
    }

    const idsToFetch = enabledInstruments.map(i => i.id);

    let fetched: MarketQuote[] = [];
    const providerErrorIds = new Set<string>();
    const fxErrorIds = new Set<string>();
    try{
      fetched = await provider.getQuotes(idsToFetch);
      if (Array.isArray(fetched) && fetched.length === 0){
        type AttemptResult = { id: string; quote: MarketQuote | null; err: string | null };
        const attempt = await Promise.all(idsToFetch.map(async (id: string): Promise<AttemptResult> => {
          try{
            const q = await provider.getQuote(id);
            return { id, quote: q, err: null };
          }catch(e: unknown){
            const msg = ((): string => {
              if (e && typeof e === 'object' && 'message' in e && typeof (e as Record<string, unknown>).message === 'string') return String((e as Record<string, unknown>).message);
              return String(e);
            })();
            // record a provider-level error for this instrument
            errors.push({ instrumentId: id, symbol: (TRADABLE_INSTRUMENTS.find(x=>x.id===id)?.providerSymbol) || null, code: 'PROVIDER_ERROR', message: sanitizeErrorMessage(msg) });
            providerErrorIds.add(id);
            return { id, quote: null, err: msg };
          }
        }));
        fetched = attempt.filter((r): r is AttemptResult & { quote: MarketQuote } => r.quote !== null).map((r)=>r.quote);
      }
    }catch(e: unknown){
      const fallbackPromises = idsToFetch.map(async id => {
        try{ return await provider.getQuote(id); }catch(err: unknown){
          const msg = ((): string => {
            if (err && typeof err === 'object' && 'message' in err && typeof (err as Record<string, unknown>).message === 'string') return String((err as Record<string, unknown>).message);
            return String(err);
          })();
          if (!providerErrorIds.has(id)){ errors.push({ instrumentId: id, symbol: null, code: 'PROVIDER_ERROR', message: sanitizeErrorMessage(msg) }); providerErrorIds.add(id); }
          return null;
        }
      });
      const results = await Promise.all(fallbackPromises);
      fetched = results.filter((r): r is MarketQuote => Boolean(r));
    }

    const fetchedById = new Map<string, MarketQuote>();
    for (const f of fetched){ if (f && f.instrumentId) fetchedById.set(f.instrumentId, f); }

    for (const inst of enabledInstruments){
      const raw = fetchedById.get(inst.id);
      if (!raw){
        // if we already recorded a provider-level error for this instrument, do not add a NO_DATA entry
        if (!providerErrorIds.has(inst.id)){
          errors.push({ instrumentId: inst.id, symbol: inst.providerSymbol || null, code: 'NO_DATA', message: 'No quote available' });
        }
        continue;
      }

      try{
        const instrumentId = String(inst.id);
        const symbol = raw.symbol ? String(raw.symbol) : (inst.providerSymbol || null);
        const name = raw.name ? String(raw.name) : inst.name || null;

        const price = (raw.price === null || raw.price === undefined) ? null : Number(raw.price);
        const previousClose = (raw.previousClose === null || raw.previousClose === undefined) ? null : Number(raw.previousClose);
        const change = (raw.change === null || raw.change === undefined) ? null : Number(raw.change);
        const changePercent = (raw.changePercent === null || raw.changePercent === undefined) ? null : Number(raw.changePercent);

        const marketTimestamp = raw.timestamp ? new Date(String(raw.timestamp)).toISOString() : null;

        const now = new Date();
        const getLatestTradingDateString = () => {
          const pad = (n:number)=> String(n).padStart(2,'0');
          const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
          const parts = f.formatToParts(now).reduce((acc: Record<string,string>, p: Intl.DateTimeFormatPart)=>{acc[p.type]=p.value;return acc;},{} as Record<string,string>);
          const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day), h = Number(parts.hour), min = Number(parts.minute);
          const beforeOpen = (h < 9) || (h === 9 && min < 30);
          const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
          let latest = new Date(Date.UTC(y, m-1, d));
          if (weekday === 'Sat'){
            latest.setUTCDate(latest.getUTCDate() - 1);
          } else if (weekday === 'Sun'){
            latest.setUTCDate(latest.getUTCDate() - 2);
          } else if (weekday === 'Mon' && beforeOpen){
            latest.setUTCDate(latest.getUTCDate() - 3);
          } else if (beforeOpen && weekday !== 'Mon'){
            latest.setUTCDate(latest.getUTCDate() - 1);
          }
          const yy = latest.getUTCFullYear(); const mm = pad(latest.getUTCMonth()+1); const dd = pad(latest.getUTCDate());
          return `${yy}-${mm}-${dd}`;
        };

        const latestTradeDateStr = getLatestTradingDateString();

        const marketDateStr = (()=>{
          if (!marketTimestamp) return null;
          try{
            const d = new Date(String(marketTimestamp));
            if (!isFinite(d.getTime())) return null;
            const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).reduce((acc: Record<string,string>, p: Intl.DateTimeFormatPart)=>{ acc[p.type]=p.value; return acc; },{} as Record<string,string>);
            return `${parts.year}-${parts.month}-${parts.day}`;
          }catch(e){ return null; }
        })();

        const tsMs = marketTimestamp ? Date.parse(marketTimestamp) : NaN;
        const ageMs = isFinite(tsMs) ? (Date.now() - tsMs) : Infinity;

        const providerIsMarketOpen = (raw && raw.dataStatus === 'REALTIME');
        const providerIsMarketClosed = (raw && raw.dataStatus === 'DELAYED');

        let isOld = !isFinite(tsMs) ? true : (ageMs > STALE_THRESHOLD_MS);
        if (marketDateStr && marketDateStr === latestTradeDateStr){
          isOld = false;
        }

        let dataStatus: 'LIVE'|'DELAYED'|'STALE'|'UNAVAILABLE' = 'UNAVAILABLE';
        if (price === null || !Number.isFinite(Number(price))){
          dataStatus = 'UNAVAILABLE';
        } else if (isOld){
          dataStatus = 'STALE';
        } else {
          if (providerIsMarketOpen) dataStatus = 'LIVE';
          else dataStatus = 'DELAYED';
        }
        const outIsStale = dataStatus === 'STALE';

        // compute optional SEK-normalized price if getFxRate provided
        let priceSek: number | undefined = undefined;
        let fxRateSek: number | undefined = undefined;
        try{
          const currency = raw.currency || inst.currency || null;
          if (currency === 'SEK'){
            priceSek = (price !== null && Number.isFinite(Number(price))) ? Number(price) : undefined;
            fxRateSek = 1;
          } else if (currency && typeof getFxRate === 'function'){
            try{
              const rawRate = await getFxRate(String(currency), 'SEK');
              let useRate: number | null = null;
              if (rawRate === null || rawRate === undefined) useRate = null;
              else if (typeof rawRate === 'number') useRate = Number(rawRate);
              else if (rawRate && typeof rawRate === 'object' && rawRate.rate) useRate = Number(rawRate.rate);
              if (useRate && Number.isFinite(useRate) && useRate > 0){
                priceSek = (price !== null && Number.isFinite(Number(price))) ? Number(price * useRate) : undefined;
                fxRateSek = useRate;
              } else {
                if (!fxErrorIds.has(instrumentId)){
                  errors.push({ instrumentId, symbol, code: 'FX_UNAVAILABLE', message: 'FX rate unavailable for conversion to SEK' });
                  fxErrorIds.add(instrumentId);
                }
              }
            }catch(e: unknown){
              if (!fxErrorIds.has(instrumentId)){
                const msg = ((): string => {
                  if (e && typeof e === 'object' && 'message' in e && typeof (e as Record<string, unknown>).message === 'string') return String((e as Record<string, unknown>).message);
                  return String(e);
                })();
                errors.push({ instrumentId, symbol, code: 'FX_UNAVAILABLE', message: sanitizeErrorMessage(msg) });
                fxErrorIds.add(instrumentId);
              }
            }
          }
        }catch(e: unknown){ /* ignore fx calc */ }

        quotesOut.push({
          instrumentId,
          symbol,
          name,
          currency: raw.currency || inst.currency || null,
          price: Number.isFinite(Number(price)) ? Number(price) : null,
          // optional SEK-normalized price and FX rate
          priceSek: (typeof priceSek === 'number' && Number.isFinite(priceSek)) ? Number(priceSek) : undefined,
          fxRateSek: (typeof fxRateSek === 'number' && Number.isFinite(fxRateSek)) ? Number(fxRateSek) : undefined,
          previousClose: Number.isFinite(Number(previousClose)) ? Number(previousClose) : null,
          change: Number.isFinite(Number(change)) ? Number(change) : null,
          changePercent: Number.isFinite(Number(changePercent)) ? Number(changePercent) : null,
          marketTimestamp,
          fetchedAt: new Date().toISOString(),
          dataStatus,
          isStale: outIsStale,
          provider: 'twelve-data',
        });
      }catch(e: unknown){
        const msg = ((): string => {
          if (e && typeof e === 'object' && 'message' in e && typeof (e as Record<string, unknown>).message === 'string') return String((e as Record<string, unknown>).message);
          return String(e);
        })();
        errors.push({ instrumentId: inst.id, symbol: inst.providerSymbol || null, code: 'PARSE_ERROR', message: sanitizeErrorMessage(msg) });
      }
    }

    const result = { quotes: quotesOut, errors, disabledInstruments, fetchedAt: new Date().toISOString() };

    // Add lightweight FX rates (USD/SEK, EUR/SEK) using provider.getFxRate if available.
    try{
      // Attempt to obtain a real provider that exposes getFxRate(). The default lazy export
      // may not include getFxRate on the wrapper, so prefer getMarketDataProvider() when available.
      let fxGetter: ((from:string,to:'SEK') => Promise<number|null>) | undefined = undefined;
      try{
        const md = await import('./index');
        const real = typeof md.getMarketDataProvider === 'function' ? md.getMarketDataProvider() : undefined;
        if (real && typeof (real as any).getFxRate === 'function') fxGetter = (real as any).getFxRate.bind(real);
      }catch(e){ /* ignore */ }
      if (!fxGetter && provider && typeof (provider as any).getFxRate === 'function') fxGetter = (provider as any).getFxRate.bind(provider);
      if (typeof fxGetter === 'function'){
        const [usdSek, eurSek] = await Promise.all([ fxGetter('USD','SEK'), fxGetter('EUR','SEK') ]);
        const nowIso = new Date().toISOString();
        if (typeof usdSek === 'number' && Number.isFinite(usdSek)){
          quotesOut.push({
            instrumentId: 'usd-sek',
            symbol: 'USD/SEK',
            name: 'USD/SEK',
            currency: 'SEK',
            price: Number(usdSek),
            priceSek: Number(usdSek),
            fxRateSek: Number(usdSek),
            previousClose: null,
            change: null,
            changePercent: null,
            marketTimestamp: nowIso,
            fetchedAt: nowIso,
            dataStatus: 'LIVE',
            isStale: false,
            provider: 'twelve-data',
          });
        } else {
          quotesOut.push({ instrumentId: 'usd-sek', symbol: 'USD/SEK', name: 'USD/SEK', currency: 'SEK', price: null, previousClose: null, change: null, changePercent: null, marketTimestamp: null, fetchedAt: new Date().toISOString(), dataStatus: 'UNAVAILABLE', isStale: true, provider: 'twelve-data' });
        }
        if (typeof eurSek === 'number' && Number.isFinite(eurSek)){
          const now2 = new Date().toISOString();
          quotesOut.push({
            instrumentId: 'eur-sek',
            symbol: 'EUR/SEK',
            name: 'EUR/SEK',
            currency: 'SEK',
            price: Number(eurSek),
            priceSek: Number(eurSek),
            fxRateSek: Number(eurSek),
            previousClose: null,
            change: null,
            changePercent: null,
            marketTimestamp: now2,
            fetchedAt: now2,
            dataStatus: 'LIVE',
            isStale: false,
            provider: 'twelve-data',
          });
        } else {
          quotesOut.push({ instrumentId: 'eur-sek', symbol: 'EUR/SEK', name: 'EUR/SEK', currency: 'SEK', price: null, previousClose: null, change: null, changePercent: null, marketTimestamp: null, fetchedAt: new Date().toISOString(), dataStatus: 'UNAVAILABLE', isStale: true, provider: 'twelve-data' });
        }
      }
    }catch(e){ /* non-fatal: FX best-effort */ }

    // Only cache successful standard calls (no errors recorded)
    if (isStandardCall){
      const shouldCache = Array.isArray(result.errors) ? result.errors.length === 0 : true;
      if (shouldCache){
        _standardNormalizedCache = { expires: Date.now() + STANDARD_CACHE_TTL_MS, v: result };
      }
    }

    return result;
  };

  // If standard call, set pending and ensure it's cleared; otherwise just execute
  if (isStandardCall){
    const p = execute();
    _standardNormalizedPending = p;
    // clear pending when done
    p.finally(()=>{ _standardNormalizedPending = null; });
    return p;
  }
  return execute();
}

export default { STALE_THRESHOLD_MS, sanitizeErrorMessage, classifyQuoteStatus, getNormalizedQuotes };
