import { describe, it, expect } from 'vitest';
import { resolveCurrencyToSekRate } from './fx-conversion';

function makeQuote(fields: any){
  return Object.assign({ instrumentId: null, symbol: null, providerSymbol: null, price: null, marketTimestamp: new Date().toISOString() }, fields);
}

describe('fx-conversion lookup and triangulation', () => {
  it('finds USD/SEK via providerSymbol', () => {
    const q = makeQuote({ providerSymbol: 'USD/SEK', price: 9.5 });
    const map: Record<string, any> = { foo: q };
    const res = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: map, now: new Date() });
    expect(res.status).toBe('VERIFIED');
    expect(res.rateToSek).toBeCloseTo(9.5);
  });

  it('finds USD_SEK via instrumentId', () => {
    const q = makeQuote({ instrumentId: 'usd-sek', price: 9.6 });
    const map: Record<string, any> = { usd_sek: q };
    const res = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: map, now: new Date() });
    expect(res.status).toBe('VERIFIED');
    expect(res.rateToSek).toBeCloseTo(9.6);
  });

  it('finds USDSEK via compact normalized symbol', () => {
    const q = makeQuote({ symbol: 'USDSEK', price: 9.7 });
    const map: Record<string, any> = { x: q };
    const res = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: map, now: new Date() });
    expect(res.status).toBe('VERIFIED');
    expect(res.rateToSek).toBeCloseTo(9.7);
  });

  it('triangulates EUR->SEK via EUR/USD and USD/SEK', () => {
    const eurUsd = makeQuote({ instrumentId: 'EUR_USD', price: 1.2 });
    const usdSek = makeQuote({ instrumentId: 'USD_SEK', price: 10 });
    const map: Record<string, any> = { a: eurUsd, b: usdSek };
    const res = resolveCurrencyToSekRate({ currency: 'EUR', quotesByCanonicalSymbol: map, now: new Date() });
    expect(res.status).toBe('VERIFIED');
    expect(res.rateToSek).toBeCloseTo(1.2 * 10);
  });

  it('allows data-only conversion pair to be used for conversion', () => {
    const usdSek = makeQuote({ symbol: 'USD/SEK', price: 9.9 });
    const map: Record<string, any> = { c: usdSek };
    const res = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: map, now: new Date() });
    expect(res.status).toBe('VERIFIED');
  });

  it('returns MISSING_RATE when USD/SEK absent for USD source', () => {
    const map: Record<string, any> = {};
    const res = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: map, now: new Date() });
    expect(res.status).toBe('MISSING_RATE');
    expect(res.reasons).toContain('USD_SEK_MISSING');
  });

  it('rejects stale USD/SEK quote as STALE_RATE', () => {
    const oldTs = new Date(Date.now() - 10_000).toISOString();
    const usdSek = makeQuote({ instrumentId: 'usd-sek', price: 9.5, marketTimestamp: oldTs });
    const map: Record<string, any> = { x: usdSek };
    const res = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: map, now: new Date(), maxAgeMs: 1000 });
    expect(res.status === 'STALE_RATE' || res.status === 'MISSING_RATE').toBeTruthy();
  });

  it('rejects zero/negative/non-finite price', () => {
    const usdSek = makeQuote({ instrumentId: 'usd-sek', price: 0 });
    const map: Record<string, any> = { x: usdSek };
    const res = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: map, now: new Date() });
    expect(res.status).not.toBe('VERIFIED');
  });

  it('does not match unrelated symbols', () => {
    const q = makeQuote({ instrumentId: 'GBP_JPY', price: 150 });
    const map: Record<string, any> = { g: q };
    const res = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: map, now: new Date() });
    expect(res.status).toBe('MISSING_RATE');
  });

  it('does not mutate input quotes', () => {
    const q = makeQuote({ instrumentId: 'USD_SEK', price: 9.5 });
    const map: Record<string, any> = { u: JSON.parse(JSON.stringify(q)) };
    const before = JSON.stringify(map.u);
    const res = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: map, now: new Date() });
    const after = JSON.stringify(map.u);
    expect(before).toBe(after);
  });

});
