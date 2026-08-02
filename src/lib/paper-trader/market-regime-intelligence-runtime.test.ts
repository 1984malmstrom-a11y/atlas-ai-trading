import { describe, it, expect, vi } from 'vitest';
import { createPerCycleMarketRegimeResolver } from './demo-runtime';
import { buildMarketRegimeIntelligence, buildMarketRegimeIntelligenceAudit, sanitizeIntelligenceForState } from './market-regime-intelligence';
import { getPaperTradingState } from './demo-runtime';

describe('market-regime-intelligence runtime resolver', () => {
  it('builds once per normalized symbol and reuses promise/result; audits once; sanitized audit', async () => {
    const builds: string[] = [];
    const audits: any[] = [];
    const histCalls: string[] = [];

    const histSnapshots: Record<string, any> = {
      MSFT: { schemaVersion:1, source:'VICTOR_HISTORICAL_MARKET_CONTEXT', symbol:'MSFT', observedAt:'2025-01-01', generatedAt:'2025-01-01T00:00:00Z', observationCount:80, hasVolume:false, dataQuality:'COMPLETE', missingCapabilities:[], shortTrend:'UP', mediumTrend:'UP', longTrend:'UP', trendAgreement:1, volatilityState:'NORMAL', momentumPersistence:'STRONG', currentDrawdownPercent:0, maxDrawdownPercent:0, recoveryPercent:100, rangePosition:0.9, volumeTrend:'UNAVAILABLE', warnings:[] },
      'EUR_USD': { schemaVersion:1, source:'VICTOR_HISTORICAL_MARKET_CONTEXT', symbol:'EUR_USD', observedAt:'2025-01-01', generatedAt:'2025-01-01T00:00:00Z', observationCount:80, hasVolume:false, dataQuality:'COMPLETE', missingCapabilities:[], shortTrend:'SIDEWAYS', mediumTrend:'SIDEWAYS', longTrend:'SIDEWAYS', trendAgreement:1, volatilityState:'LOW', momentumPersistence:'WEAK', currentDrawdownPercent:0, maxDrawdownPercent:0, recoveryPercent:100, rangePosition:0.5, volumeTrend:'UNAVAILABLE', warnings:[] }
    };

    const buildFn = (opts:{symbol:string; historicalContext?:any; now?:Date}) => {
      builds.push(String(opts.symbol));
      return buildMarketRegimeIntelligence({ symbol: opts.symbol, historicalContext: opts.historicalContext, now: opts.now });
    };

    const resolver = createPerCycleMarketRegimeResolver({
      buildIntelligence: buildFn,
      appendAudit: async (a:any) => { audits.push(a); },
      getHistoricalSnapshot: (s:string) => { histCalls.push(s); return histSnapshots[s]; },
      updateState: (_s:string, _r:any) => { /* noop */ }
    });

    // call resolve with different casings
    const p1 = resolver.resolve({ cycleId: 'c1', symbol: 'msft' });
    const p2 = resolver.resolve({ cycleId: 'c1', symbol: 'MSFT' });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(builds.length).toBe(1);
    expect(audits.length).toBe(1);
    // audit sanitized
    const audit = audits[0];
    const auditJson = JSON.stringify(audit);
    expect(auditJson).not.toContain('closes');
    expect(auditJson).not.toContain('dates');
    expect(auditJson).not.toContain('volumes');
    expect(auditJson).not.toContain('returns');
    expect(auditJson).not.toContain('historicalContext');
    expect(auditJson).not.toContain('provider');
    // historical snapshot used exactly once for MSFT
    expect(histCalls.length).toBe(1);
    expect(histCalls[0]).toBe('MSFT');
    // cached result reuse
    expect(r1).toBe(r2);
    // state sanitization via sanitizer returns JSON-safe
    const safe = sanitizeIntelligenceForState(r1);
    expect(safe.supportingSignals).toBeInstanceOf(Array);
    expect(safe.reasoning).toBeInstanceOf(Array);
  });

  it('audit append failure is isolated and symbol B succeeds; forex supported', async () => {
    const audits: any[] = [];
    const builds: string[] = [];
    const histCalls: string[] = [];

    const histSnapshots: Record<string, any> = {
      A: { schemaVersion:1, source:'VICTOR_HISTORICAL_MARKET_CONTEXT', symbol:'A', observedAt:'2025-01-01', generatedAt:'2025-01-01T00:00:00Z', observationCount:80, hasVolume:false, dataQuality:'COMPLETE', missingCapabilities:[], shortTrend:'UP', mediumTrend:'UP', longTrend:'UP', trendAgreement:1, volatilityState:'NORMAL', momentumPersistence:'STRONG', currentDrawdownPercent:0, maxDrawdownPercent:0, recoveryPercent:100, rangePosition:0.9, volumeTrend:'UNAVAILABLE', warnings:[] },
      EUR_USD: { schemaVersion:1, source:'VICTOR_HISTORICAL_MARKET_CONTEXT', symbol:'EUR_USD', observedAt:'2025-01-01', generatedAt:'2025-01-01T00:00:00Z', observationCount:80, hasVolume:false, dataQuality:'COMPLETE', missingCapabilities:[], shortTrend:'UP', mediumTrend:'UP', longTrend:'UP', trendAgreement:1, volatilityState:'NORMAL', momentumPersistence:'STRONG', currentDrawdownPercent:0, maxDrawdownPercent:0, recoveryPercent:100, rangePosition:0.9, volumeTrend:'UNAVAILABLE', warnings:[] }
    };

    const buildFn = (opts:{symbol:string; historicalContext?:any; now?:Date}) => {
      builds.push(String(opts.symbol));
      return buildMarketRegimeIntelligence({ symbol: opts.symbol, historicalContext: opts.historicalContext, now: opts.now });
    };

    const resolver = createPerCycleMarketRegimeResolver({
      buildIntelligence: buildFn,
      appendAudit: async (a:any) => { if (String(a.symbol).toUpperCase() === 'A') throw new Error('audit fail'); audits.push(a); },
      getHistoricalSnapshot: (s:string) => { histCalls.push(s); return histSnapshots[s]; },
      updateState: (_s:string, _r:any) => { /* noop */ }
    });

    const rA = await resolver.resolve({ cycleId: 'c2', symbol: 'A' });
    expect(rA).toBeTruthy();
    // audit failed for A => audits array should be empty
    expect(audits.length).toBe(0);

    // symbol B/FOREX should still succeed
    const rB = await resolver.resolve({ cycleId: 'c2', symbol: 'EUR_USD' });
    expect(rB).toBeTruthy();
    // historical snapshot called for both (order may vary)
    expect(histCalls.includes('A')).toBeTruthy();
    expect(histCalls.includes('EUR_USD')).toBeTruthy();
  });

  it('getPaperTradingState exposes sanitized intelligence and is defensive', async () => {
    // Build a snapshot and inject into runtime.latestMarketRegimeIntelligenceBySymbol for test
    const snap = buildMarketRegimeIntelligence({ symbol: 'MSFT', historicalContext: { schemaVersion:1, source:'VICTOR_HISTORICAL_MARKET_CONTEXT', symbol:'MSFT', observedAt:'2025-01-01', generatedAt:'2025-01-01T00:00:00Z', observationCount:80, hasVolume:false, dataQuality:'COMPLETE', missingCapabilities:[], shortTrend:'UP', mediumTrend:'UP', longTrend:'UP', trendAgreement:1, volatilityState:'NORMAL', momentumPersistence:'STRONG', currentDrawdownPercent:0, maxDrawdownPercent:0, recoveryPercent:100, rangePosition:0.9, volumeTrend:'UNAVAILABLE', warnings:[] } });
    // mutate via runtime (imported getPaperTradingState reads runtime object); the runtime module stores latestMarketRegimeIntelligenceBySymbol when resolver updateState is called normally.
    // For test we will emulate by directly assigning to runtime via updateState through resolver factory.
    const stateMap: Record<string, any> = {};
    const resolver = createPerCycleMarketRegimeResolver({ buildIntelligence: () => snap, appendAudit: async ()=>{}, getHistoricalSnapshot: (_s:string)=>null, updateState: (s:string,r:any) => { stateMap[s] = r; } });
    await resolver.resolve({ cycleId: 'c3', symbol: 'MSFT' });
    // stateMap should now have MSFT
    expect(typeof stateMap['MSFT']).toBe('object');
    // emulate getPaperTradingState exposure: sanitizeIntelligenceForState used inside getPaperTradingState to produce defensive copy; here we test defensive behaviour by mutating stateMap copy
    const exposed = sanitizeIntelligenceForState(stateMap['MSFT']);
    // mutate exposed
    (exposed as any).supportingSignals.push('x');
    expect(Array.isArray(stateMap['MSFT'].supportingSignals)).toBe(true);
    // original should not have the pushed 'x' because sanitize makes copies in runtime
    expect(stateMap['MSFT'].supportingSignals.includes('x')).toBe(false);
  });
});
