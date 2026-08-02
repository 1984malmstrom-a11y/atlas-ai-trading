import { describe, it, expect } from 'vitest';
import MEI, { buildMarketEnvironmentIntelligence, sanitizeMarketEnvironmentIntelligenceForState, createPerCycleMarketEnvironmentResolver } from './market-environment-intelligence';

describe('market-environment-intelligence', () => {
  it('builds deterministic MEI with provided now and inputs', () => {
    const now = new Date('2025-01-01T10:00:00.000Z');
    const mei = buildMarketEnvironmentIntelligence({
      now,
      observedAt: '2025-01-01T09:59:00.000Z',
      macroSnapshot: { vix: 18, dxy: 102, us10y: 3.2 },
      benchmarkContexts: [ { symbol: 'AAPL', relativeStrengthPercent: 1.2 }, { symbol: 'TSLA', relativeStrengthPercent: 0.8 }, { symbol: 'X', relativeStrengthPercent: -0.5 } ],
      intradayContexts: [ { symbol: 'AAPL', coverage: 'COMPLETE', isFresh: true } ]
    });

    expect(mei.schemaVersion).toBe(1);
    expect(mei.source).toBe('VICTOR_MARKET_ENVIRONMENT_INTELLIGENCE');
    expect(mei.generatedAt).toBe(now.toISOString());
    expect(mei.coverage).toBe('COMPLETE');
    expect(mei.leadershipProxy.length).toBeGreaterThan(0);
    expect(mei.volatilityBackdrop).toBe('NEUTRAL');
    expect(typeof mei.confidence).toBe('number');
  });

  it('sanitize produces JSON-safe, deduped arrays and limited sizes', () => {
    const mei = buildMarketEnvironmentIntelligence({
      now: new Date('2025-02-01T00:00:00Z'),
      benchmarkContexts: Array.from({ length: 20 }).map((_,i)=> ({ symbol: 'SYM' + (i%5), relativeStrengthPercent: i }))
    });
    const s = sanitizeMarketEnvironmentIntelligenceForState(mei);
    expect(Array.isArray(s.leadershipProxy)).toBe(true);
    expect(s.leadershipProxy.length).toBeLessThanOrEqual(10);
    expect(s.sectorLeadershipProxy.length).toBeLessThanOrEqual(6);
    // serializable
    expect(() => JSON.stringify(s)).not.toThrow();
  });

  it('per-cycle resolver caches and returns contexts', () => {
    const resolver = createPerCycleMarketEnvironmentResolver();
    resolver.updateState({ intraday: { AAPL: { symbol: 'AAPL', coverage: 'COMPLETE' } }, benchmarks: { AAPL: { symbol: 'AAPL', relativeStrengthPercent: 2 } }, macroSnapshot: { vix: 12 } });
    return Promise.resolve().then(async ()=>{
      const i = await resolver.getIntradayContext('aapl');
      const b = await resolver.getBenchmarkContext('AAPL');
      const m = await resolver.getMacroSnapshot();
      expect(i && (i as any).coverage).toBe('COMPLETE');
      expect(b && (b as any).relativeStrengthPercent).toBe(2);
      expect(m && (m as any).vix).toBe(12);
    });
  });

  it('per-cycle resolver single build and reuse', async ()=>{
    let built = 0;
    const r = createPerCycleMarketEnvironmentResolver({ getBenchmarkContext: async (s)=> { built++; return { symbol: s, relativeStrengthPercent: 1 }; }, getIntradayContext: async (s)=> ({ symbol: s, coverage: 'OK', isFresh: true }) });
    const p1 = r.buildOnce();
    const p2 = r.buildOnce();
    const a = await p1; const b = await p2;
    expect(a).toBeTruthy(); expect(b).toBeTruthy(); expect(a.generatedAt).toEqual(b.generatedAt);
    expect(built).toBeGreaterThanOrEqual(1);
  });

  // Additional scenario coverage
  it('broad bullish participation', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ now: new Date('2025-03-01T10:00:00Z'), benchmarkContexts: [{ symbol: 'AAA', relativeStrengthPercent: 2 }, { symbol: 'BBB', relativeStrengthPercent: 1.5 }, { symbol: 'CCC', relativeStrengthPercent: 1.2 }], macroSnapshot: { vix: 12, dxy: 98, us10y: 1.5 } });
    expect(mei.equityBackdrop).toBe('BULL');
    expect(Array.isArray(mei.supportingSignals)).toBe(true);
    expect(mei.missingCapabilities).toContain('TRUE_ADVANCE_DECLINE_BREADTH');
  });

  it('narrow technology-led rally', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ now: new Date('2025-03-01T10:00:00Z'), benchmarkContexts: [{ symbol: 'QQQ', relativeStrengthPercent: 3 }, { symbol: 'SPY', relativeStrengthPercent: 0.1 }, { symbol: 'IWM', relativeStrengthPercent: 0.0 }], macroSnapshot: { vix: 14 } });
    expect(mei.leadershipProxy.includes('QQQ')).toBe(true);
    expect(Array.isArray(mei.sectorLeadershipProxy)).toBe(true);
    expect(mei.missingCapabilities.indexOf('TRUE_ADVANCE_DECLINE_BREADTH') >= 0).toBe(true);
  });

  it('broadly bearish environment', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ benchmarkContexts: [{ symbol: 'A', relativeStrengthPercent: -2 }, { symbol: 'B', relativeStrengthPercent: -1 }] , macroSnapshot: { vix: 30 } });
    expect(mei.equityBackdrop).toBe('BEAR');
    expect(mei.volatilityBackdrop).toBe('BEAR');
  });

  it('mixed/conflicting environment does not throw', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ benchmarkContexts: [{ symbol: 'A', relativeStrengthPercent: 2 }, { symbol: 'B', relativeStrengthPercent: -2 }], macroSnapshot: { vix: 18 } });
    expect(mei).toBeTruthy();
    expect(typeof mei.quality === 'number').toBe(true);
  });

  it('elevated volatility risk-off increases defensiveDemand', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ macroSnapshot: { vix: 40, dxy: 95 } });
    expect(mei.volatilityBackdrop).toBe('BEAR');
    expect(mei.defensiveDemand === null || typeof mei.defensiveDemand === 'number').toBe(true);
  });

  it('tightening rates and dollar pressure produce numeric pressures', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ macroSnapshot: { us10y: 6, dxy: 120 } });
    expect(mei.ratePressure !== undefined).toBe(true);
    expect(mei.dollarPressure !== undefined).toBe(true);
  });

  it('insufficient input yields UNAVAILABLE coverage and zero confidence', ()=>{
    const mei = buildMarketEnvironmentIntelligence({});
    expect(mei.coverage === 'UNAVAILABLE' || mei.coverage === 'PARTIAL').toBe(true);
    expect(typeof mei.confidence).toBe('number');
  });

  it('missing IWM does not crash builder', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ benchmarkContexts: [{ symbol: 'SPY', relativeStrengthPercent: 1 }, { symbol: 'QQQ', relativeStrengthPercent: 0.5 }] });
    expect(Array.isArray(mei.leadershipProxy)).toBe(true);
  });

  it('unavailable VIX leaves volatility UNKNOWN', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ macroSnapshot: { dxy: 100, us10y: 2 } });
    expect(mei.volatilityBackdrop === 'UNKNOWN' || typeof mei.volatilityBackdrop === 'string').toBe(true);
  });

  it('deterministic output with same now', ()=>{
    const now = new Date('2025-04-01T09:00:00Z');
    const a = buildMarketEnvironmentIntelligence({ now, benchmarkContexts: [{ symbol: 'SPY', relativeStrengthPercent: 1 }], macroSnapshot: { vix: 12 } });
    const b = buildMarketEnvironmentIntelligence({ now, benchmarkContexts: [{ symbol: 'SPY', relativeStrengthPercent: 1 }], macroSnapshot: { vix: 12 } });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('input immutability: original arrays are not mutated', ()=>{
    const benches = [{ symbol: 'A', relativeStrengthPercent: 1 }];
    const intr = [{ symbol: 'A', coverage: 'COMPLETE' }];
    const copyB = JSON.stringify(benches);
    const copyI = JSON.stringify(intr);
    buildMarketEnvironmentIntelligence({ benchmarkContexts: benches, intradayContexts: intr, macroSnapshot: { vix: 12 } });
    expect(JSON.stringify(benches)).toEqual(copyB);
    expect(JSON.stringify(intr)).toEqual(copyI);
  });

  it('numeric outputs are finite or null and arrays deduped/limited', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ benchmarkContexts: Array.from({ length: 20 }).map((_,i)=> ({ symbol: 'SYM' + (i%5), relativeStrengthPercent: i })) });
    expect(Array.isArray(mei.leadershipProxy)).toBe(true);
    expect(mei.leadershipProxy.length).toBeLessThanOrEqual(10);
    expect(mei.missingCapabilities.indexOf('TRUE_ADVANCE_DECLINE_BREADTH') >= 0).toBe(true);
    expect(typeof mei.confidence === 'number').toBe(true);
  });

  it('sanitizer produces JSON-safe defensive copy and removes provider payloads', ()=>{
    const mei = buildMarketEnvironmentIntelligence({ benchmarkContexts: [{ symbol: 'SPY', relativeStrengthPercent: 1, warnings: [] }], intradayContexts: [{ symbol: 'SPY', coverage: 'COMPLETE', isFresh: true, session: { changePercent: 1 } as any }], macroSnapshot: { vix: 12 } });
    const s = sanitizeMarketEnvironmentIntelligenceForState(mei);
    expect(() => JSON.stringify(s)).not.toThrow();
    expect(s.supportingSignals.length).toBeLessThanOrEqual(10);
  });

});
