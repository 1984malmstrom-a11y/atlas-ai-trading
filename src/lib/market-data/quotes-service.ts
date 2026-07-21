import type { MarketQuote } from './types';
import { TRADABLE_INSTRUMENTS } from './instruments';

// Threshold for considering a quote stale (ms)
export const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

// Sanitize error messages to avoid leaking secrets or large objects
export function sanitizeErrorMessage(input: any) {
  try {
    const s = typeof input === 'string' ? input : JSON.stringify(input);
    return s.replace(/(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/ig, '$1:[REDACTED]');
  } catch (e) { return String(input); }
}

// classifyQuoteStatus: pure helper to determine dataStatus and isStale
export function classifyQuoteStatus(opts: { currentTime?: string|Date, marketTimestamp?: string|null, hasValidPrice: boolean, provider?: any }){
  const { currentTime, marketTimestamp, hasValidPrice, provider } = opts;
  const now = currentTime ? new Date(currentTime) : new Date();

  const pad = (n:number)=> String(n).padStart(2,'0');
  const getLatestTradingDateString = (d:Date)=>{
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = f.formatToParts(d).reduce((acc:any,p:any)=>{ acc[p.type]=p.value; return acc; },{});
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
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).reduce((acc:any,p:any)=>{ acc[p.type]=p.value; return acc; },{});
      return `${parts.year}-${parts.month}-${parts.day}`;
    }catch(e){ return null; }
  })();

  const tsMs = marketTimestamp ? Date.parse(String(marketTimestamp)) : NaN;
  const ageMs = isFinite(tsMs) ? (Date.now() - tsMs) : Infinity;

  const providerIsMarketOpen = provider && (provider.is_market_open === true || provider.is_realtime === true || String(provider.is_market_open).toLowerCase() === 'true');

  let isOld = !isFinite(tsMs) ? true : (ageMs > STALE_THRESHOLD_MS);
  if (marketDateStr && marketDateStr === latestTradeDateStr) isOld = false;

  let dataStatus: 'LIVE'|'DELAYED'|'STALE'|'UNAVAILABLE' = 'UNAVAILABLE';
  if (!hasValidPrice) dataStatus = 'UNAVAILABLE';
  else if (isOld) dataStatus = 'STALE';
  else dataStatus = providerIsMarketOpen ? 'LIVE' : 'DELAYED';

  return { dataStatus, isStale: dataStatus === 'STALE' };
}

// Reusable function to fetch and normalize quotes. Exported so other server endpoints can reuse the exact same behavior.
export async function getNormalizedQuotes(){
  // Lazy import provider to avoid requiring Twelve Data API key in modules that only import helpers
  const provider = (await import('./index')).default;

  // Separate enabled vs disabled instruments
  const enabledInstruments = TRADABLE_INSTRUMENTS.filter(i => i.enabled);
  const disabledInstruments = TRADABLE_INSTRUMENTS.filter(i => !i.enabled).map(i => ({ instrumentId: i.id, providerSymbol: i.providerSymbol || null, disabledReason: i.disabledReason || null }));

  const quotesOut: any[] = [];
  const errors: any[] = [];

  // If no enabled instruments, return empty quotes and disabled list
  if (enabledInstruments.length === 0){
    return { quotes: [], errors: [], disabledInstruments, fetchedAt: new Date().toISOString() };
  }

  const idsToFetch = enabledInstruments.map(i => i.id);

  let fetched: any[] = [];
  try{
    fetched = await provider.getQuotes(idsToFetch);
    if (Array.isArray(fetched) && fetched.length === 0){
      const attempt = await Promise.all(idsToFetch.map(async id => { try{ return await provider.getQuote(id); }catch(e:any){ return null; } }));
      fetched = attempt.filter(Boolean) as any[];
    }
  }catch(e:any){
    const fallbackPromises = idsToFetch.map(async id => {
      try{ return await provider.getQuote(id); }catch(err:any){ errors.push({ instrumentId: id, symbol: null, code: 'PROVIDER_ERROR', message: sanitizeErrorMessage(err?.message || err) }); return null; }
    });
    const results = await Promise.all(fallbackPromises);
    fetched = results.filter(Boolean) as any[];
  }

  const fetchedById = new Map<string, any>();
  for (const f of fetched){ if (f && f.instrumentId) fetchedById.set(f.instrumentId, f); }

  for (const inst of enabledInstruments){
    const raw = fetchedById.get(inst.id);
    if (!raw){
      errors.push({ instrumentId: inst.id, symbol: inst.providerSymbol || null, code: 'NO_DATA', message: 'No quote available' });
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

      const getNYParts = (d: Date) => {
        const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        const parts = f.formatToParts(d).reduce((acc:any, p:any)=>{ acc[p.type]=p.value; return acc; },{});
        const year = Number(parts.year);
        const month = Number(parts.month);
        const day = Number(parts.day);
        const hour = Number(parts.hour);
        const minute = Number(parts.minute);
        const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d);
        return { year, month, day, hour, minute, weekday };
      };

      const now = new Date();

      const getLatestTradingDateString = () => {
        const pad = (n:number)=> String(n).padStart(2,'0');
        const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        const parts = f.formatToParts(now).reduce((acc:any,p:any)=>{acc[p.type]=p.value;return acc;},{});
        const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day), h = Number(parts.hour), min = Number(parts.minute);
        const beforeOpen = (h < 9) || (h === 9 && min < 30);
        const afterClose = (h > 16) || (h === 16 && min >= 0);
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
          const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).reduce((acc:any,p:any)=>{ acc[p.type]=p.value; return acc; },{});
          return `${parts.year}-${parts.month}-${parts.day}`;
        }catch(e){ return null; }
      })();

      const tsMs = marketTimestamp ? Date.parse(marketTimestamp) : NaN;
      const ageMs = isFinite(tsMs) ? (Date.now() - tsMs) : Infinity;

      const providerIsMarketOpen = (raw.is_market_open === true || raw.is_realtime === true || String(raw.is_market_open).toLowerCase() === 'true');
      const providerIsMarketClosed = (raw.is_market_open === false || String(raw.is_market_open).toLowerCase() === 'false' || (raw.status && String(raw.status).toLowerCase().includes('close')));

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

      quotesOut.push({
        instrumentId,
        symbol,
        name,
        currency: raw.currency || inst.currency || null,
        price: Number.isFinite(Number(price)) ? Number(price) : null,
        previousClose: Number.isFinite(Number(previousClose)) ? Number(previousClose) : null,
        change: Number.isFinite(Number(change)) ? Number(change) : null,
        changePercent: Number.isFinite(Number(changePercent)) ? Number(changePercent) : null,
        marketTimestamp,
        fetchedAt: new Date().toISOString(),
        dataStatus,
        isStale: outIsStale,
        provider: 'twelve-data',
      });
    }catch(e:any){
      errors.push({ instrumentId: inst.id, symbol: inst.providerSymbol || null, code: 'PARSE_ERROR', message: sanitizeErrorMessage(e?.message || e) });
    }
  }

  return { quotes: quotesOut, errors, disabledInstruments, fetchedAt: new Date().toISOString() };
}

export default { STALE_THRESHOLD_MS, sanitizeErrorMessage, classifyQuoteStatus, getNormalizedQuotes };
