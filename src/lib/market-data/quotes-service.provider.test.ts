import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MarketDataProvider, MarketQuote } from './types';

// Use a mutable providerImpl that the hoisted mock delegates to. This allows per-test
// customization while using `vi.mock` which is hoisted by Vitest.
let providerImpl: { getQuotes: (...args: any[]) => Promise<any>; getQuote: (...args: any[]) => Promise<any> } = { getQuotes: async () => [], getQuote: async () => null };
vi.mock('./index', () => ({ default: { getQuotes: (...args: any[]) => providerImpl.getQuotes(...args), getQuote: (...args: any[]) => providerImpl.getQuote(...args) } }));

type NormalizedQuote = {
  instrumentId: string;
  price: number | null;
  currency: string | null;
  priceSek?: number;
  fxRateSek?: number;
};

type ServiceError = { instrumentId: string; symbol: string | null; code: string; message: string };

describe('quotes-service provider error handling & FX normalization', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  it('batch empty + individual getQuote throws -> PROVIDER_ERROR and not NO_DATA', async () => {
    const provider = {
      getQuotes: async (_ids: string[]) => [],
      getQuote: async (_id: string) => { throw new Error('Twelve Data quote request failed: 429'); },
    };

    const svc = await import('./quotes-service');
    const providerMock = provider as MarketDataProvider;
    const out = await svc.getNormalizedQuotes(providerMock);

    const provErr = out.errors.find((e: ServiceError)=> e.instrumentId === 'microsoft' && e.code === 'PROVIDER_ERROR');
    const noData = out.errors.find((e: ServiceError)=> e.instrumentId === 'microsoft' && e.code === 'NO_DATA');
    expect(!!provErr).toBe(true);
    expect(!!noData).toBe(false);
  });

  it('batch empty + individual getQuote returns null -> NO_DATA', async () => {
    const provider = {
      getQuotes: async (_ids: string[]) => [] as MarketQuote[],
      getQuote: async (_id: string) => { return null as unknown as MarketQuote; },
    } as MarketDataProvider;

    const svc = await import('./quotes-service');
    const out = await svc.getNormalizedQuotes(provider);
    const noData = out.errors.find((e: ServiceError)=> e.instrumentId === 'microsoft' && e.code === 'NO_DATA');
    expect(!!noData).toBe(true);
  });

  it('FX Test A - USD quote with injected getFxRate -> priceSek and fxRateSek present', async () => {
    const provider: MarketDataProvider = {
      getQuotes: async (_ids: string[]) => [{ instrumentId: 'microsoft', symbol: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', price: 500, previousClose: 490, change: 10, changePercent: 2.0408, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }],
      getQuote: async (_id: string) => { throw new Error('not used'); },
    };
    const getFxRate = vi.fn(async (from: string, to: string) => { expect(from).toBe('USD'); expect(to).toBe('SEK'); return 10; });

    const svc = await import('./quotes-service');
    const out = await svc.getNormalizedQuotes(provider, { getFxRate });
    const q = out.quotes.find((x: NormalizedQuote)=> x.instrumentId === 'microsoft');
    expect(q).toBeTruthy();
    expect(q!.price).toBe(500);
    expect(q!.currency).toBe('USD');
    expect(q!.priceSek).toBe(5000);
    expect(q!.fxRateSek).toBe(10);
      const fxErr = out.errors.find((e: ServiceError)=> e.instrumentId === 'microsoft' && e.code === 'FX_UNAVAILABLE');
    expect(fxErr).toBeUndefined();
  });

  it('FX Test B - SEK quote does not call getFxRate and priceSek set to price', async () => {
    // use an enabled instrument id (microsoft) but with SEK currency in provider response
    const provider: MarketDataProvider = {
      getQuotes: async (_ids: string[]) => [{ instrumentId: 'microsoft', symbol: 'MSFT', exchange: 'STOCKHOLM', name: 'Microsoft Sweden', price: 250, previousClose: 245, change: 5, changePercent: 2.04, currency: 'SEK', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }],
      getQuote: async (_id: string) => { throw new Error('not used'); },
    };
    const getFxRate = vi.fn(async ()=> { throw new Error('should not be called'); });
    const svc = await import('./quotes-service');
    const out = await svc.getNormalizedQuotes(provider, { getFxRate });
    const q = out.quotes.find((x: NormalizedQuote)=> x.instrumentId === 'microsoft');
    expect(q).toBeTruthy();
    expect(q!.price).toBe(250);
    expect(q!.currency).toBe('SEK');
    expect(q!.priceSek).toBe(250);
    expect(q!.fxRateSek).toBe(1);
    expect(getFxRate).not.toHaveBeenCalled();
  });

  it('FX Test C - USD quote without getFxRate -> priceSek undefined and no FX error', async () => {
    const provider: MarketDataProvider = { getQuotes: async () => [{ instrumentId: 'microsoft', symbol: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', price: 500, previousClose: 490, change: 10, changePercent: 2.0408, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }], getQuote: async (_id: string) => { throw new Error('not used'); } };
    const svc = await import('./quotes-service');
    const out = await svc.getNormalizedQuotes(provider);
    const q = out.quotes.find((x: NormalizedQuote)=> x.instrumentId === 'microsoft');
    expect(q).toBeTruthy();
    expect(q!.priceSek).toBeUndefined();
      const fxErr = out.errors.find((e: ServiceError)=> e.instrumentId === 'microsoft' && e.code === 'FX_UNAVAILABLE');
    expect(fxErr).toBeUndefined();
  });

  it('FX Test D - getFxRate returns null or throws -> FX_UNAVAILABLE and no duplicate errors', async () => {
    // case: returns null
    const provider1: MarketDataProvider = { getQuotes: async () => [{ instrumentId: 'microsoft', symbol: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', price: 500, previousClose: 490, change: 10, changePercent: 2.0408, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }], getQuote: async (_id: string) => { throw new Error('not used'); } };
    const getFxRateNull = vi.fn(async ()=> null as number | null);
    const svc = await import('./quotes-service');
    const out1 = await svc.getNormalizedQuotes(provider1, { getFxRate: getFxRateNull });
    const fxErr1 = out1.errors.filter((e: ServiceError)=> e.instrumentId === 'microsoft' && e.code === 'FX_UNAVAILABLE');
    expect(fxErr1.length).toBe(1);
    const q1 = out1.quotes.find((x: NormalizedQuote)=> x.instrumentId === 'microsoft');
    expect(q1?.priceSek).toBeUndefined();

    // case: throws
    const provider2: MarketDataProvider = { getQuotes: async () => [{ instrumentId: 'microsoft', symbol: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', price: 500, previousClose: 490, change: 10, changePercent: 2.0408, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }], getQuote: async (_id: string) => { throw new Error('not used'); } };
    const getFxRateThrow = vi.fn(async ()=> { throw new Error('FX provider unreachable'); });
    const out2 = await svc.getNormalizedQuotes(provider2, { getFxRate: getFxRateThrow });
    const fxErr2 = out2.errors.filter((e: ServiceError)=> e.instrumentId === 'microsoft' && e.code === 'FX_UNAVAILABLE');
    expect(fxErr2.length).toBe(1);
    const q2 = out2.quotes.find((x: NormalizedQuote)=> x.instrumentId === 'microsoft');
    expect(q2?.priceSek).toBeUndefined();
  });

  it.each([0, -1, NaN, Infinity])('FX Test E - invalid fx rate %p -> FX_UNAVAILABLE', async (badRate) => {
    const provider: MarketDataProvider = { getQuotes: async () => [{ instrumentId: 'microsoft', symbol: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', price: 500, previousClose: 490, change: 10, changePercent: 2.0408, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }], getQuote: async (_id: string) => { throw new Error('not used'); } };
    const getFxRateInvalid = vi.fn(async ()=> badRate as number);
    const svc = await import('./quotes-service');
    const out = await svc.getNormalizedQuotes(provider, { getFxRate: getFxRateInvalid });
    const fxErr = out.errors.filter((e: ServiceError)=> e.instrumentId === 'microsoft' && e.code === 'FX_UNAVAILABLE');
    expect(fxErr.length).toBe(1);
    const q = out.quotes.find((x: NormalizedQuote)=> x.instrumentId === 'microsoft');
    expect(q?.priceSek).toBeUndefined();
  });

  // Deterministic cache + in-flight tests for module-scoped standard cache
  it('A - sequential standard calls within TTL use cache', async () => {
    vi.resetModules();
    const getQuotesMock = vi.fn(async (ids: string[]) => ids.map(id => ({ instrumentId: id, symbol: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', price: 1, previousClose: 1, change: 0, changePercent: 0, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' })));
    const getQuoteMock = vi.fn(async () => { throw new Error('not used'); });
    providerImpl.getQuotes = getQuotesMock;
    providerImpl.getQuote = getQuoteMock;
    const svc = await import('./quotes-service');
    // first call populates cache
    const a = await svc.getNormalizedQuotes();
    const b = await svc.getNormalizedQuotes();
    expect(getQuotesMock).toHaveBeenCalledTimes(1);
    expect(a).toBeTruthy();
    expect(b).toBe(a); // same cached object reference
  });

  it('B - concurrent standard calls share pending Promise', async () => {
    vi.resetModules();
    const getQuotesMock = vi.fn((ids: string[]) => new Promise(resolve => setTimeout(() => resolve(ids.map(id => ({ instrumentId: id, symbol: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', price: 2, previousClose: 2, change: 0, changePercent: 0, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }))), 50)));
    const getQuoteMock = vi.fn(async () => { throw new Error('not used'); });
    providerImpl.getQuotes = getQuotesMock;
    providerImpl.getQuote = getQuoteMock;
    const svc = await import('./quotes-service');
    const p1 = svc.getNormalizedQuotes();
    const p2 = svc.getNormalizedQuotes();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(getQuotesMock).toHaveBeenCalledTimes(1);
    expect(r1).toBeTruthy();
    expect(r2).toBe(r1);
    
  });

  it('C - after TTL a new fetch occurs', async () => {
    vi.resetModules();
    let call = 0;
    const getQuotesMock = vi.fn(async (ids: string[]) => { call++; return ids.map(id => ({ instrumentId: id, symbol: 'MSFT', price: call === 1 ? 3 : 4, previousClose: 3, change: 0, changePercent: 0, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' })); });
    const getQuoteMock = vi.fn(async () => { throw new Error('not used'); });
    providerImpl.getQuotes = getQuotesMock;
    providerImpl.getQuote = getQuoteMock;
    const svc = await import('./quotes-service');
    const first = await svc.getNormalizedQuotes();
    // simulate cache expiry by advancing Date.now
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => realNow + (15 * 60_000) + 1000);
    const second = await svc.getNormalizedQuotes();
    expect(getQuotesMock).toHaveBeenCalledTimes(2);
    expect(second.quotes[0].price).not.toBe(first.quotes[0].price);
    (Date.now as any).mockRestore?.();
  });

  it('D - errors are not cached; next call fetches again', async () => {
    vi.resetModules();
    const getQuotesMock = vi.fn()
      .mockRejectedValueOnce(new Error('provider fail'))
      .mockResolvedValueOnce([{ instrumentId: 'microsoft', symbol: 'MSFT', price: 5, previousClose: 5, change: 0, changePercent: 0, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }]);
    const getQuoteMock = vi.fn(async () => { throw new Error('not used'); });
    providerImpl.getQuotes = getQuotesMock;
    providerImpl.getQuote = getQuoteMock;
    const svc = await import('./quotes-service');
    const out1 = await svc.getNormalizedQuotes();
    expect(Array.isArray(out1.errors)).toBe(true);
    const out2 = await svc.getNormalizedQuotes();
    expect(getQuotesMock).toHaveBeenCalledTimes(2);
  });

  it('E - rejected pending cleared and subsequent call can succeed', async () => {
    vi.resetModules();
    const getQuotesMock = vi.fn()
      .mockImplementationOnce(() => new Promise((_, rej) => setTimeout(() => rej(new Error('boom')), 50)))
      .mockImplementationOnce((ids: string[]) => new Promise(resolve => setTimeout(() => resolve(ids.map(id => ({ instrumentId: id, symbol: 'MSFT', price: 6, previousClose: 6, change: 0, changePercent: 0, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }))), 50)));
    const getQuoteMock = vi.fn(async () => { throw new Error('not used'); });
    providerImpl.getQuotes = getQuotesMock;
    providerImpl.getQuote = getQuoteMock;
    const svc = await import('./quotes-service');
    const p1 = svc.getNormalizedQuotes();
    const out1 = await p1;
    expect(Array.isArray(out1.errors)).toBe(true);
    // after failure-like result, next call should attempt again
    const p2 = svc.getNormalizedQuotes();
    const r2 = await p2;
    expect(r2.quotes.length).toBeGreaterThan(0);
  });

  it('F - custom provider or getFxRate bypasses standard cache', async () => {
    vi.resetModules();
    const getQuotesMockA = vi.fn(async () => [{ instrumentId: 'microsoft', symbol: 'MSFT', price: 7, previousClose: 7, change: 0, changePercent: 0, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }]);
    const providerA = { getQuotes: getQuotesMockA, getQuote: async (_: string) => null } as unknown as MarketDataProvider;
    providerImpl.getQuotes = vi.fn(async () => [{ instrumentId: 'microsoft', symbol: 'MSFT', price: 8, previousClose: 8, change: 0, changePercent: 0, currency: 'USD', timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false, dataStatus: 'REALTIME' }]);
    providerImpl.getQuote = async (_: string) => null;
    const svc = await import('./quotes-service');
    // providerOverride should bypass module cache
    const r1 = await svc.getNormalizedQuotes(providerA);
    const r2 = await svc.getNormalizedQuotes(providerA);
    expect(getQuotesMockA).toHaveBeenCalledTimes(2);
    // custom getFxRate should also bypass cache (call with injected getFxRate and no providerOverride)
    const getFxRate = async (_: string, __: string) => 10;
    const r3 = await svc.getNormalizedQuotes(undefined, { getFxRate });
    const r4 = await svc.getNormalizedQuotes(undefined, { getFxRate });
    expect(r3).toBeTruthy();
    expect(r4).toBeTruthy();
  });
});
