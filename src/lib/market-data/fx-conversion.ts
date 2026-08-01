import { STALE_THRESHOLD_MS } from './quotes-service';

export type FxConversionStatus = 'VERIFIED' | 'MISSING_RATE' | 'STALE_RATE' | 'FUTURE_RATE' | 'INVALID_RATE' | 'UNSUPPORTED_PATH';

export type FxConversionLeg = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  observedAt: string;
};

export type FxSekConversionResult = {
  status: FxConversionStatus;
  sourceCurrency: string;
  targetCurrency: 'SEK';
  rateToSek?: number;
  path: FxConversionLeg[];
  observedAt?: string;
  isFresh: boolean;
  reasons: string[];
};

function normalizeKey(s: string){ return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '_'); }

function findQuote(quotesByCanonicalSymbol: Record<string, any>, a: string, b: string){
  const k1 = normalizeKey(`${a}_${b}`);
  const k2 = normalizeKey(`${a}/${b}`);
  const k3 = normalizeKey(`${a}${b}`);
  return quotesByCanonicalSymbol[k1] || quotesByCanonicalSymbol[k2] || quotesByCanonicalSymbol[k3] || null;
}

export function resolveCurrencyToSekRate(params: { currency: string; quotesByCanonicalSymbol: Record<string, any>; now?: Date; maxAgeMs?: number }): FxSekConversionResult {
  const { currency, quotesByCanonicalSymbol, now, maxAgeMs } = params;
  const nowDate = now instanceof Date ? now : new Date();
  const maxAge = typeof maxAgeMs === 'number' ? maxAgeMs : STALE_THRESHOLD_MS || 2 * 60_000;
  const src = String(currency || '').toUpperCase();
  const outBase: FxSekConversionResult = { status: 'MISSING_RATE', sourceCurrency: src, targetCurrency: 'SEK', path: [], isFresh: false, reasons: [] };

  if (!src) { outBase.status = 'UNSUPPORTED_PATH'; outBase.reasons.push('INVALID_CURRENCY'); return outBase; }
  if (src === 'SEK') { outBase.status = 'VERIFIED'; outBase.rateToSek = 1; outBase.isFresh = true; outBase.observedAt = nowDate.toISOString(); outBase.path = [ { fromCurrency: 'SEK', toCurrency: 'SEK', rate: 1, observedAt: nowDate.toISOString() } ]; return outBase; }

  // Helper to inspect a single quote leg
  const inspectLeg = (from:string, to:string) => {
    const q = findQuote(quotesByCanonicalSymbol, from, to);
    if (!q) return { ok: false, reason: 'MISSING' } as const;
    const price = Number(q.price ?? q.rate ?? null);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: 'INVALID' } as const;
    const ts = q.marketTimestamp || q.fetchedAt || q.timestamp || q.observedAt || null;
    if (!ts) return { ok: false, reason: 'MISSING_TS' } as const;
    const tsMs = Date.parse(String(ts));
    if (!isFinite(tsMs)) return { ok: false, reason: 'INVALID_TS' } as const;
    const age = nowDate.getTime() - tsMs;
    const leg: FxConversionLeg = { fromCurrency: from, toCurrency: to, rate: price, observedAt: new Date(tsMs).toISOString() };
    return { ok: true, leg, age, tsMs } as const;
  };

  // Direct USD->SEK path check (many triangulations depend on USD_SEK)
  const usdSek = inspectLeg('USD','SEK');

  // Direct pair available?
  const direct = inspectLeg(src,'SEK');
  if (direct.ok){
    const reasons: string[] = [];
    if (direct.age! < 0){ outBase.status = 'FUTURE_RATE'; outBase.reasons.push('LEG_FUTURE'); return outBase; }
    if (direct.age! > maxAge){ outBase.status = 'STALE_RATE'; outBase.reasons.push('LEG_STALE'); return outBase; }
    outBase.status = 'VERIFIED'; outBase.rateToSek = direct.leg.rate; outBase.isFresh = true; outBase.path = [direct.leg]; outBase.observedAt = direct.leg.observedAt; return outBase;
  }

  // USD needs USD/SEK specifically
  if (src === 'USD'){
    if (!usdSek.ok){ outBase.status = 'MISSING_RATE'; outBase.reasons.push('USD_SEK_MISSING'); return outBase; }
    if (usdSek.age! < 0){ outBase.status = 'FUTURE_RATE'; outBase.reasons.push('USD_SEK_FUTURE'); return outBase; }
    if (usdSek.age! > maxAge){ outBase.status = 'STALE_RATE'; outBase.reasons.push('USD_SEK_STALE'); return outBase; }
    outBase.status = 'VERIFIED'; outBase.rateToSek = usdSek.leg.rate; outBase.isFresh = true; outBase.path = [usdSek.leg]; outBase.observedAt = usdSek.leg.observedAt; return outBase;
  }

  // Triangulation helpers
  const tryViaUsd = (pair:string) => {
    const leg = inspectLeg(src, 'USD');
    if (!leg.ok) return { status: 'MISSING_RATE', reason: 'LEG_'+String((leg as any).reason) } as const;
    if (!usdSek.ok) return { status: 'MISSING_RATE', reason: 'USD_SEK_MISSING' } as const;
    // check freshness
    if (leg.age! < 0 || usdSek.age! < 0) return { status: 'FUTURE_RATE', reason: 'FUTURE_LEG' } as const;
    if (leg.age! > maxAge || usdSek.age! > maxAge) return { status: 'STALE_RATE', reason: 'STALE_LEG' } as const;
    const rateToSek = leg.leg.rate * usdSek.leg.rate; // e.g., EUR/USD * USD/SEK
    const observedAt = new Date(Math.min(Date.parse(leg.leg.observedAt), Date.parse(usdSek.leg.observedAt))).toISOString();
    return { status: 'VERIFIED', rateToSek, path: [ leg.leg, usdSek.leg ], observedAt } as const;
  };

  // JPY special: USD/JPY exists as USD->JPY (JPY per USD)
  if (src === 'JPY'){
    const usdJpy = inspectLeg('USD','JPY');
    if (!usdJpy.ok){ outBase.status = 'MISSING_RATE'; outBase.reasons.push('USD_JPY_MISSING'); return outBase; }
    if (!usdSek.ok){ outBase.status = 'MISSING_RATE'; outBase.reasons.push('USD_SEK_MISSING'); return outBase; }
    if (usdJpy.age! < 0 || usdSek.age! < 0){ outBase.status = 'FUTURE_RATE'; outBase.reasons.push('FUTURE_LEG'); return outBase; }
    if (usdJpy.age! > maxAge || usdSek.age! > maxAge){ outBase.status = 'STALE_RATE'; outBase.reasons.push('STALE_LEG'); return outBase; }
    // SEK per JPY = USD/SEK ÷ USD/JPY
    const rateToSek = usdSek.leg.rate / usdJpy.leg.rate;
    const observedAt = new Date(Math.min(usdJpy.leg.observedAt ? Date.parse(usdJpy.leg.observedAt) : Infinity, Date.parse(usdSek.leg.observedAt))).toISOString();
    outBase.status = 'VERIFIED'; outBase.rateToSek = rateToSek; outBase.path = [ usdJpy.leg, usdSek.leg ]; outBase.isFresh = true; outBase.observedAt = observedAt; return outBase;
  }

  // For EUR/GBP/AUD/CAD/CHF/NZD -> prefer direct or via USD
  const commonViaUsd = ['EUR','GBP','AUD','CAD','CHF','NZD'];
  if (commonViaUsd.includes(src)){
    // prefer direct EUR_SEK if present (already checked), otherwise via USD
    const via = tryViaUsd(src + '_USD');
    if ((via as any).status === 'VERIFIED'){
      outBase.status = 'VERIFIED'; outBase.rateToSek = (via as any).rateToSek; outBase.path = (via as any).path; outBase.observedAt = (via as any).observedAt; outBase.isFresh = true; return outBase;
    }
    // map failure reasons
    if ((via as any).status === 'STALE_RATE'){ outBase.status = 'STALE_RATE'; outBase.reasons.push('STALE_LEG'); return outBase; }
    if ((via as any).status === 'FUTURE_RATE'){ outBase.status = 'FUTURE_RATE'; outBase.reasons.push('FUTURE_LEG'); return outBase; }
    // otherwise unsupported
    outBase.status = 'UNSUPPORTED_PATH'; outBase.reasons.push('NO_PATH'); return outBase;
  }

  outBase.status = 'UNSUPPORTED_PATH'; outBase.reasons.push('CURRENCY_NOT_SUPPORTED'); return outBase;
}

