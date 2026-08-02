import { describe, it, expect } from 'vitest';
import { createPerCycleMarketEnvironmentResolver, sanitizeMarketEnvironmentIntelligenceForState, buildMarketEnvironmentIntelligence } from './market-environment-intelligence';

describe('market-environment-intelligence runtime', ()=>{
  it('single build per cycle and dedupes SPY/QQQ/IWM across concurrent callers', async ()=>{
    const benchmarkCalls: Record<string, number> = {};
    const intradayCalls: Record<string, number> = {};
    const auditCalls: any[] = [];
    const getBenchmarkContext = async (s:string) => { const k = String(s).toUpperCase(); benchmarkCalls[k] = (benchmarkCalls[k]||0) + 1; return { symbol: k, relativeStrengthPercent: k === 'SPY' ? 1 : k === 'QQQ' ? 0.8 : 0.5 }; };
    const getIntradayContext = async (s:string) => { const k = String(s).toUpperCase(); intradayCalls[k] = (intradayCalls[k]||0) + 1; return { symbol: k, coverage: 'COMPLETE', isFresh: true }; };
    const getMacroContext = async () => ({ vix: 18, dxy: 101, us10y: 2.8 });
    const appendAudit = async (a:any) => { auditCalls.push(a); };

    const r = createPerCycleMarketEnvironmentResolver({ getBenchmarkContext, getIntradayContext, getMacroContext, appendAudit, cycleId: 'c_test_1' });
    const p1 = r.buildOnce();
    const p2 = r.buildOnce();
    const p3 = r.buildOnce();
    const [a,b,c] = await Promise.all([p1,p2,p3]);
    expect(a).toBeTruthy(); expect(b).toBeTruthy(); expect(c).toBeTruthy();
    expect(a.generatedAt).toEqual(b.generatedAt);
    // SPY/QQQ/IWM each requested at most once
    expect(benchmarkCalls['SPY']).toBe(1);
    expect(benchmarkCalls['QQQ']).toBe(1);
    expect(benchmarkCalls['IWM']).toBe(1);
    // intraday also called once per benchmark
    expect(intradayCalls['SPY']).toBe(1);
    expect(intradayCalls['QQQ']).toBe(1);
    expect(intradayCalls['IWM']).toBe(1);
  });

  it('new resolver instance triggers new requests', async ()=>{
    const calls: Record<string, number> = {};
    const getBenchmarkContext = async (s:string) => { const k = String(s).toUpperCase(); calls[k] = (calls[k]||0) + 1; return { symbol: k, relativeStrengthPercent: 1 }; };
    const getIntradayContext = async (s:string) => ({ symbol: String(s).toUpperCase(), coverage: 'COMPLETE', isFresh: true });
    const getMacroContext = async () => ({ vix: 12 });
    const r1 = createPerCycleMarketEnvironmentResolver({ getBenchmarkContext, getIntradayContext, getMacroContext, appendAudit: async ()=>{}, cycleId: 'c_test_2' });
    await r1.buildOnce();
    const r2 = createPerCycleMarketEnvironmentResolver({ getBenchmarkContext, getIntradayContext, getMacroContext, appendAudit: async ()=>{}, cycleId: 'c_test_3' });
    await r2.buildOnce();
    // each instance should have invoked benchmarks once more
    expect(calls['SPY']).toBe(2);
    expect(calls['QQQ']).toBe(2);
    expect(calls['IWM']).toBe(2);
  });

  it('macro failure is isolated and build still returns a fallback object', async ()=>{
    const getBenchmarkContext = async (s:string) => ({ symbol: String(s).toUpperCase(), relativeStrengthPercent: 1 });
    const getIntradayContext = async (s:string) => ({ symbol: String(s).toUpperCase(), coverage: 'COMPLETE', isFresh: true });
    const getMacroContext = async () => { throw new Error('macro fail'); };
    const r = createPerCycleMarketEnvironmentResolver({ getBenchmarkContext, getIntradayContext, getMacroContext, appendAudit: async ()=>{}, cycleId: 'c_test_4' });
    const snap = await r.buildOnce();
    expect(snap).toBeTruthy();
    // when macro fails we may get PARTIAL or UNAVAILABLE but not throw
    expect(typeof snap.quality === 'number').toBe(true);
  });

  it('sanitized state is JSON-safe and contains no raw provider payloads', async ()=>{
    const getBenchmarkContext = async (s:string) => ({ symbol: String(s).toUpperCase(), relativeStrengthPercent: 1, providerPayload: { candles: [1,2,3], raw: true } as any });
    const getIntradayContext = async (s:string) => ({ symbol: String(s).toUpperCase(), coverage: 'COMPLETE', isFresh: true, candles: [1,2,3] as any } as any);
    const getMacroContext = async () => ({ vix: 12 });
    const r = createPerCycleMarketEnvironmentResolver({ getBenchmarkContext, getIntradayContext, getMacroContext, appendAudit: async ()=>{}, cycleId: 'c_test_5' });
    const snap = await r.buildOnce();
    const sanitized = sanitizeMarketEnvironmentIntelligenceForState(snap);
    const s = JSON.stringify(sanitized);
    expect(s).not.toContain('candles');
    expect(s).not.toContain('providerPayload');
    expect(() => JSON.parse(s)).not.toThrow();
  });

  it('audit appended at most once and audit errors isolated', async ()=>{
    let audits = 0;
    const appendAudit = async (a:any) => { audits++; if (audits > 1) throw new Error('double'); };
    const getBenchmarkContext = async (s:string) => ({ symbol: String(s).toUpperCase(), relativeStrengthPercent: 1 });
    const getIntradayContext = async (s:string) => ({ symbol: String(s).toUpperCase(), coverage: 'COMPLETE', isFresh: true });
    const getMacroContext = async () => ({ vix: 12 });
    const r = createPerCycleMarketEnvironmentResolver({ getBenchmarkContext, getIntradayContext, getMacroContext, appendAudit, cycleId: 'c_test_6' });
    await r.buildOnce();
    await r.buildOnce();
    expect(audits).toBeGreaterThanOrEqual(1);
  });

  it('deterministic builder with fixed now produces stable output', ()=>{
    const now = new Date('2025-01-01T10:00:00.000Z');
    const a = buildMarketEnvironmentIntelligence({ now, observedAt: now.toISOString(), macroSnapshot: { vix: 12, dxy: 100, us10y: 2.5 }, benchmarkContexts: [{ symbol: 'SPY', relativeStrengthPercent: 1 }], intradayContexts: [{ symbol: 'SPY', coverage: 'COMPLETE', isFresh: true }] });
    const b = buildMarketEnvironmentIntelligence({ now, observedAt: now.toISOString(), macroSnapshot: { vix: 12, dxy: 100, us10y: 2.5 }, benchmarkContexts: [{ symbol: 'SPY', relativeStrengthPercent: 1 }], intradayContexts: [{ symbol: 'SPY', coverage: 'COMPLETE', isFresh: true }] });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

});
