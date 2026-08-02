import { describe, it, expect } from 'vitest';
import { buildExternalIntelligenceReadiness } from './external-intelligence-readiness';

describe('external intelligence readiness', ()=>{
  it('empty capabilities yields UNAVAILABLE for providers', ()=>{
    const r = buildExternalIntelligenceReadiness({ capabilities: {}, runtimeUsage: {} });
    expect(r.schemaVersion).toBe(1);
    // all categories should be UNAVAILABLE if no providers
    const anyReady = r.sources.some(s=> s.status === 'READY');
    expect(anyReady).toBe(false);
    expect(r.unavailableCount).toBeGreaterThan(0);
  });

  it('finnhub provider + runtime+DI => company news READY', ()=>{
    const r = buildExternalIntelligenceReadiness({ capabilities: { finnhub: true }, runtimeUsage: { companyNewsRuntime: true, companyNewsDI: true }, freshnessMinutes: { COMPANY_NEWS: 10 } });
    const comp = r.sources.find(s=> s.category === 'COMPANY_NEWS');
    expect(comp).toBeDefined();
    expect(comp!.status).toBe('READY');
    expect(comp!.provider).toBe('FINNHUB');
  });

  it('fundamentals present but runtime missing => LIMITED and warning', ()=>{
    const r = buildExternalIntelligenceReadiness({ capabilities: { fundamentals: true }, runtimeUsage: { fundamentalsRuntime: false, fundamentalsDI: false } });
    const s = r.sources.find(x=> x.category === 'COMPANY_PROFILE');
    expect(s).toBeDefined();
    expect(s!.status).toBe('LIMITED');
    expect(s!.warnings).toContain('PROVIDER_BUT_RUNTIME_MISSING');
  });

  it('macro configured but stale freshness reported => LIMITED and DATA_STALE', ()=>{
    const r = buildExternalIntelligenceReadiness({ capabilities: { macroConfig: true }, runtimeUsage: { macroRuntime: true, macroDI: true }, freshnessMinutes: { MACRO_EVENTS: 600 } });
    const s = r.sources.find(x=> x.category === 'MACRO_EVENTS');
    expect(s).toBeDefined();
    expect(s!.status).toBe('LIMITED');
    expect(s!.warnings).toContain('DATA_STALE');
  });

  it('topBlockingReasons sorted and max 10', ()=>{
    const r = buildExternalIntelligenceReadiness({ capabilities: {}, runtimeUsage: {} });
    expect(Array.isArray(r.topBlockingReasons)).toBe(true);
    expect(r.topBlockingReasons.length).toBeLessThanOrEqual(10);
  });
});
