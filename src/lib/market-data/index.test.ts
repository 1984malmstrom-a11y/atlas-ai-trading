import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// module paths (use literals below to avoid initialization ordering issues)
// const INDEX_PATH = './index';
// const TD_PATH = './twelve-data';

describe('market-data index lazy provider', () => {
  const origKey = process.env.TWELVE_DATA_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    process.env.TWELVE_DATA_API_KEY = origKey;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('importing index does not create provider and does not call fetch (lazy import)', async () => {
    // remove API key
    delete process.env.TWELVE_DATA_API_KEY;

    // spy on global fetch
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // mock twelve-data to observe constructor calls without executing real code
    let ctorCount = 0;
    vi.mock('./twelve-data', () => {
      class Dummy {
        constructor(){ ctorCount += 1; }
        async getQuote() { return null; }
        async getQuotes() { return []; }
      }
      return { TwelveDataMarketDataProvider: Dummy };
    });

    // import index after mocks
    const mod = await import('./index');
    expect(mod).toBeDefined();

    // ensure provider was not instantiated on import
    expect(ctorCount).toBe(0);

    // ensure fetch was not called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('property-access (typeof) does not create provider', async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    let ctorCount = 0;
    vi.mock('./twelve-data', () => {
      class Dummy { constructor(){ ctorCount += 1; } async getQuote(){ return null; } async getQuotes(){ return []; } }
      return { TwelveDataMarketDataProvider: Dummy };
    });

    const mod = await import('./index');
    // property-access should not instantiate provider
    expect(typeof (mod.default as any).getQuote).toBe('function');
    expect(typeof (mod.default as any).getQuotes).toBe('function');
    expect(ctorCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('first use without API key throws when provider is created', async () => {
    delete process.env.TWELVE_DATA_API_KEY;

    // do not mock twelve-data: use real module which throws if key missing
    vi.unmock('./twelve-data');

    // ensure no accidental network calls
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const mod = await import('./index');
    expect(mod).toBeDefined();

    // calling default.getQuotes should attempt to create provider and thus throw
    try{
      await (mod.default as any).getQuotes([]);
      throw new Error('expected provider creation to throw');
    }catch(e: any){
      expect(String(e.message)).toMatch(/TWELVE_DATA_API_KEY must be set on server/);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getMarketDataProvider returns same singleton and does not call fetch on creation when key present', async () => {
    process.env.TWELVE_DATA_API_KEY = 'dummy_key_for_test';

    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);

    const mod = await import('./index');
    const a = mod.getMarketDataProvider();
    const b = mod.getMarketDataProvider();
    expect(a).toBe(b);

    // we did not call provider methods, so fetch should not have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('default export forwards getQuote/getQuotes to same singleton', async () => {
    process.env.TWELVE_DATA_API_KEY = 'dummy_key_for_test';

    // stub fetch to return a minimal successful response for Twelve Data
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ price: 100, previous_close: 90, symbol: 'MSFT', exchange: 'NASDAQ', currency: 'USD', timestamp: Date.now() }) })));

    const mod = await import('./index');

    // default should expose functions
    expect(typeof (mod.default as any).getQuote).toBe('function');
    expect(typeof (mod.default as any).getQuotes).toBe('function');

    // call through default to ensure it forwards to provider (no network errors due to stub)
    // use a known instrument id from instruments list
    const res = await (mod.default as any).getQuotes(['microsoft']);
    expect(Array.isArray(res)).toBe(true);
  });
});
