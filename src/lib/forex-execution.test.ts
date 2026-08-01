import { describe, it, expect } from 'vitest';
import { canExecuteForexOrder } from './forex-market';

describe('Forex execution gate', ()=>{
  it('blocks when session closed (Saturday)', ()=>{
    const sat = new Date('2026-08-01T12:00:00+02:00');
    const res = canExecuteForexOrder({ now: sat, quote: { price: 1.1, marketTimestamp: new Date().toISOString() }, instrument: { assetType: 'FOREX', tradingEnabled: true, quoteCurrency: 'USD' } });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('FOREX_SESSION_CLOSED');
  });

  it('blocks when tradingEnabled=false', ()=>{
    const mon = new Date('2026-08-03T12:00:00+02:00');
    const res = canExecuteForexOrder({ now: mon, quote: { price: 1.1, marketTimestamp: new Date().toISOString() }, instrument: { assetType: 'FOREX', tradingEnabled: false, quoteCurrency: 'USD' } });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('FOREX_TRADING_DISABLED');
  });

  it('blocks when priceSek conversion missing', ()=>{
    const mon = new Date('2026-08-03T12:00:00+02:00');
    const res = canExecuteForexOrder({ now: mon, quote: { price: 1.1, marketTimestamp: new Date().toISOString(), isStale: false }, instrument: { assetType: 'FOREX', tradingEnabled: true, quoteCurrency: 'USD' } });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('FOREX_NOTIONAL_CONVERSION_UNAVAILABLE');
  });

  it('allows when open, tradingEnabled and priceSek present', ()=>{
    const mon = new Date('2026-08-03T12:00:00+02:00');
    const res = canExecuteForexOrder({ now: mon, quote: { price: 1.1, priceSek: 12.2, marketTimestamp: new Date().toISOString(), isStale: false }, instrument: { assetType: 'FOREX', tradingEnabled: true, quoteCurrency: 'USD' } });
    expect(res.allowed).toBe(true);
  });
});
