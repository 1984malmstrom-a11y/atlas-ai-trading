import { describe, it, expect } from 'vitest';
import { resolveForexPriceSek } from './fx-conversion';

describe('Forex price SEK computation and quantity', ()=>{
  const now = new Date('2026-08-03T12:00:00.000Z');
  it('EUR/USD price -> SEK using USD/SEK conversion', ()=>{
    const inst = { id: 'EUR_USD', baseAsset: 'EUR', quoteCurrency: 'USD' } as any;
    const quote = { price: 1.08, marketTimestamp: new Date().toISOString() } as any;
    const conv = { status: 'VERIFIED', sourceCurrency: 'USD', targetCurrency: 'SEK', rateToSek: 10.5, path: [{ fromCurrency: 'USD', toCurrency: 'SEK', rate: 10.5, observedAt: new Date().toISOString() }], observedAt: new Date().toISOString(), isFresh: true, reasons: [] } as any;
    const res = resolveForexPriceSek({ instrument: inst, quote, conversion: conv, now });
    expect(res.priceSek).toBeCloseTo(1.08 * 10.5);
    // quantity for orderValueSek 1000
    const orderValueSek = 1000;
    const qty = orderValueSek / (res.priceSek as number);
    expect(qty).toBeGreaterThan(0);
  });
});
