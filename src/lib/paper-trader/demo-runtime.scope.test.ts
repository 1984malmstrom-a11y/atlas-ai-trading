import { describe, it, expect, vi, beforeEach } from 'vitest';

// Focused runtime test: verify automatic cycle builds scoped union and fails-closed
beforeEach(() => { vi.resetModules(); });

describe('demo-runtime automatic scoped-quote behavior', () => {
  it('builds cycle union and does not fallback to full fetch when scoped call throws', async () => {
    // Mock instruments to include analysis candidates, SPY, QQQ and forex entries
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [
      { id: 'AAA', providerSymbol: 'AAA', enabled: true, marketDataEnabled: true, assetType: 'STOCK', currency: 'USD' },
      { id: 'BBB', providerSymbol: 'BBB', enabled: true, marketDataEnabled: true, assetType: 'STOCK', currency: 'USD' },
      { id: 'SPY', providerSymbol: 'SPY', enabled: true, marketDataEnabled: true, assetType: 'ETF', currency: 'USD' },
      { id: 'QQQ', providerSymbol: 'QQQ', enabled: true, marketDataEnabled: true, assetType: 'ETF', currency: 'USD' },
      { id: 'EUR_USD', providerSymbol: 'EUR/USD', enabled: true, marketDataEnabled: true, assetType: 'FOREX' },
      { id: 'GBP_USD', providerSymbol: 'GBP/USD', enabled: true, marketDataEnabled: true, assetType: 'FOREX' },
      { id: 'USD_JPY', providerSymbol: 'USD/JPY', enabled: true, marketDataEnabled: true, assetType: 'FOREX' },
      { id: 'USD_SEK', providerSymbol: 'USD/SEK', enabled: true, marketDataEnabled: true, assetType: 'FOREX' },
      // an instrument not part of rotation to be present only via holdings
      { id: 'OUTSIDE1', providerSymbol: 'OUT1', enabled: true, marketDataEnabled: true, assetType: 'STOCK', currency: 'USD' }
    ] }));

    // Force forex session open so buildAutomaticAnalysisSymbols can include forex
    vi.doMock('../forex-market', () => ({ getForexSessionDiagnostics: () => ({ status: 'OPEN' }) }));

    // Mock quotes-service: throw when scoped (options.instrumentIds present)
    const mockedGetNormalized = vi.fn(async (_prov?: any, options?: any) => {
      if (options && Array.isArray(options.instrumentIds)) throw new Error('scoped fail');
      return { quotes: [] };
    });
    vi.doMock('../market-data/quotes-service', () => ({ getNormalizedQuotes: mockedGetNormalized }));

    // Mock provider to detect any full-registry getQuotes calls
    const mockedProviderGetQuotes = vi.fn(async (_ids: string[]) => { return []; });
    vi.doMock('../../lib/market-data', () => ({ default: { getQuotes: mockedProviderGetQuotes, getQuote: vi.fn(async (id:string)=> ({ instrumentId: id })) } }));


    // Import runtime AFTER mocks
    const mod = await import('./demo-runtime');

    // Inject a test portfolio adapter so the module-scoped cycle union builder uses our holdings
    mod.__setTestPortfolio({ getPortfolio: async () => ({ holdings: [ { instrumentId: 'OUTSIDE1' } ] }) });

    // Run a single cycle in scheduler-mode (allowWhenScheduler=true)
    const res = await mod.runManualPaperTradingCycle({ allowWhenScheduler: true });

    // Assert getNormalizedQuotes was called and one of the calls included scoped options
    expect(mockedGetNormalized).toHaveBeenCalled();
    const scopedCall = (mockedGetNormalized as any).mock.calls.find((c:any[]) => c && c[1] && Array.isArray(c[1].instrumentIds));
    expect(scopedCall).toBeTruthy();
    const options = scopedCall[1];
    const ids = options.instrumentIds.map((s:string)=> String(s));

    // Must contain SPY and QQQ, forex dependencies and the holding OUTSIDE1
    expect(ids).toEqual(expect.arrayContaining(['SPY','QQQ','EUR_USD','GBP_USD','USD_JPY','USD_SEK','OUTSIDE1']));

    // No duplicates
    expect(ids.length).toBe(new Set(ids).size);

    // Ensure fallback params set
    expect(options.fallbackStrategy).toBe('limited');
    expect(options.maxFallbacks).toBe(2);

    // Analysis symbols (stocks/etfs excluding holdings and forex) must be at most 10
    const instrumentsMod = await import('../market-data/instruments');
    const tradableMap: Record<string, any> = {};
    for (const t of instrumentsMod.TRADABLE_INSTRUMENTS || []) tradableMap[String(t.id)] = t;
    const analysisIds = ids.filter((id:string) => {
      const t = tradableMap[String(id)];
      if (!t) return false;
      if (t.assetType === 'FOREX') return false;
      if (id === 'OUTSIDE1') return false; // holding outside rotation
      return (t.assetType === 'STOCK' || t.assetType === 'ETF');
    });
    expect(analysisIds.length).toBeLessThanOrEqual(10);

    // Because mockedGetNormalized throws for scoped calls, runtime must NOT call provider.getQuotes (full fetch)
    expect(mockedProviderGetQuotes).not.toHaveBeenCalled();

    // And cycle should complete (not throw). A lightweight runtime error may be recorded internally.
  });
});