export function resolveForexPriceSek(params: { instrument: { id?:string; providerSymbol?:string; baseAsset?:string; quoteCurrency?:string }, quote: { price?: number | null; marketTimestamp?: string | null }, conversion: FxSekConversionResult, now?: Date }){
  const { instrument, quote, conversion, now } = params;
  const res: { priceSek?: number; conversionStatus: FxConversionStatus; conversionPath?: string[]; observedAt?: string; isFresh: boolean; reasons: string[] } = { conversionStatus: conversion.status, isFresh: false, reasons: [] };
  // require VERIFIED conversion
  if (!conversion || conversion.status !== 'VERIFIED' || typeof conversion.rateToSek !== 'number' || !Number.isFinite(conversion.rateToSek) || conversion.rateToSek <= 0){ res.conversionStatus = conversion ? conversion.status : 'MISSING_RATE'; res.reasons.push('CONVERSION_NOT_VERIFIED'); return res; }
  const price = quote && typeof quote.price === 'number' && Number.isFinite(quote.price) && quote.price > 0 ? Number(quote.price) : undefined;
  if (!price){ res.reasons.push('QUOTE_PRICE_INVALID'); return res; }
  const tsMs = quote && quote.marketTimestamp ? Date.parse(String(quote.marketTimestamp)) : NaN;
  if (!isFinite(tsMs)){ res.reasons.push('QUOTE_TIMESTAMP_INVALID'); return res; }
  if (tsMs > (now instanceof Date ? now.getTime() : Date.now())){ res.reasons.push('QUOTE_TIMESTAMP_FUTURE'); res.conversionStatus = 'FUTURE_RATE'; return res; }
  // compute priceSek: quote.price (QUOTE per BASE) * SEK per QUOTE = SEK per BASE
  const priceSek = price * conversion.rateToSek;
  if (!Number.isFinite(priceSek) || priceSek <= 0){ res.conversionStatus = 'INVALID_RATE'; res.reasons.push('PRICESEK_INVALID'); return res; }
  // observedAt: use the oldest observation among quote timestamp and conversion observedAt
  const convObsMs = conversion.observedAt ? Date.parse(conversion.observedAt) : NaN;
  const observedMs = Math.min(isFinite(convObsMs) ? convObsMs : tsMs, tsMs);
  res.priceSek = priceSek; res.isFresh = conversion.isFresh && ((now instanceof Date ? now.getTime() : Date.now()) - tsMs <= (STALE_THRESHOLD_MS || 2*60_000)); res.conversionPath = conversion.path.map(p => p.fromCurrency).concat([ conversion.path[conversion.path.length-1].toCurrency ]); res.observedAt = new Date(observedMs).toISOString(); return res;
}
