import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Helper to clear env keys used by registry
const ENV_KEYS = ['PAPER_TRADER_MACRO_VIX_SYMBOL','PAPER_TRADER_MACRO_DXY_SYMBOL','PAPER_TRADER_MACRO_US10Y_SYMBOL'];
function clearEnv(){ for (const k of ENV_KEYS) delete process.env[k]; }

beforeEach(() => { vi.resetModules(); clearEnv(); });
afterEach(() => { vi.restoreAllMocks(); clearEnv(); });

describe('fetchMacroSnapshot adapter (focused)', () => {
  it('no env-symbols -> all UNSUPPORTED and no provider calls', async () => {
    // mock instruments and provider to ensure provider.getQuote not called
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [] }));
    const getQuote = vi.fn(async () => { throw new Error('should not be called'); });
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const res = await mod.fetchMacroSnapshot();
    expect(res.statusByIndicator.vix).toBe('UNSUPPORTED');
    expect(res.statusByIndicator.dxy).toBe('UNSUPPORTED');
    expect(res.statusByIndicator.us10y).toBe('UNSUPPORTED');
    expect(getQuote).toHaveBeenCalledTimes(0);
  });

  it('only VIX configured -> one provider call, others not fetched', async () => {
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'vix', providerSymbol: 'VIX' } ] }));
    const getQuote = vi.fn(async (id:string) => { if (id==='vix') return { instrumentId: 'vix', price: 12, timestamp: new Date().toISOString(), isStale: false }; throw new Error('not found'); });
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const res = await mod.fetchMacroSnapshot();
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(res.statusByIndicator.vix).toBe('OK');
    expect(res.statusByIndicator.dxy).toBe('UNSUPPORTED');
    expect(res.statusByIndicator.us10y).toBe('UNSUPPORTED');
    expect(res.snapshot.vix).toBe(12);
  });

  it('whitespace in env is trimmed', async () => {
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = '  VIX  ';
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'vix', providerSymbol: 'VIX' } ] }));
    const getQuote = vi.fn(async (id:string) => ({ instrumentId: id, price: 14, timestamp: new Date().toISOString(), isStale: false }));
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const res = await mod.fetchMacroSnapshot();
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(res.statusByIndicator.vix).toBe('OK');
    expect(res.snapshot.vix).toBe(14);
  });

  it('partial success: VIX OK, DXY ERROR, US10Y UNSUPPORTED', async () => {
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    process.env.PAPER_TRADER_MACRO_DXY_SYMBOL = 'DXY';
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'vix', providerSymbol: 'VIX' }, { id: 'dxy', providerSymbol: 'DXY' } ] }));
    const getQuote = vi.fn(async (id:string) => {
      if (id === 'vix') return { instrumentId: 'vix', price: 10, timestamp: new Date().toISOString(), isStale: false };
      if (id === 'dxy') throw new Error('provider error');
      throw new Error('not found');
    });
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const res = await mod.fetchMacroSnapshot();
    expect(res.statusByIndicator.vix).toBe('OK');
    expect(res.statusByIndicator.dxy).toBe('ERROR');
    expect(res.statusByIndicator.us10y).toBe('UNSUPPORTED');
    expect(res.snapshot.vix).toBe(10);
  });

  it('stale provider value -> STALE and no snapshot value; isFresh=false', async () => {
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'vix', providerSymbol: 'VIX' } ] }));
    const getQuote = vi.fn(async (id:string) => ({ instrumentId: id, price: 20, timestamp: new Date(Date.now()-10*60*1000).toISOString(), isStale: true }));
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const res = await mod.fetchMacroSnapshot();
    expect(res.statusByIndicator.vix).toBe('STALE');
    expect(res.snapshot.vix).toBeUndefined();
    expect(res.diagnosticsByIndicator.vix.isFresh).toBe(false);
  });

  it('invalid numeric value -> ERROR and no snapshot value', async () => {
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'vix', providerSymbol: 'VIX' } ] }));
    const getQuote = vi.fn(async (id:string) => ({ instrumentId: id, price: 0, timestamp: new Date().toISOString(), isStale: false }));
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const res = await mod.fetchMacroSnapshot();
    expect(res.statusByIndicator.vix).toBe('ERROR');
    expect(res.snapshot.vix).toBeUndefined();
  });

  it('fresh timestamp -> OK, hasTimestamp=true, isFresh=true', async () => {
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'vix', providerSymbol: 'VIX' } ] }));
    const getQuote = vi.fn(async (id:string) => ({ instrumentId: id, price: 11, timestamp: new Date().toISOString(), isStale: false }));
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const res = await mod.fetchMacroSnapshot();
    expect(res.statusByIndicator.vix).toBe('OK');
    expect(res.diagnosticsByIndicator.vix.hasTimestamp).toBe(true);
    expect(res.diagnosticsByIndicator.vix.isFresh).toBe(true);
  });

  it('secure diagnostics and no console logging', async () => {
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'vix', providerSymbol: 'VIX' } ] }));
    const getQuote = vi.fn(async (id:string) => ({ instrumentId: id, price: 9, timestamp: new Date().toISOString(), isStale: false }));
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(()=>{});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(()=>{});
    const mod = await import('./macro-signals');
    const res = await mod.fetchMacroSnapshot();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    // diagnostics must not include provider symbol or secrets
    const diag = res.diagnosticsByIndicator.vix as any;
    expect(typeof diag.configured).toBe('boolean');
    expect(Object.keys(diag).includes('providerSymbol')).toBe(false);
  });

  it('GOLD merge preserves local XAU/USD alongside live VIX', async () => {
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'vix', providerSymbol: 'VIX' } ] }));
    const getQuote = vi.fn(async (id:string) => ({ instrumentId: id, price: 7, timestamp: new Date().toISOString(), isStale: false }));
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const fetched = await mod.fetchMacroSnapshot();
    // simulate local instruments gold
    const local = (await import('./macro-signals')).buildMacroSnapshotFromInstruments([ { symbol: 'XAU/USD', price: 3333, isStale: false } ], new Date().toISOString());
    const merged = Object.assign({}, local, fetched.snapshot);
    expect(merged.gold).toBe(3333);
    expect(merged.vix).toBe(7);
  });

  it('OIL remains undefined when no instrument exists', async () => {
    clearEnv();
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'XAU_USD', providerSymbol: 'XAU/USD' } ] }));
    const getQuote = vi.fn(async () => { throw new Error('should not be called'); });
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const local = mod.buildMacroSnapshotFromInstruments([ { symbol: 'XAU/USD', price: 3000, isStale: false } ], new Date().toISOString());
    expect(local.oil).toBeUndefined();
  });

  it('neutral placeholders for missing DXY/US10Y yield neutral signals with strength 0.4', async () => {
    clearEnv();
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [] }));
    vi.doMock('../market-data', () => ({ default: { getQuote: async ()=>({}) } }));
    const mod = await import('./macro-signals');
    const merged = { generatedAt: new Date().toISOString() } as any;
    const sigs = mod.buildMacroSignals(merged);
    const dxy = sigs.find((s:any)=> s.type === 'DXY');
    const us10y = sigs.find((s:any)=> s.type === 'US10Y');
    expect(dxy!.origin).toBe('MACRO_PLACEHOLDER');
    expect(dxy!.strength).toBe(0.4);
    expect(us10y!.origin).toBe('MACRO_PLACEHOLDER');
    expect(us10y!.strength).toBe(0.4);
  });

  it('fetch called once per enabled indicator', async () => {
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    process.env.PAPER_TRADER_MACRO_DXY_SYMBOL = 'DXY';
    vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'vix', providerSymbol: 'VIX' }, { id: 'dxy', providerSymbol: 'DXY' } ] }));
    const getQuote = vi.fn(async (id:string) => ({ instrumentId: id, price: id === 'vix' ? 5 : 100, timestamp: new Date().toISOString(), isStale: false }));
    vi.doMock('../market-data', () => ({ default: { getQuote } }));
    const mod = await import('./macro-signals');
    const res = await mod.fetchMacroSnapshot();
    expect(getQuote).toHaveBeenCalledTimes(2);
    expect(res.statusByIndicator.vix).toBe('OK');
    expect(res.statusByIndicator.dxy).toBe('OK');
  });
});
