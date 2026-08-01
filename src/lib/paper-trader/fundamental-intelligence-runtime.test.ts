import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks must be registered before importing the runtime module
const stockInst = { id: 'acme', providerSymbol: 'ACME', assetType: 'STOCK', enabled: true, marketDataEnabled: true };
const forexInst = { id: 'eursek', providerSymbol: 'EURSEK', assetType: 'FOREX', enabled: true, marketDataEnabled: true };

vi.doMock('../../lib/market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [stockInst, forexInst] }));

const mockFetchAndBuild = vi.fn();
vi.doMock('./fundamental-data', () => ({ fetchAndBuildFundamentalIntelligence: (opts:any) => mockFetchAndBuild(opts) }));

import * as runtimeModule from './demo-runtime';

describe('Per-cycle fundamental resolver (runtime integration)', () => {
  beforeEach(()=>{ vi.restoreAllMocks(); mockFetchAndBuild.mockReset(); });
  afterEach(()=>{ vi.clearAllMocks(); });

  it('fetches STOCK exactly once per cycle and skips FOREX', async () => {
    // prepare mock to resolve with a simple shaped result
    mockFetchAndBuild.mockImplementation(async ({ symbol }: any) => ({ capabilities: {}, snapshot: { schemaVersion:1, source:'TWELVE_DATA_FUNDAMENTALS', symbol, fetchedAt: new Date().toISOString(), dataStatus: 'PARTIAL', availableCategories: ['statistics'], missingCapabilities: [], profitability: {}, financialHealth:{}, cashFlow:{}, valuation:{}, earnings:{}, warnings:[] }, quality: { level: 'INSUFFICIENT', score: 0, positiveFactors: [], negativeFactors: [], warnings: [] }, signal: { id: `fundamental_quality_${symbol}`, type: 'FUNDAMENTAL_QUALITY', origin: 'COMPANY_FINANCIAL_STATEMENTS', direction: 'NEUTRAL', strength: 0, symbols: [symbol], generatedAt: new Date().toISOString() } }));

    // Create a per-cycle resolver using the runtime exported helper
    const resolver = runtimeModule.createPerCycleFundamentalResolver({ fetchFundamental: async ({ symbol }: any) => mockFetchAndBuild({ symbol }), instruments: [{ providerSymbol: 'ACME', assetType: 'STOCK' }, { providerSymbol: 'EURSEK', assetType: 'FOREX' }], timeoutMs: 2000, appendAudit: async ()=>{}, updateState: (s:any,r:any)=>{} });
    // Resolve ACME twice and EURSEK once
    const r1 = await resolver.resolve({ symbol: 'ACME', analyzed: true });
    const r2 = await resolver.resolve({ symbol: 'ACME', analyzed: true });
    const r3 = await resolver.resolve({ symbol: 'EURSEK', analyzed: true });
    // Ensure ACME fetched once and EURSEK skipped
    const calls = mockFetchAndBuild.mock.calls.filter(c=> String(c[0].symbol).toUpperCase() === 'ACME');
    expect(calls.length).toBe(1);
    const forexCalls = mockFetchAndBuild.mock.calls.filter(c=> String(c[0].symbol).toUpperCase() === 'EURSEK');
    expect(forexCalls.length).toBe(0);
    expect(r1).toBeTruthy();
    expect(r2).toBe(r1);
    expect(r3).toEqual({ skipped: true, reason: 'NOT_STOCK' });
  });
});
