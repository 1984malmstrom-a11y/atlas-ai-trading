import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks will be set per-test via spies
import * as quotesService from '../../../lib/market-data/quotes-service';
import * as demoRuntime from '../../../lib/paper-trader/demo-runtime';
import * as instruments from '../../../lib/market-data/instruments';
import * as mdIndex from '../../../lib/market-data/index';
import { POST } from './route';

describe('paper-trader route referencePrice SEK handling', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('Test A - USD instrument with priceSek: engine receives SEK referencePrice and requestedNotionalSek', async () => {
    const origKey = process.env.TWELVE_DATA_API_KEY;
    process.env.TWELVE_DATA_API_KEY = 'test';
    vi.spyOn(mdIndex, 'getMarketDataProvider').mockImplementation(() => ({ getFxRate: async (from: string, to: string) => { return 10; } } as any));
    const quote = { instrumentId: 'microsoft', symbol: 'MSFT', price: 500, currency: 'USD', priceSek: 5000, fxRateSek: 10, isStale: false, dataStatus: 'REALTIME' };
    vi.spyOn(quotesService, 'getNormalizedQuotes').mockResolvedValue({ quotes: [quote], errors: [], disabledInstruments: [], fetchedAt: new Date().toISOString() } as any);

    let capturedDecision: any = null;
    const execSpy = vi.spyOn(demoRuntime, 'executePaperTradeDecision').mockImplementation(async (decision) => {
      capturedDecision = decision;
      return {
        result: { accepted: true, execution: { id: 'exec1', decisionId: decision.id, symbol: decision.symbol, side: decision.action, quantity: 2, executedPrice: decision.referencePrice, notional: Number(decision.requestedNotionalSek), fee: 0, generatedAt: new Date().toISOString() } },
        state: { enabled: true, mode: 'PAPER', startCapital: 100000, availableCash: 90000, holdings: [], totalValue: 90000, totalReturnSek: -10000, totalReturnPercent: -10, latestDecision: null, latestCycle: null, auditEntries: [], lastUpdated: new Date().toISOString() }
      } as any;
    });

    const req = { json: async () => ({ instrumentId: 'microsoft', side: 'BUY', quantity: 2 }) } as unknown as Request;
    const res = await POST(req);

    // ensure getNormalizedQuotes was called with an injected getFxRate when API key present
    const call = (quotesService.getNormalizedQuotes as any).mock.calls[0];
    expect(call).toBeTruthy();
    const opts = call[1];
    expect(opts).toBeTruthy();
    expect(typeof opts.getFxRate).toBe('function');

    // restore env
    if (origKey === undefined) delete process.env.TWELVE_DATA_API_KEY; else process.env.TWELVE_DATA_API_KEY = origKey;

    expect(execSpy).toHaveBeenCalled();
    expect(capturedDecision).toBeTruthy();
    expect(capturedDecision.referencePrice).toBe(5000);
    expect(capturedDecision.requestedNotionalSek).toBe(10000);
    // ensure original price 500 is NOT used
    expect(capturedDecision.referencePrice).not.toBe(500);
  });

  it('Test B - USD instrument without priceSek -> FX_REQUIRED and engine not called', async () => {
    const quote = { instrumentId: 'microsoft', symbol: 'MSFT', price: 500, currency: 'USD', isStale: false, dataStatus: 'REALTIME' };
    vi.spyOn(quotesService, 'getNormalizedQuotes').mockResolvedValue({ quotes: [quote], errors: [], disabledInstruments: [], fetchedAt: new Date().toISOString() } as any);

    const execSpy = vi.spyOn(demoRuntime, 'executePaperTradeDecision').mockResolvedValue({ result: { accepted: false }, state: { enabled: true, mode: 'PAPER', startCapital: 100000, availableCash: 100000, holdings: [], totalValue: 100000, totalReturnSek: 0, totalReturnPercent: 0, latestDecision: null, latestCycle: null, auditEntries: [], lastUpdated: new Date().toISOString() } } as any);

    const req = { json: async () => ({ instrumentId: 'microsoft', side: 'BUY', quantity: 2 }) } as unknown as Request;
    const res: any = await POST(req);

    // engine must not be called
    expect(execSpy).not.toHaveBeenCalled();
    // expect HTTP 422 response (FX_REQUIRED)
    expect(res).toBeTruthy();
    if (typeof res.status === 'number') expect(res.status).toBe(422);
  });

  it('Test C - SEK instrument uses SEK price for referencePrice and notional', async () => {
    const quote = { instrumentId: 'investor', symbol: 'INVE.B', price: 250, currency: 'SEK', priceSek: 250, isStale: false, dataStatus: 'REALTIME' };
    vi.spyOn(quotesService, 'getNormalizedQuotes').mockResolvedValue({ quotes: [quote], errors: [], disabledInstruments: [], fetchedAt: new Date().toISOString() } as any);

    // ensure instrument is treated as enabled in test environment
    vi.spyOn(instruments, 'findInstrumentById').mockImplementation((id: string) => ({ id: 'investor', name: 'Investor', providerSymbol: 'INVE.B', exchange: 'STO', currency: 'SEK', enabled: true } as any));

    let capturedDecision: any = null;
    const execSpy = vi.spyOn(demoRuntime, 'executePaperTradeDecision').mockImplementation(async (decision) => {
      capturedDecision = decision;
      return {
        result: { accepted: true, execution: { id: 'exec2', decisionId: decision.id, symbol: decision.symbol, side: decision.action, quantity: 2, executedPrice: decision.referencePrice, notional: Number(decision.requestedNotionalSek), fee: 0, generatedAt: new Date().toISOString() } },
        state: { enabled: true, mode: 'PAPER', startCapital: 100000, availableCash: 90000, holdings: [], totalValue: 90000, totalReturnSek: -10000, totalReturnPercent: -10, latestDecision: null, latestCycle: null, auditEntries: [], lastUpdated: new Date().toISOString() }
      } as any;
    });

    const req = { json: async () => ({ instrumentId: 'investor', side: 'BUY', quantity: 2 }) } as unknown as Request;
    const res = await POST(req);

    expect(execSpy).toHaveBeenCalled();
    expect(capturedDecision.referencePrice).toBe(250);
    expect(capturedDecision.requestedNotionalSek).toBe(500);
  });
});
