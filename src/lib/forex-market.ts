// Pure, deterministic Forex session and symbol helpers
export type ForexSessionStatus = 'OPEN' | 'CLOSED' | 'INVALID_DATE';

function getNYParts(d: Date){
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  const parts = f.formatToParts(d).reduce((acc: Record<string,string>, p: Intl.DateTimeFormatPart)=>{ acc[p.type]=p.value; return acc; }, {} as Record<string,string>);
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), weekday: String(parts.weekday) };
}

export function computeForexSessionStatus(now: Date): ForexSessionStatus {
  if (!(now instanceof Date) || isNaN(now.getTime())) return 'INVALID_DATE';
  const p = getNYParts(now);
  const weekday = p.weekday; // e.g. Mon, Tue, Sat
  const minutes = p.hour * 60 + p.minute;
  const openM = 17 * 60; // 17:00
  const closeM = 17 * 60; // Friday close at 17:00

  // Saturday always closed
  if (weekday === 'Sat') return 'CLOSED';
  // Sunday: open only after 17:00 NY
  if (weekday === 'Sun') return minutes >= openM ? 'OPEN' : 'CLOSED';
  // Monday-Thursday open
  if (['Mon','Tue','Wed','Thu'].includes(weekday)) return 'OPEN';
  // Friday: open before 17:00, closed at or after 17:00
  if (weekday === 'Fri') return minutes < closeM ? 'OPEN' : 'CLOSED';

  return 'INVALID_DATE';
}

export function isForexMarketOpen(now: Date): boolean {
  return computeForexSessionStatus(now) === 'OPEN';
}

export function getForexSessionDiagnostics(now: Date){
  const status = computeForexSessionStatus(now);
  const ny = getNYParts(now instanceof Date ? now : new Date());
  return { status, newYorkWeekday: ny.weekday, newYorkHour: ny.hour };
}

// Symbol normalization helpers
export function normalizeForexSymbol(input?: string | null): string | undefined {
  if (!input) return undefined;
  const raw = String(input).trim().toUpperCase();
  // Accept formats: EUR/USD, EUR_USD, EURUSD, eur/usd, etc.
  const cleaned = raw.replace(/[^A-Z]/g,'');
  if (!/^[A-Z]{6}$/.test(cleaned)) return undefined;
  const base = cleaned.slice(0,3);
  const quote = cleaned.slice(3,6);
  return `${base}_${quote}`;
}

export function providerSymbolFromCanonical(canonical?: string | null): string | undefined {
  if (!canonical) return undefined;
  const c = String(canonical).trim().toUpperCase();
  const m = c.match(/^([A-Z]{3})[_]?([A-Z]{3})$/);
  if (!m) return undefined;
  return `${m[1]}/${m[2]}`;
}

import type { FxSekConversionResult } from './market-data/fx-conversion';

export type CanExecuteResult = { allowed: boolean; reasons: string[] };

export function canExecuteForexOrder(opts: { now?: Date; quote?: { price?: number | null; priceSek?: number | null; marketTimestamp?: string | null; isStale?: boolean } | null; instrument?: { assetType?: string | null; tradingEnabled?: boolean | null; quoteCurrency?: string | null; id?: string } | null; conversion?: FxSekConversionResult | null }): CanExecuteResult {
  const { now, quote, instrument } = opts;
  const conversion = (opts as any).conversion as FxSekConversionResult | undefined | null;
  const reasons: string[] = [];
  if (!instrument || String((instrument as any).assetType || '').toUpperCase() !== 'FOREX'){
    reasons.push('NOT_FOREX');
    return { allowed: false, reasons };
  }
  if (!instrument.tradingEnabled){
    reasons.push('FOREX_TRADING_DISABLED');
    return { allowed: false, reasons };
  }
  // session must be open
  const n = now instanceof Date ? now : new Date();
  if (!isForexMarketOpen(n)){
    reasons.push('FOREX_SESSION_CLOSED');
    return { allowed: false, reasons };
  }
  // quote must exist and have valid positive price
  if (!quote || quote.price === null || quote.price === undefined || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0){
    reasons.push('QUOTE_UNAVAILABLE');
    return { allowed: false, reasons };
  }
  // timestamp valid
  if (!quote.marketTimestamp || isNaN(Date.parse(String(quote.marketTimestamp)))){
    reasons.push('QUOTE_TIMESTAMP_INVALID');
    return { allowed: false, reasons };
  }
  const tsMs = Date.parse(String(quote.marketTimestamp));
  if (tsMs > Date.now()){ reasons.push('QUOTE_TIMESTAMP_FUTURE'); return { allowed: false, reasons }; }
  // freshness check: if flagged stale, block
  if (quote.isStale) { reasons.push('QUOTE_STALE'); return { allowed: false, reasons }; }

  // Notional / SEK conversion: require VERIFIED conversion or priceSek present
  const qc = String((instrument && (instrument as any).quoteCurrency) || '').toUpperCase();
  if (qc !== 'SEK'){
    // prefer explicit conversion result
    if (conversion){
      if (conversion.status !== 'VERIFIED'){
        // map conversion statuses to blocking reasons
        switch(conversion.status){
          case 'MISSING_RATE': reasons.push('FOREX_CONVERSION_RATE_MISSING'); break;
          case 'STALE_RATE': reasons.push('FOREX_CONVERSION_RATE_STALE'); break;
          case 'FUTURE_RATE': reasons.push('FOREX_CONVERSION_RATE_FUTURE'); break;
          case 'INVALID_RATE': reasons.push('FOREX_CONVERSION_RATE_INVALID'); break;
          case 'UNSUPPORTED_PATH': reasons.push('FOREX_CONVERSION_PATH_UNSUPPORTED'); break;
          default: reasons.push('FOREX_NOTIONAL_CONVERSION_UNAVAILABLE');
        }
        return { allowed: false, reasons };
      }
    } else {
      if (!(quote.priceSek && Number.isFinite(Number(quote.priceSek)))){
        reasons.push('FOREX_NOTIONAL_CONVERSION_UNAVAILABLE');
        return { allowed: false, reasons };
      }
    }
  }

  return { allowed: true, reasons };
}
