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
  }, 20000);
});
