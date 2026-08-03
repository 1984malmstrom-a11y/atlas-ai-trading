import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('autonomous technical intelligence integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('PAPER_TRADER_SCHEDULER_MODE', 'in_memory');
    vi.stubEnv('NODE_ENV', 'test');
  });
  afterEach(() => {
    try{ vi.unstubAllEnvs(); }catch(_){ }
    vi.restoreAllMocks();
  });

  it('builds per-cycle technical intelligence for watchlist symbols during automatic run', async () => {
    // Ensure market open
    vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: () => ({ open: true }) }));

    // Provide normalized quotes for a watchlist symbol (NVDA is in DEFAULT_WATCHLIST)
    vi.doMock('../market-data/quotes-service', () => ({ getNormalizedQuotes: async () => ({ quotes: [ { symbol: 'NVDA', priceSek: 200, price: 200, marketTimestamp: new Date().toISOString(), dataStatus: 'READY' } ] }) }));

    // Mock tradable instruments to include an eligible FOREX pair
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'EUR_USD', providerSymbol: 'EUR/USD', assetType: 'FOREX', tradingEnabled: true, marketDataEnabled: true, enabled: true, baseAsset: 'EUR', quoteCurrency: 'USD' }, { id: 'NVDA', providerSymbol: 'NVDA', assetType: 'STOCK', tradingEnabled: true, marketDataEnabled: true, enabled: true } ] }));

    // Spy functions for TwelveData provider methods
    const histSpy = vi.fn(async (_s: string, _d: number) => { const now = Date.now(); const closes = Array.from({ length: 64 }, (_,i)=> 100 + i); const dates = closes.map((_,i)=> new Date(now - (closes.length - i)*24*60*60*1000).toISOString()); return { closes, dates, source: 'mock' }; });
    const intradaySpy = vi.fn(async (_s: string, _tf: any, _lim?: number) => { const ts = new Date().toISOString(); return { symbol: _s, interval: _tf, fetchedAt: ts, candles: [ { timestamp: ts, open: 1, high: 2, low: 0.9, close: 1, volume: 100 } ] }; });
    vi.doMock('../market-data/twelve-data', () => ({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(s: string, d: number){ return histSpy(s,d); } async getIntradayCandles(s: string, tf: any, lim?: number){ return intradaySpy(s, tf, lim); } } }));

    // Also ensure getMarketDataProvider exists and returns intraday support (use same intraday spy)
    const mockMarketProvider = () => ({ getIntradayCandles: async (s: string, tf: any, lim?: number) => intradaySpy(s, tf, lim) });
    vi.doMock('../market-data', () => ({ getMarketDataProvider: mockMarketProvider, default: {} }));

    // Mock signal-confluence to expose a spyable finalizeSnapshot and minimal helpers
    vi.doMock('./signal-confluence', () => {
      const finalizeCalls: any[] = [];
      try{ (globalThis as any).__DI_FINALIZE_CALLS = finalizeCalls; }catch(_){ }
      return {
        createPerCycleDecisionIntelligenceResolver: (opts: any) => {
          return {
            resolveAnalysis: async ({ symbol }: any) => {
              return { cycleId: opts.cycleId, symbol: String(symbol).toUpperCase(), direction: 'NEUTRAL', bullishScore: 0, bearishScore: 0, hasConflict: false, hasIndependentBullishSupport: false, hasIndependentBearishSupport: false, analysisQuality: { level: 'INSUFFICIENT', score: 0, usableSignalCount: 0, distinctTypes: 0, distinctOrigins: 0, missingCapabilities: [] }, selectedSupportingSignals: [], warnings: [], reasoning: [] };
            },
            finalizeSnapshot: async ({ symbol, selectedSupportingSignalIds }: any) => {
              const s = String(symbol).toUpperCase();
              const snap = { cycleId: opts.cycleId, symbol: s, generatedAt: new Date().toISOString(), direction: 'NEUTRAL', bullishScore: 0, bearishScore: 0, hasConflict: false, hasIndependentBullishSupport: false, hasIndependentBearishSupport: false, analysisQuality: { level: 'INSUFFICIENT', score: 0, usableSignalCount: 0, distinctTypes: 0, distinctOrigins: 0, missingCapabilities: [] }, selectedSupportingSignals: Array.isArray(selectedSupportingSignalIds) ? selectedSupportingSignalIds.map((id:any)=> ({ id })) : [], warnings: [], reasoning: [] };
              finalizeCalls.push({ symbol: s, selectedSupportingSignalIds: Array.isArray(selectedSupportingSignalIds) ? selectedSupportingSignalIds.slice() : [] });
              // Call provided appendAudit if available to emulate real resolver behavior
              try{ if (opts && typeof opts.appendAudit === 'function') await opts.appendAudit(snap); }catch(_){ }
              return snap;
            },
            getStats: () => ({ analyzedSymbols: 0, finalizedSymbols: 0, auditedSymbols: 0 }),
            hasSymbol: (s:string) => false,
            __finalizeCalls: finalizeCalls
          };
        },
        buildAnalysisQualitySummary: (s:any) => ({ level: 'INSUFFICIENT', score: 0, usableSignalCount: 0, distinctTypes: 0, distinctOrigins: 0, missingCapabilities: [] }),
        buildConfluenceReasoning: (s:any) => [],
        DECISION_INTELLIGENCE_SCHEMA_VERSION: 1,
        DECISION_INTELLIGENCE_SOURCE: 'TEST_DECISION_INTELLIGENCE'
      };
    });

    // Import runtime and run automatic implementation directly
    const mod = await import('./demo-runtime');
    // Clear past audits/state
    await mod.__clearAudits && await mod.__clearAudits();

    // Run a single manual cycle (direct call)
    const res = await mod.runManualPaperTradingCycle({ allowWhenScheduler: true });
    // Fetch public state
    const state = await mod.getPaperTradingState();

    // Expect the run to return an object result (may be skipped or completed)
    expect(res && typeof res === 'object').toBeTruthy();

    // Check technical maps
    const tmap = state.latestMultiTimeframeTechnicalIntelligenceBySymbol || {};
    const fxmap = state.latestForexSessionIntelligenceBySymbol || {};
    const mrmap = state.latestMarketRegimeIntelligenceBySymbol || {};
    const dimap = state.latestDecisionIntelligenceBySymbol || {};
    const shadow = state.contextAwareShadowDecisionBySymbol || {};

    // Validate runtime maps and that FOREX MTTI and Forex Session intelligence were built
    expect(typeof state).toBe('object');
    expect(tmap).toBeDefined();
    expect(fxmap).toBeDefined();
    expect(mrmap).toBeDefined();
    expect(dimap).toBeDefined();
    expect(shadow).toBeDefined();

    // Ensure the automatic universe included the forex pair and that builds were executed
    const hasForexMTTI = Object.keys(tmap).map(k=>k.toUpperCase()).includes('EUR/USD'.toUpperCase());
    const hasForexSession = Object.keys(fxmap).map(k=>k.toUpperCase()).includes('EUR/USD'.toUpperCase());
    expect(hasForexMTTI || hasForexSession).toBeTruthy();

    // Validate provider call counts: daily + 5min/15min should be requested at least once
    expect(histSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(intradaySpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const intradaySymbols = intradaySpy.mock.calls.map(c=> String(c[0]).toUpperCase());
    expect(intradaySymbols).toContain('EUR/USD'.toUpperCase());

    // Inspect exactly what symbol argument was used for historical daily calls
    const histCalledSymbols = histSpy.mock.calls.map(c=> String(c[0]).toUpperCase());
    // Should include provider symbol form (EUR/USD) when mapping is applied
    const hasProviderSlash = histCalledSymbols.includes('EUR/USD'.toUpperCase());
    const hasRegistryUnderscore = histCalledSymbols.includes('EUR_USD'.toUpperCase());
    // Record one of the forms for diagnostics
    expect(hasProviderSlash || hasRegistryUnderscore).toBeTruthy();

    // --- Decision Intelligence finalize assertions (mocked signal-confluence) ---
    // Read finalize calls recorded by mock (prefer exported, fallback to global)
    let finalizeCalls: any[] = [];
    try{
      const qc = await import('./signal-confluence');
      finalizeCalls = Array.isArray((qc as any).__finalizeCalls) ? (qc as any).__finalizeCalls : finalizeCalls;
    }catch(_){ }
    try{ if (!Array.isArray(finalizeCalls) && Array.isArray((globalThis as any).__DI_FINALIZE_CALLS)) finalizeCalls = (globalThis as any).__DI_FINALIZE_CALLS as any[]; }catch(_){ }
    const eurCalls = finalizeCalls.filter((c:any)=> String(c.symbol).toUpperCase() === 'EUR/USD'.toUpperCase());
    if (finalizeCalls.length >= 1){
      expect(eurCalls.length).toBeGreaterThanOrEqual(1);
      // verify arguments structure
      expect(eurCalls[0].selectedSupportingSignalIds).toBeDefined();
    }

    // Verify that appendAudit resulted in persisted audit and runtime update
    const audits = await mod.__listAudits && await mod.__listAudits();
    const diAudits = Array.isArray(audits) ? audits.filter((a:any)=> ((a && a.raw && a.raw.kind==='DECISION_INTELLIGENCE_SNAPSHOT') || (a && a.kind==='DECISION_INTELLIGENCE_SNAPSHOT'))) : [];
    // Expect at least one DI audit appended (proof appendAudit was invoked)
    expect(diAudits.length).toBeGreaterThanOrEqual(1);
    // Runtime state should include sanitized DI under EUR/USD
    const diMap = state.latestDecisionIntelligenceBySymbol || {};
    const hasEUR = Object.keys(diMap).map(k=> String(k).toUpperCase()).includes('EUR/USD'.toUpperCase());
    expect(hasEUR).toBeTruthy();

    // Check whether historical market context map was populated for EUR/USD (or EUR_USD)
    const hmap = state.latestHistoricalMarketContextBySymbol || {};
    const hkeys = Object.keys(hmap).map(k=> String(k).toUpperCase());
    const keyUsed = hkeys.find(k => k === 'EUR/USD'.toUpperCase() || k === 'EUR_USD'.toUpperCase());
    if (keyUsed){
      const snap = hmap[keyUsed];
      // expect closes/dates arrays when provider returned data
      expect(snap).toBeDefined();
      if (snap && snap.closes) expect(Array.isArray(snap.closes)).toBeTruthy();
    }
  }, 20000);
});
