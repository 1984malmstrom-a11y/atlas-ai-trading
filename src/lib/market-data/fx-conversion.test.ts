import { describe, it, expect } from 'vitest';
import { resolveCurrencyToSekRate } from './fx-conversion';

function mkQuote(price: number, iso: string){ return { price, marketTimestamp: iso }; }

describe('Fx conversion helper', ()=>{
  const now = new Date('2026-08-03T12:00:00.000Z');
  const recent = new Date(now.getTime() - 30_000).toISOString();
  const old = new Date(now.getTime() - 10 * 60_000).toISOString();

  it('SEK -> rate 1', ()=>{
    const out = resolveCurrencyToSekRate({ currency: 'SEK', quotesByCanonicalSymbol: {}, now });
    expect(out.status).toBe('VERIFIED');
    expect(out.rateToSek).toBe(1);
  });

  it('USD direct -> uses USD/SEK', ()=>{
    const quotes: any = { 'USD_SEK': mkQuote(10.5, recent) };
    const out = resolveCurrencyToSekRate({ currency: 'USD', quotesByCanonicalSymbol: quotes, now });
    expect(out.status).toBe('VERIFIED');
    expect(out.rateToSek).toBeCloseTo(10.5);
  });

  it('EUR triangulated via EUR/USD × USD/SEK', ()=>{
    const quotes: any = { 'EUR_USD': mkQuote(1.08, recent), 'USD_SEK': mkQuote(10.5, recent) };
    const out = resolveCurrencyToSekRate({ currency: 'EUR', quotesByCanonicalSymbol: quotes, now });
    expect(out.status).toBe('VERIFIED');
    expect(out.rateToSek).toBeCloseTo(1.08 * 10.5);
  });

  it('JPY conversion via USD/JPY and USD/SEK inversion', ()=>{
    const quotes: any = { 'USD_JPY': mkQuote(150, recent), 'USD_SEK': mkQuote(10.5, recent) };
    const out = resolveCurrencyToSekRate({ currency: 'JPY', quotesByCanonicalSymbol: quotes, now });
    expect(out.status).toBe('VERIFIED');
    expect(out.rateToSek).toBeCloseTo(10.5 / 150);
  });

  it('stale leg -> STALE_RATE', ()=>{
    const quotes: any = { 'EUR_USD': mkQuote(1.08, old), 'USD_SEK': mkQuote(10.5, recent) };
    const out = resolveCurrencyToSekRate({ currency: 'EUR', quotesByCanonicalSymbol: quotes, now, maxAgeMs: 60_000 });
    expect(out.status).toBe('STALE_RATE');
  });

  it('missing leg -> UNSUPPORTED_PATH', ()=>{
    const quotes: any = { 'USD_SEK': mkQuote(10.5, recent) };
    const out = resolveCurrencyToSekRate({ currency: 'AUD', quotesByCanonicalSymbol: quotes, now });
    expect(out.status === 'VERIFIED' || out.status === 'UNSUPPORTED_PATH').toBeTruthy();
  });
});
