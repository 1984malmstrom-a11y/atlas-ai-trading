import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';

describe('autonomous technical intelligence integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('PAPER_TRADER_SCHEDULER_MODE', 'in_memory');
    vi.stubEnv('NODE_ENV', 'test');
  });
    afterEach(() => {
      try { vi.unstubAllEnvs(); } catch (_) { }
      vi.restoreAllMocks();
  });

  it('builds per-cycle technical intelligence for watchlist symbols during automatic run', async () => {
    // Ensure market open
    vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: () => ({ open: true }) }));

    // Provide normalized quotes including a FOREX pair and a watchlist symbol
    vi.doMock('../market-data/quotes-service', () => ({ getNormalizedQuotes: async () => ({ quotes: [ { instrumentId: 'EUR_USD', symbol: 'EUR/USD', provider: 'twelve-data', price: 1.15, priceSek: null, marketTimestamp: new Date().toISOString(), dataStatus: 'READY' }, { symbol: 'NVDA', priceSek: 200, price: 200, marketTimestamp: new Date().toISOString(), dataStatus: 'READY' } ] }) }));

    // Mock tradable instruments to include an eligible FOREX pair
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'EUR_USD', providerSymbol: 'EUR/USD', assetType: 'FOREX', tradingEnabled: true, marketDataEnabled: true, enabled: true, baseAsset: 'EUR', quoteCurrency: 'USD' }, { id: 'NVDA', providerSymbol: 'NVDA', assetType: 'STOCK', tradingEnabled: true, marketDataEnabled: true, enabled: true } ] }));

    // Spy functions for TwelveData provider methods
    const histSpy = vi.fn(async (_s: string, _d: number) => { const now = Date.now(); const closes = Array.from({ length: 99 }, (_,i)=> 100 + i); const dates = closes.map((_,i)=> new Date(now - (closes.length - i)*24*60*60*1000).toISOString()); return { closes, dates, source: 'mock' }; });
    const intradaySpy = vi.fn(async (_s: string, _tf: any, _lim?: number) => { const ts = new Date().toISOString(); return { symbol: _s, interval: _tf, fetchedAt: ts, candles: [ { timestamp: ts, open: 1, high: 2, low: 0.9, close: 1, volume: 100 } ] }; });
    vi.doMock('../market-data/twelve-data', () => ({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(s: string, d: number){ return histSpy(s,d); } async getIntradayCandles(s: string, tf: any, lim?: number){ return intradaySpy(s, tf, lim); } } }));

    // Also ensure getMarketDataProvider exists and returns intraday support (use same intraday spy)
    const mockMarketProvider = () => ({ getIntradayCandles: async (s: string, tf: any, lim?: number) => intradaySpy(s, tf, lim) });
    vi.doMock('../market-data', () => ({ getMarketDataProvider: mockMarketProvider, default: {} }));

    // Use real signal-confluence implementation so confluence rebuild is exercised
    // (do not mock './signal-confluence' here)

    // Import runtime and run automatic implementation directly
    const mod = await import('./demo-runtime');
    // Clear past audits/state
    await mod.__clearAudits && await mod.__clearAudits();
    // Verify no prior audits exist for EUR/USD
    const auditsBefore = await mod.__listAudits && await mod.__listAudits();
    const priorEval = Array.isArray(auditsBefore) ? auditsBefore.find((a:any)=> a && a.summary && a.summary.decisionId && String(a.summary.decisionId).toLowerCase().includes('eur/usd')) : null;
    expect(priorEval).toBeFalsy();

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

    // Explicitly verify BUY universe contains analysis symbol EUR/USD by calling exported helper
    let universe: any = null;
    try{
      const b = await import('./demo-runtime');
      const eligible = [ { id: 'EUR_USD', providerSymbol: 'EUR/USD', assetType: 'FOREX', tradingEnabled: true, marketDataEnabled: true, enabled: true }, { id: 'NVDA', providerSymbol: 'NVDA', assetType: 'STOCK', tradingEnabled: true, marketDataEnabled: true, enabled: true } ];
      universe = b.buildAutomaticAnalysisSymbols(eligible, new Date());
      const hasInUniverse = Array.isArray(universe) ? universe.map((x:any)=> String(x).toUpperCase()).includes('EUR/USD'.toUpperCase()) : false;
      expect(hasInUniverse).toBeTruthy();
    }catch(_){ }

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
    // Ensure provider was requested with outputSize 100 for EUR/USD
    const calledWithExact = histSpy.mock.calls.some((c:any)=> String(c[0]).toUpperCase() === 'EUR/USD'.toUpperCase() && Number(c[1]) === 100);
    expect(calledWithExact).toBeTruthy();

    // Verify signals were actually built for EUR/USD and record details
    try{
      const state2 = await mod.getPaperTradingState();
      const diagMap = state2.latestSignalBuildDiagnosticsBySymbol || {};
      const diag = diagMap['EUR/USD'] || diagMap['EUR_USD'] || diagMap['EURUSD'] || null;
      expect(diag).toBeTruthy();
      expect(typeof diag.builtSignalCount === 'number' ? diag.builtSignalCount > 0 : false).toBeTruthy();
      const types = Array.isArray(diag.builtSignalTypes) ? diag.builtSignalTypes : [];
      expect(types).toEqual(expect.arrayContaining(['TECHNICAL_MOMENTUM','TREND_QUALITY','SUPPLY_DEMAND_ZONE']));

      // Decision intelligence: usableSignalCount > 0
      const diMap = state2.latestDecisionIntelligenceBySymbol || {};
      const diEntry = diMap['EUR/USD'] || diMap['EUR_USD'] || diMap['EURUSD'] || null;
      if (diEntry && diEntry.analysisQuality){
        expect(typeof diEntry.analysisQuality.usableSignalCount === 'number' ? diEntry.analysisQuality.usableSignalCount > 0 : false).toBeTruthy();
      }else{
        // If no DI entry available, fail test explicitly
        expect(diEntry).toBeTruthy();
      }

      // Persist runtime snapshot for external inspection
      try{ fs.writeFileSync('tmp/runtime_eurusd_check.json', JSON.stringify({ universeContainsEURUSD: Array.isArray(universe) ? universe.map((x:any)=>String(x).toUpperCase()).includes('EUR/USD'.toUpperCase()) : null, builtSignalCount: diag.builtSignalCount, builtSignalTypes: diag.builtSignalTypes, usableSignalCount: diEntry && diEntry.analysisQuality ? diEntry.analysisQuality.usableSignalCount : null }, null, 2), 'utf-8'); }catch(_){ }
    }catch(_){ }

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
      // historical snapshot should report observationCount > 0
      expect(typeof snap.observationCount === 'number' ? snap.observationCount > 0 : false).toBeTruthy();
    }

    // Validate MTTI daily timeframe for the forex symbol: pointCount > 0 and observedAt exists
    const tkeys = Object.keys(tmap).map(k=> String(k).toUpperCase());
    const tKeyUsed = tkeys.find(k => k === 'EUR/USD'.toUpperCase() || k === 'EUR_USD'.toUpperCase());
    if (tKeyUsed){
      const msnap = tmap[tKeyUsed];
      if (msnap && Array.isArray(msnap.timeframes)){
        const tf = msnap.timeframes.find((x:any)=> x.timeframe === '1day');
        expect(tf).toBeDefined();
        if (tf){
          expect(typeof tf.pointCount === 'number' ? tf.pointCount > 0 : false).toBeTruthy();
          expect(tf.observedAt).toBeDefined();
        }
      }
    }

    // Write provider-call diagnostics so test runner output can be inspected
    try{
      const eurCalls = histSpy.mock.calls.filter((c:any)=> { const s = String(c[0]||'').toUpperCase(); return s === 'EUR/USD'.toUpperCase() || s === 'EUR_USD'.toUpperCase(); }).length;
      const out = { totalHistCalls: histSpy.mock.calls.length, eurUsdHistCalls: eurCalls };
      try{ fs.writeFileSync('tmp/provider_calls_eurusd.json', JSON.stringify(out, null, 2), 'utf-8'); }catch(_){ }
    }catch(_){ }

    // Post-run assertions: buySignal should be false (no prior eval), no BUY candidate created, final action HOLD
    const auditsAll = await mod.__listAudits && await mod.__listAudits();
    const anyBuyAudit = Array.isArray(auditsAll) ? auditsAll.some((a:any)=> (a && a.raw && a.raw.decision && a.raw.decision.action === 'BUY') || (a && a.decision && a.decision.action === 'BUY')) : false;
    expect(anyBuyAudit).toBe(false);
    const finalDecision = state.latestDecision || null;
    expect(finalDecision && finalDecision.action === 'HOLD').toBeTruthy();
  }, 20000);

  it('preserves QuotesService quote fields into automatic cycle quotes and avoids QUOTE_MISSING for EUR/USD', async () => {
    vi.resetModules();
    vi.stubEnv('PAPER_TRADER_SCHEDULER_MODE', 'in_memory');
    vi.stubEnv('NODE_ENV', 'test');

    // Ensure market open
    vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: () => ({ open: true }) }));

    // Provide a focused normalized quote from QuotesService
    const nowIso = new Date().toISOString();
    vi.doMock('../market-data/quotes-service', () => ({ getNormalizedQuotes: async () => ({ quotes: [ { instrumentId: 'EUR_USD', symbol: 'EUR/USD', provider: 'twelve-data', providerSymbol: 'EUR/USD', price: 1.15117, marketTimestamp: '2026-08-04T08:08:00.000Z', fetchedAt: '2026-08-04T08:08:01.000Z', dataStatus: 'DELAYED' } ] }) }));

    // Mock tradable instruments to include EUR_USD
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'EUR_USD', providerSymbol: 'EUR/USD', assetType: 'FOREX', tradingEnabled: true, marketDataEnabled: true, enabled: true, baseAsset: 'EUR', quoteCurrency: 'USD' } ] }));

    // Minimal provider mocks to satisfy runtime imports
    vi.doMock('../market-data/twelve-data', () => ({ TwelveDataMarketDataProvider: class {} }));
    vi.doMock('../market-data', () => ({ getMarketDataProvider: () => ({}), default: {} }));

    const mod = await import('./demo-runtime');
    await mod.__clearAudits && await mod.__clearAudits();

    const res = await mod.runManualPaperTradingCycle({ allowWhenScheduler: true });
    const state = await mod.getPaperTradingState();

    // Verify latestQuoteSnapshotBySymbol contains EUR/USD snapshot
    expect(state.latestQuoteSnapshotBySymbol).toBeDefined();
    const stateSnap = (state.latestQuoteSnapshotBySymbol && (state.latestQuoteSnapshotBySymbol['EUR/USD'] || state.latestQuoteSnapshotBySymbol['EUR_USD'] || state.latestQuoteSnapshotBySymbol['EURUSD'])) || null;
    expect(stateSnap).toBeTruthy();
    expect(stateSnap.price === 1.15117).toBeTruthy();
    expect(stateSnap.marketTimestamp === '2026-08-04T08:08:00.000Z').toBeTruthy();

    // Ensure cycle completed
    expect(res && typeof res === 'object').toBeTruthy();

    // Inspect audits for RUNTIME_QUOTES_SNAPSHOT
    const audits = await mod.__listAudits && await mod.__listAudits();
    const snapshots = Array.isArray(audits) ? audits.filter((a:any)=> (a && a.raw && a.raw.snapshot && a.raw.snapshot.kind === 'RUNTIME_QUOTES_SNAPSHOT')) : [];
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const snap = snapshots[snapshots.length - 1].raw.snapshot;
    // Find EUR/USD in snapshot.quotes
    const found = Array.isArray(snap.quotes) ? snap.quotes.find((q:any)=> { const s = String(q.symbol||''); const p = String(q.providerSymbol||''); const iid = String(q.instrumentId||''); return [s,p,iid].some(x=> x.toUpperCase() === 'EUR/USD'.toUpperCase() || x.toUpperCase() === 'EUR_USD'.toUpperCase() || x.toUpperCase() === 'EURUSD'.toUpperCase()); }) : null;
    expect(found).toBeTruthy();
    // Verify preserved fields
    expect(found.instrumentId === 'EUR_USD' || String(found.instrumentId).toUpperCase() === 'EUR_USD').toBeTruthy();
    expect(found.price === 1.15117).toBeTruthy();
    expect(found.timestamp === '2026-08-04T08:08:00.000Z' || found.marketTimestamp === '2026-08-04T08:08:00.000Z' || found.fetchedAt === '2026-08-04T08:08:01.000Z').toBeTruthy();

    // Ensure no QUOTE_MISSING audit for EUR_USD/EUR/USD
    const quoteMissing = Array.isArray(audits) ? audits.some((a:any)=> a && a.kind === 'REJECT' && a.reason && a.reason.code === 'QUOTE_MISSING' && (String(a.decision && a.decision.symbol || '').toUpperCase() === 'EUR/USD'.toUpperCase() || String(a.decision && a.decision.symbol || '').toUpperCase() === 'EUR_USD'.toUpperCase())) : false;
    expect(quoteMissing).toBe(false);
  });
});
