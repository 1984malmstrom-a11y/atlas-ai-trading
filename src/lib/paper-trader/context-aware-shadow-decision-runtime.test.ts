import { describe, it, expect, vi } from 'vitest';
import { createPerCycleContextAwareShadowResolver, sanitizeContextAwareShadowDecisionForState } from './context-aware-shadow-decision';

describe('Context-aware Shadow Decision runtime resolver', ()=>{
  it('normalizes symbol and dedupes build (msft/MSFT) and reuses promise', async ()=>{
    const buildDiag = vi.fn(({ action, confidence }: any) => ({ contextAlignment: 'SUPPORTIVE', historicalContext: { longTrend: 'UP' }, marketRegime: { primaryRegime: 'BULL_TREND' } }));
    const resolver = createPerCycleContextAwareShadowResolver({ getHistoricalSnapshot: async (s:string)=> null, getMarketRegimeSnapshot: async (s:string)=> null, buildDiagnostics: buildDiag });
    const p1 = resolver.resolve({ symbol: 'msft', actualAction: 'BUY', actualConfidence: 80 });
    const p2 = resolver.resolve({ symbol: 'MSFT', actualAction: 'BUY', actualConfidence: 80 });
    const r1 = await p1 as any;
    const r2 = await p2 as any;
    expect(buildDiag).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r1.symbol).toBe('MSFT');
  });

  it('same promise result reused and new cycle creates new cache', async ()=>{
    const buildDiag1 = vi.fn(()=> ({ contextAlignment: 'NEUTRAL' }));
    const r1 = createPerCycleContextAwareShadowResolver({ buildDiagnostics: buildDiag1 });
    const a1 = await r1.resolve({ symbol: 'X', actualAction: 'BUY', actualConfidence: 50 });
    const a2 = await r1.resolve({ symbol: 'X', actualAction: 'BUY', actualConfidence: 50 });
    expect(buildDiag1).toHaveBeenCalledTimes(1);
    const buildDiag2 = vi.fn(()=> ({ contextAlignment: 'CONFLICTING' }));
    const r2 = createPerCycleContextAwareShadowResolver({ buildDiagnostics: buildDiag2 });
    const b1 = await r2.resolve({ symbol: 'X', actualAction: 'BUY', actualConfidence: 50 });
    expect(buildDiag2).toHaveBeenCalledTimes(1);
    expect(a1).toBeTruthy(); expect(b1).toBeTruthy();
    expect(a1!.shadowConfidence).not.toBe(b1!.shadowConfidence);
  });

  it('different action for same symbol is isolated (BUY vs SELL)', async ()=>{
    const buildDiag = vi.fn(()=> ({ contextAlignment: 'CONFLICTING', historicalContext: { longTrend: 'DOWN' } }));
    const r = createPerCycleContextAwareShadowResolver({ buildDiagnostics: buildDiag });
    const pBuy = r.resolve({ symbol: 'A', actualAction: 'BUY', actualConfidence: 90 });
    const pSell = r.resolve({ symbol: 'A', actualAction: 'SELL', actualConfidence: 90 });
    await Promise.all([pBuy, pSell]);
    expect(buildDiag).toHaveBeenCalledTimes(2);
  });

  it('symbol A failure does not block B', async ()=>{
    const buildDiag = vi.fn((opts:any)=>{ if (opts && opts.action === 'BUY' && opts.historicalContext && opts.historicalContext.fail) throw new Error('boom'); return { contextAlignment: 'NEUTRAL' }; });
    const r = createPerCycleContextAwareShadowResolver({ getHistoricalSnapshot: async (s:string)=> s === 'ERR' ? { fail: true } : null, buildDiagnostics: buildDiag });
    const pErr = r.resolve({ symbol: 'ERR', actualAction: 'BUY', actualConfidence: 50 });
    const pOk = r.resolve({ symbol: 'OK', actualAction: 'BUY', actualConfidence: 50 });
    const res = await Promise.all([pErr.catch(e=>e), pOk]);
    expect(res[1]).toBeTruthy();
  });

  it('sanitizer produces defensive copy, JSON safe and forbids raw fields', ()=>{
    const raw: any = { symbol: 'Z', generatedAt: new Date().toISOString(), actualAction: 'BUY', actualConfidence: 80, shadowAction: 'BUY', shadowConfidence: 85, supportingReasons: ['A','A','B'], conflictingReasons: [], warnings: [], closes: [1,2,3], dates: [], providerResponse: 'x', apiKey: 'secret' };
    const s = sanitizeContextAwareShadowDecisionForState(raw as any);
    expect(s).not.toBeNull();
    expect(s!.symbol).toBe('Z');
    expect(s! as any).not.toHaveProperty('closes');
    expect(s! as any).not.toHaveProperty('providerResponse');
    expect(() => JSON.stringify(s)).not.toThrow();
    expect(Array.isArray(s!.supportingReasons)).toBe(true);
    expect(s!.supportingReasons.length).toBeGreaterThan(0);
  });
});
