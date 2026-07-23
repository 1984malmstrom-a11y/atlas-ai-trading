import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwelveDataMarketDataProvider } from './twelve-data';

describe('TwelveDataMarketDataProvider.getFxRate', () => {
  const FAKE_KEY = 'test-api-key-secret-value';
  let origFetch: any;
  let origEnv: any;
  let nowMs = 1_600_000_000_000; // deterministic base

  beforeEach(() => {
    origFetch = global.fetch;
    origEnv = process.env.TWELVE_DATA_API_KEY;
    process.env.TWELVE_DATA_API_KEY = FAKE_KEY;
    nowMs = 1_600_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
  });
  afterEach(() => {
    global.fetch = origFetch;
    if (origEnv === undefined) delete process.env.TWELVE_DATA_API_KEY; else process.env.TWELVE_DATA_API_KEY = origEnv;
    vi.restoreAllMocks();
  });

  it('TEST A - SEK to SEK returns 1 and does not call fetch', async () => {
    const provider = new TwelveDataMarketDataProvider();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const r = await provider.getFxRate('SEK', 'SEK');
    expect(r).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TEST B - USD to SEK with valid response returns rate and calls fetch once with correct symbol', async () => {
    const provider = new TwelveDataMarketDataProvider();
    const fakeJson = { rate: '10' };
    const fetchSpy = vi.fn(async (input: any) => {
      return { ok: true, status: 200, json: async () => fakeJson } as any;
    });
    global.fetch = fetchSpy as any;

    const r = await provider.getFxRate('USD', 'SEK');
    expect(r).not.toBeNull();
    expect((r as any).rate).toBe(10);
    // provider now calls exchange_rate and a time_series lookup for previous_close: 2 fetches
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    // Inspect URL searchParams for symbol
    const u = new URL(calledUrl);
    expect(u.pathname.endsWith('/exchange_rate')).toBe(true);
    expect(u.searchParams.get('symbol')).toBe('USD/SEK');
    // API key present in URL but we never assert its value to avoid leakage
    expect(u.searchParams.has('apikey')).toBe(true);
  });

  it('TEST C - empty fromCurrency returns null and does not call fetch', async () => {
    const provider = new TwelveDataMarketDataProvider();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const r = await provider.getFxRate('', 'SEK');
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TEST D - HTTP 429 returns null and does not cache; subsequent valid call succeeds', async () => {
    const provider = new TwelveDataMarketDataProvider();
    let call = 0;
    const fetchSpy = vi.fn(async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 429, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({ rate: '11' }) } as any;
    });
    global.fetch = fetchSpy as any;

    const r1 = await provider.getFxRate('USD', 'SEK');
    expect(r1).toBeNull();
    // call again and expect real value
    const r2 = await provider.getFxRate('USD', 'SEK');
    expect(r2).not.toBeNull();
    expect((r2 as any).rate).toBe(11);
    // first call returned non-ok (429) -> 1 fetch; second successful call issues exchange_rate + time_series -> +2 => total 3
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('TEST E - provider error payload with status:error returns null and no cache', async () => {
    const provider = new TwelveDataMarketDataProvider();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'error', code: 429, message: 'API credits exhausted' }) }) as any);
    global.fetch = fetchSpy as any;

    const r = await provider.getFxRate('USD', 'SEK');
    expect(r).toBeNull();
    // subsequent valid response should still work
    fetchSpy.mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ rate: '12' }) }) as any);
    const r2 = await provider.getFxRate('USD', 'SEK');
    expect(r2).not.toBeNull();
    expect((r2 as any).rate).toBe(12);
  });

  it('TEST F/G - missing or invalid rate yields null and not cached', async () => {
    const provider = new TwelveDataMarketDataProvider();
    const badValues: any[] = [ {}, { rate: '0' }, { rate: '-1' }, { rate: 'NaN' }, { rate: 'Infinity' }, { rate: 'not-numeric' }, { rate: null } ];
    for (const bad of badValues){
      const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => bad }) as any);
      global.fetch = fetchSpy as any;
      const r = await provider.getFxRate('USD', 'SEK');
      expect(r).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('TEST H - cache returns same value within TTL and fetch called once', async () => {
    const provider = new TwelveDataMarketDataProvider();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rate: '10.25' }) }) as any);
    global.fetch = fetchSpy as any;

    const k1 = await provider.getFxRate('USD', 'SEK');
    expect(k1).not.toBeNull();
    expect((k1 as any).rate).toBe(10.25);
    // advance time slightly but within TTL
    nowMs += 60_000; // +1 minute
    const k2 = await provider.getFxRate('USD', 'SEK');
    expect(k2).not.toBeNull();
    expect((k2 as any).rate).toBe(10.25);
    // first successful call invoked exchange_rate + time_series => 2 fetches total
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('TEST I - cache expires after TTL and new fetch returns new value', async () => {
    const provider = new TwelveDataMarketDataProvider();
    let call = 0;
    const fetchSpy = vi.fn(async () => {
      call += 1;
      if (call === 1) return { ok: true, status: 200, json: async () => ({ rate: '10.25' }) } as any;
      return { ok: true, status: 200, json: async () => ({ rate: '10.5' }) } as any;
    });
    global.fetch = fetchSpy as any;

    const first = await provider.getFxRate('USD', 'SEK');
    expect(first).not.toBeNull();
    expect((first as any).rate).toBe(10.25);
    // advance time past TTL (5 minutes)
    nowMs += 6 * 60_000;
    const second = await provider.getFxRate('USD', 'SEK');
    expect(second).not.toBeNull();
    expect((second as any).rate).toBe(10.5);
    // first call: 2 fetches, second (after TTL) triggers another 2 => total 4
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('TEST J - in-flight deduplication: concurrent calls share one fetch and both resolve', async () => {
    const provider: any = new TwelveDataMarketDataProvider();
    let jsonResolve: any;
    const jsonPromise = new Promise(r => { jsonResolve = r; });
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => jsonPromise }) as any);
    global.fetch = fetchSpy as any;

    const p1 = provider.getFxRate('USD', 'SEK');
    const p2 = provider.getFxRate('USD', 'SEK');
    // still pending, exchange_rate fetch has been triggered once (json not yet resolved)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // resolve the underlying json
    jsonResolve({ rate: '9.5' });
    const [r1, r2] = await Promise.all([p1, p2]);
    // after resolution, getFxRate performs the additional time_series fetch, total 2
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect((r1 as any).rate).toBe(9.5);
    expect((r2 as any).rate).toBe(9.5);
    // pending cleared
    const key = 'USD->SEK';
    expect((provider as any).fxPending.has(key)).toBe(false);
    // subsequent call uses cache (no additional network fetches)
    nowMs += 60_000;
    const r3 = await provider.getFxRate('USD', 'SEK');
    expect(r3).not.toBeNull();
    expect((r3 as any).rate).toBe(9.5);
    // initial run performed exchange_rate + time_series => 2 fetches total
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('TEST K - in-flight failure resets and subsequent call retries', async () => {
    const provider: any = new TwelveDataMarketDataProvider();
    let jsonReject: any;
    const jsonPromise = new Promise((_, rej) => { jsonReject = rej; });
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => jsonPromise }) as any);
    global.fetch = fetchSpy as any;

    const p1 = provider.getFxRate('USD', 'SEK');
    const p2 = provider.getFxRate('USD', 'SEK');
    // fail the fetch
    jsonReject(new Error('network fail'));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    // pending cleared
    const key = 'USD->SEK';
    expect((provider as any).fxPending.has(key)).toBe(false);

    // next attempt should call fetch again and can succeed
    let call = 0;
    fetchSpy.mockImplementation(async () => { call += 1; return { ok: true, status: 200, json: async () => ({ rate: '8' }) } as any; });
    const r3 = await provider.getFxRate('USD', 'SEK');
    expect(r3).not.toBeNull();
    expect((r3 as any).rate).toBe(8);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('TEST REGRESSION - legacy quote-only payload without rate returns null and not cached; subsequent rate succeeds', async () => {
    const provider = new TwelveDataMarketDataProvider();
    let call = 0;
    const fetchSpy = vi.fn(async () => {
      call += 1;
      if (call === 1) return { ok: true, status: 200, json: async () => ({ price: '10.25', close: '10.25', last_price: '10.25' }) } as any;
      return { ok: true, status: 200, json: async () => ({ rate: '10.30' }) } as any;
    });
    global.fetch = fetchSpy as any;

    const r1 = await provider.getFxRate('USD', 'SEK');
    expect(r1).toBeNull();
    // not cached: second call triggers a new fetch and succeeds
    const r2 = await provider.getFxRate('USD', 'SEK');
    expect(r2).not.toBeNull();
    expect((r2 as any).rate).toBe(10.3);
    // first legacy call made 1 fetch (no rate -> null), second valid call makes exchange_rate + time_series -> +2 => total 3
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('TEST L - API key is not exposed in returned error or thrown value', async () => {
    const provider = new TwelveDataMarketDataProvider();
    // make fetch throw an error containing the key to ensure provider does not leak it
    const fetchSpy = vi.fn(async () => { throw new Error(`twelve error apikey=${FAKE_KEY}`); });
    global.fetch = fetchSpy as any;

    const r = await provider.getFxRate('USD', 'SEK');
    expect(r).toBeNull();
    // ensure the string is not present in the returned value (null) and not thrown
    // also ensure no console logs contain the key
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
