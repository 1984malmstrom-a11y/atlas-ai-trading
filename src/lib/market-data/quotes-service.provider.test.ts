import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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

  // Note: live provider checks removed from automated test suite. All historical tests are mocked deterministic below.

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

  describe('historical daily closes (Twelve Data)', ()=>{
    beforeEach(()=>{ vi.resetModules(); process.env.TWELVE_DATA_API_KEY = 'testkey'; });

    it('normalizes latest-first provider response to oldest-first closes', async ()=>{
      // Build mock values: newest first
      const days = 25;
      const base = new Date('2026-07-23T00:00:00.000Z');
      const values: any[] = [];
      for (let i=0;i<days;i++){
        const d = new Date(base.getTime() - i * 24*3600*1000);
        const date = d.toISOString().slice(0,10);
        values.push({ datetime: date + 'T00:00:00Z', close: String(100 + (days - i)) });
      }

      const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async ()=> ({ values }) } as any);
      const mod = await import('./twelve-data');
      const provider = new mod.TwelveDataMarketDataProvider();
      const out = await provider.getHistoricalDailyCloses('MSFT', 25);
      expect(out.closes.length).toBe(days);
      // oldest-first: first date should be base - (days-1)
      expect(out.dates[0]).toBe(values[values.length-1].datetime.slice(0,10));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('filters out current UTC date and keeps prior dates; dates and closes aligned', async ()=>{
      vi.resetModules();
      // Set system time to 2026-07-24 UTC
      vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
      const values: any[] = [];
      // include dates: 2026-07-24 (today), 2026-07-23, 2026-07-22 ... total 25
      const base = new Date('2026-07-24T00:00:00.000Z');
      for (let i=0;i<25;i++){
        const d = new Date(base.getTime() - i * 24*3600*1000);
        const date = d.toISOString().slice(0,10);
        values.push({ datetime: date + 'T00:00:00Z', close: String(100 + i) });
      }
      const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async ()=> ({ values }) } as any);
      const mod = await import('./twelve-data');
      const provider = new mod.TwelveDataMarketDataProvider();
      const out = await provider.getHistoricalDailyCloses('MSFT', 25);
      // today's date should be filtered out
      const today = new Date().toISOString().slice(0,10);
      expect(out.dates[out.dates.length-1] < today).toBeTruthy();
      expect(out.dates).not.toContain(today);
      // dates and closes same length
      expect(out.dates.length).toBe(out.closes.length);
      vi.useRealTimers();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('filters out future dates and timestamps containing today', async ()=>{
      vi.resetModules();
      vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
      const values: any[] = [];
      // include future date 2026-07-25, today 2026-07-24, and prior 2026-07-23.. total entries
      const dates = ['2026-07-25','2026-07-24','2026-07-23','2026-07-22','2026-07-21','2026-07-20','2026-07-19','2026-07-18','2026-07-17','2026-07-16','2026-07-15','2026-07-14','2026-07-13','2026-07-12','2026-07-11','2026-07-10','2026-07-09','2026-07-08','2026-07-07','2026-07-06','2026-07-05','2026-07-04','2026-07-03','2026-07-02','2026-07-01'];
      for (let i=0;i<dates.length;i++){
        // use timestamps with time parts to ensure slice normalization works
        values.push({ datetime: dates[i] + 'T23:59:59Z', close: String(200 + i) });
      }
      const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async ()=> ({ values }) } as any);
      const mod = await import('./twelve-data');
      const provider = new mod.TwelveDataMarketDataProvider();
      const out = await provider.getHistoricalDailyCloses('MSFT', 25);
      // ensure future date and today are filtered
      expect(out.dates).not.toContain('2026-07-25');
      expect(out.dates).not.toContain('2026-07-24');
      // ensure last returned date is < todayUtc
      const today = new Date().toISOString().slice(0,10);
      expect(out.dates[out.dates.length-1] < today).toBeTruthy();
      expect(out.dates.length).toBe(out.closes.length);
      vi.useRealTimers();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('invalid/negative prices are filtered and insufficient history reported', async ()=>{
      const values: any[] = [];
      const base = new Date('2026-07-30T00:00:00Z');
      // produce 25 entries but many invalid
      for (let i=0;i<25;i++){
        const d = new Date(base.getTime() - i * 24*3600*1000);
        const date = d.toISOString().slice(0,10);
        const close = i < 10 ? '-1' : String(100 + i); // first 10 invalid
        values.push({ datetime: date, close });
      }
      const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async ()=> ({ values }) } as any);
      const mod = await import('./twelve-data');
      const provider = new mod.TwelveDataMarketDataProvider();
      let caught: any = null;
      try{ await provider.getHistoricalDailyCloses('MSFT', 25); }catch(e:any){ caught = e; }
      expect(caught).toBeTruthy();
      expect(caught.code === 'INSUFFICIENT_HISTORY').toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('provider error maps to UNSUPPORTED_SYMBOL or PROVIDER_ERROR', async ()=>{
      const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async ()=> ({ status: 'error', message: 'Invalid symbol' }) } as any);
      const mod = await import('./twelve-data');
      const provider = new mod.TwelveDataMarketDataProvider();
      let caught: any = null;
      try{ await provider.getHistoricalDailyCloses('UNKNOWN', 30); }catch(e:any){ caught = e; }
      expect(caught).toBeTruthy();
      expect(caught.code === 'UNSUPPORTED_SYMBOL' || caught.code === 'PROVIDER_ERROR').toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('cache prevents duplicate immediate calls', async ()=>{
      const days = 22;
      const base = new Date('2026-07-23T00:00:00.000Z');
      const values: any[] = [];
      for (let i=0;i<days;i++){ const d = new Date(base.getTime() - i * 24*3600*1000); values.push({ datetime: d.toISOString(), close: String(100 + i) }); }
      const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async ()=> ({ values }) } as any);
      const mod = await import('./twelve-data');
      const provider = new mod.TwelveDataMarketDataProvider();
      const [a,b] = await Promise.all([ provider.getHistoricalDailyCloses('MSFT', days), provider.getHistoricalDailyCloses('MSFT', days) ]);
      expect(a.closes.length).toBe(days);
      expect(b.closes.length).toBe(days);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
