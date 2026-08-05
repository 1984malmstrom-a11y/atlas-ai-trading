import { describe, it, expect, vi, beforeEach } from 'vitest';

// Helper to load modules fresh per test
async function loadRuntimeWithMock(mockImpl: any){
  vi.resetModules();
  vi.doMock('../market-data/quotes-service', () => (mockImpl));
  const mod = await import('./demo-runtime');
  return mod;
}

describe('Automatic quote request diagnostics', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('records requested and returned diagnostics on successful provider response', async () => {
    const mock = { getNormalizedQuotes: vi.fn(async (_ctx:any, opts:any) => {
      const ids = Array.isArray(opts && opts.instrumentIds) ? opts.instrumentIds : [];
      // return quotes for first two requested ids
      const quotes = (ids || []).slice(0,2).map((id:string) => ({ instrumentId: id, providerSymbol: String(id).toUpperCase(), symbol: String(id).toUpperCase(), price: 1, previousClose: 1, change: 0, changePercent: 0, dataStatus: 'LIVE', marketTimestamp: new Date().toISOString(), fetchedAt: new Date().toISOString() }));
      return { quotes };
    }) };

    const runtime = await loadRuntimeWithMock(mock);
    // run a single manual cycle in scheduler mode
    await runtime.runManualPaperTradingCycle({ allowWhenScheduler: true });
    const snap = runtime.getPaperTradingRuntimeSnapshot();
    const diag = snap.latestAutomaticQuoteRequestDiagnostics;
    expect(diag).not.toBeNull();
    if (!diag) throw new Error('diag missing');
    expect(typeof diag.requestedAt).toBe('string');
    expect(Array.isArray(diag.requestedInstrumentIds)).toBe(true);
    expect(Array.isArray(diag.returnedInstrumentIds)).toBe(true);
    expect(typeof diag.requestedCount === 'number').toBe(true);
    // returnedCount should be <= requestedCount
    expect(typeof diag.returnedCount === 'number').toBe(true);
    expect(diag.returnedCount).toBeLessThanOrEqual(diag.requestedCount);
    // missingInstrumentIds length equals requestedCount - returnedCount
    expect(Array.isArray(diag.missingInstrumentIds)).toBe(true);
    expect(diag.missingInstrumentIds.length).toBe(diag.requestedCount - diag.returnedCount);
    // snapshot should return a copy (mutating diag should not affect runtime internals)
    const before = JSON.stringify(diag);
    (diag.requestedInstrumentIds as any).push('bogus');
    const snap2 = runtime.getPaperTradingRuntimeSnapshot();
    expect(JSON.stringify(snap2.latestAutomaticQuoteRequestDiagnostics)).toBe(before);
  });

  it('preserves requested list and sets returned empty on provider throw', async () => {
    const mock = { getNormalizedQuotes: vi.fn(async () => { throw new Error('TEST_FAIL'); }) };
    const runtime = await loadRuntimeWithMock(mock);
    await runtime.runManualPaperTradingCycle({ allowWhenScheduler: true });
    const snap = runtime.getPaperTradingRuntimeSnapshot();
    const diag = snap.latestAutomaticQuoteRequestDiagnostics;
    expect(diag).not.toBeNull();
    if (!diag) throw new Error('diag missing');
    expect(Array.isArray(diag.requestedInstrumentIds)).toBe(true);
    expect(Array.isArray(diag.returnedInstrumentIds)).toBe(true);
    expect(diag.returnedInstrumentIds.length).toBe(0);
    // missing should equal requested
    expect(Array.isArray(diag.missingInstrumentIds)).toBe(true);
    expect(diag.missingInstrumentIds.length).toBe((diag.requestedInstrumentIds || []).length);
  });
});

export {};
