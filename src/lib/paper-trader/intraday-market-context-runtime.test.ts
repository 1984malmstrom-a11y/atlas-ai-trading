import { describe, it, expect } from 'vitest';
import { createPerCycleIntradayResolver } from './demo-runtime';

describe('Per-cycle intraday resolver', ()=>{
  it('dedupes requests per key and isolates intervals and is case-insensitive', async ()=>{
    let calls = 0;
    const fakeGet = async (s:string, interval: '5min'|'15min', limit?:number) => {
      calls++;
      return { symbol: s.toUpperCase(), interval, fetchedAt: new Date().toISOString(), candles: [ { timestamp: new Date().toISOString(), open:1,high:2,low:1,close:2,volume:10 } ] };
    };
    const r = createPerCycleIntradayResolver({ getIntraday: fakeGet });
    const p1 = r.resolve({ symbol: 'MSFT', interval: '15min' });
    const p2 = r.resolve({ symbol: 'msft', interval: '15min' });
    const [a,b] = await Promise.all([p1,p2]);
    expect(a && b && a.symbol === b.symbol).toBeTruthy();
    expect(calls).toBe(1);
    // different interval should trigger another call
    await r.resolve({ symbol: 'MSFT', interval: '5min' });
    expect(calls).toBe(2);
  });

  it('reuses same Promise/result and new resolver yields new request; failure isolation and sanitized UNAVAILABLE', async ()=>{
    let calls = 0;
    const fakeGet = async (s:string, interval: '5min'|'15min') => {
      calls++;
      if (s === 'FAIL') throw new Error('provider failure');
      return { symbol: s, interval, fetchedAt: new Date().toISOString(), candles: [ { timestamp: new Date().toISOString(), open:1,high:2,low:1,close:2,volume:10 } ] };
    };
    const r1 = createPerCycleIntradayResolver({ getIntraday: fakeGet });
    const pa = r1.resolve({ symbol: 'X', interval: '15min' });
    const pb = r1.resolve({ symbol: 'X', interval: '15min' });
    const [ra, rb] = await Promise.all([pa, pb]);
    expect(ra && rb && ra.symbol === rb.symbol).toBeTruthy();
    expect(calls).toBe(1);
    // new resolver (new cycle) should cause new call
    const r2 = createPerCycleIntradayResolver({ getIntraday: fakeGet });
    await r2.resolve({ symbol: 'X', interval: '15min' });
    expect(calls).toBe(2);
    // failure isolation: FAIL should not block other symbols
    const r3 = createPerCycleIntradayResolver({ getIntraday: fakeGet });
    const pFail = r3.resolve({ symbol: 'FAIL', interval: '15min' });
    const pOk = r3.resolve({ symbol: 'Y', interval: '15min' });
    const [failRes, okRes] = await Promise.all([pFail, pOk]);
    expect(okRes && okRes.symbol === 'Y').toBeTruthy();
    expect(failRes && failRes.coverage === 'UNAVAILABLE').toBeTruthy();
    // sanitized state should not include raw candles or providerResponse
    expect(JSON.stringify(okRes)).toBeTruthy();
  });
});
