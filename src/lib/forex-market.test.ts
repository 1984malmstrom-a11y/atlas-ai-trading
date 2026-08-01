import { describe, it, expect } from 'vitest';
import { computeForexSessionStatus, isForexMarketOpen, normalizeForexSymbol, providerSymbolFromCanonical, getForexSessionDiagnostics } from './forex-market';

describe('Forex session helper deterministic checks', ()=>{
  it('Saturday 2026-08-01 19:45 Europe/Stockholm -> CLOSED', ()=>{
    const d = new Date('2026-08-01T19:45:00+02:00');
    expect(computeForexSessionStatus(d)).toBe('CLOSED');
    expect(isForexMarketOpen(d)).toBe(false);
  });

  it('Sunday 2026-08-02 22:30 CEST -> CLOSED (before NY 17:00)', ()=>{
    const d = new Date('2026-08-02T22:30:00+02:00');
    expect(computeForexSessionStatus(d)).toBe('CLOSED');
  });

  it('Sunday after NY open -> OPEN', ()=>{
    // NY 2026-08-02T17:30:00-04:00 corresponds to 2026-08-03T?? depending; use NY instant by constructing explicit NY time
    const ny = new Date('2026-08-02T17:30:00-04:00');
    // Also ensure provider diagnostics include weekday/hour
    const diag = getForexSessionDiagnostics(ny);
    expect(diag.status).toBe('OPEN');
    expect(isForexMarketOpen(ny)).toBe(true);
  });

  it('Monday 2026-08-03 09:00 CEST -> OPEN', ()=>{
    const d = new Date('2026-08-03T09:00:00+02:00');
    expect(isForexMarketOpen(d)).toBe(true);
  });

  it('Friday close behavior at NY 17:00 -> CLOSED at or after', ()=>{
    const before = new Date('2026-08-07T16:59:00-04:00');
    const at = new Date('2026-08-07T17:00:00-04:00');
    const after = new Date('2026-08-07T17:30:00-04:00');
    expect(isForexMarketOpen(before)).toBe(true);
    expect(computeForexSessionStatus(at)).toBe('CLOSED');
    expect(isForexMarketOpen(after)).toBe(false);
  });

  it('normalizeForexSymbol: various inputs => EUR_USD', ()=>{
    expect(normalizeForexSymbol('EUR/USD')).toBe('EUR_USD');
    expect(normalizeForexSymbol('EUR_USD')).toBe('EUR_USD');
    expect(normalizeForexSymbol('EURUSD')).toBe('EUR_USD');
    expect(normalizeForexSymbol('eur/usd')).toBe('EUR_USD');
  });

  it('providerSymbolFromCanonical: EUR_USD -> EUR/USD', ()=>{
    expect(providerSymbolFromCanonical('EUR_USD')).toBe('EUR/USD');
  });

  it('invalid date input -> INVALID_DATE', ()=>{
    // @ts-ignore
    expect(computeForexSessionStatus(new Date('invalid'))).toBe('INVALID_DATE');
  });

});

describe('Status wrapper isolation', ()=>{
  it('does not mutate Date input', ()=>{
    const d = new Date('2026-08-03T09:00:00+02:00');
    const copy = new Date(d.toISOString());
    // call diagnostics
    getForexSessionDiagnostics(d);
    expect(d.toISOString()).toBe(copy.toISOString());
  });
});
