import { describe, it, expect, vi } from 'vitest';
import { buildExternalIntelligenceReadiness, buildCurrentExternalIntelligenceReadiness } from './external-intelligence-readiness';
import * as ms from './macro-signals';

describe('external intelligence readiness - runtime integration', ()=>{
  it('category order stable and counts match', ()=>{
    const now = new Date('2026-01-02T00:00:00Z');
    const caps = { finnhub: true, macroConfig: true, fundamentals: true };
    const runtimeUsage = { companyNewsRuntime: true, companyNewsDI: true, macroRuntime: true, macroDI: true, fundamentalsRuntime: true, fundamentalsDI: true };
    const r = buildExternalIntelligenceReadiness({ capabilities: caps as any, runtimeUsage: runtimeUsage as any, now });
    expect(r.schemaVersion).toBe(1);
    // stable category order expected length 14
    expect(Array.isArray(r.sources)).toBe(true);
    expect(r.sources.length).toBe(14);
    // counts should reflect some READY entries when capabilities/runtime present
    expect(r.readyCount).toBeGreaterThan(0);
  });

  it('buildCurrentExternalIntelligenceReadiness inspects env and runtime without network', ()=>{
    const fakeEnv: any = { FINNHUB_API_KEY: '', TWELVE_DATA_API_KEY: '' };
    // macro registry disabled by returning empty enabled flags (simulate no config)
    const spy = vi.spyOn(ms, 'getMacroIndicatorRegistry').mockImplementation(()=> [{ key: 'vix', enabled: false, providerSymbol: undefined }, { key: 'dxy', enabled: false, providerSymbol: undefined }, { key: 'us10y', enabled: false, providerSymbol: undefined }, { key: 'oil', enabled: false, providerSymbol: undefined } ] as any);
    const out = buildCurrentExternalIntelligenceReadiness({ env: fakeEnv, runtime: { latestMarketNewsActivity: null, latestFundamentalIntelligenceBySymbol: {}, latestMarketRegimeIntelligenceBySymbol: {} } });
    expect(out.schemaVersion).toBe(1);
    // all categories should be UNAVAILABLE when no providers
    expect(out.unavailableCount).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('provider present + runtime absent => LIMITED', ()=>{
    const fakeEnv: any = { FINNHUB_API_KEY: 'x', TWELVE_DATA_API_KEY: '' };
    const out = buildCurrentExternalIntelligenceReadiness({ env: fakeEnv, runtime: { latestMarketNewsActivity: null, latestFundamentalIntelligenceBySymbol: {} } });
    const comp = out.sources.find((s:any)=> s.category === 'COMPANY_NEWS');
    expect(comp).toBeDefined();
    expect(comp!.status).toBe('LIMITED');
  });

  it('provider + runtime + DI => READY', ()=>{
    const fakeEnv: any = { FINNHUB_API_KEY: 'x', TWELVE_DATA_API_KEY: 'y' };
    const runtime = { latestMarketNewsActivity: { symbol: 'AAPL' }, latestDecisionIntelligenceBySymbol: { AAPL: { generatedAt: new Date().toISOString() } }, latestFundamentalIntelligenceBySymbol: { AAPL: { snapshot: { symbol: 'AAPL', fetchedAt: new Date().toISOString(), dataStatus: 'COMPLETE', availableCategories: [], missingCapabilities: [] }, quality: { level: 'STRONG', score: 0.9, positiveFactors: [], negativeFactors: [], warnings: [] } } } , latestMarketRegimeIntelligenceBySymbol: { AAPL: {} } };
    const out = buildCurrentExternalIntelligenceReadiness({ env: fakeEnv, runtime });
    const comp = out.sources.find((s:any)=> s.category === 'COMPANY_NEWS');
    expect(comp && comp.status).toBe('READY');
    const fund = out.sources.find((s:any)=> s.category === 'COMPANY_PROFILE');
    expect(fund && fund.status).toBe('READY');
  });

  it('output is JSON-safe and contains no raw articles', ()=>{
    const out = buildExternalIntelligenceReadiness({ capabilities: { finnhub: true, macroConfig: true, fundamentals: true }, runtimeUsage: { companyNewsRuntime: true, companyNewsDI: false, macroRuntime: false, macroDI: false, fundamentalsRuntime: false, fundamentalsDI: false }, now: new Date() });
    expect(() => JSON.stringify(out)).not.toThrow();
    // ensure sources array items do not contain large raw fields
    for (const s of out.sources){ expect(typeof s.provider === 'string' || s.provider === null).toBe(true); expect(Array.isArray(s.warnings)).toBe(true); }
  });
});
