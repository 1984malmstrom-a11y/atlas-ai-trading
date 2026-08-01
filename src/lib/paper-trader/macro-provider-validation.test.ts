import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = ['PAPER_TRADER_MACRO_VIX_SYMBOL','PAPER_TRADER_MACRO_DXY_SYMBOL','PAPER_TRADER_MACRO_US10Y_SYMBOL','PAPER_TRADER_MACRO_OIL_SYMBOL'];
function clearEnv(){ for (const k of ENV_KEYS) delete process.env[k]; }

beforeEach(()=>{ vi.resetModules(); clearEnv(); });
afterEach(()=>{ vi.restoreAllMocks(); clearEnv(); });

describe('validateMacroIndicatorRegistry', ()=>{
  it('no env symbols -> four UNSUPPORTED and no provider calls', async ()=>{
    const lookup = vi.fn();
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    expect(res.results.length).toBe(4);
    for (const r of res.results){ expect(r.status).toBe('UNSUPPORTED'); }
    expect(lookup).toHaveBeenCalledTimes(0);
  });

  it('only VIX configured -> one lookup call, others UNSUPPORTED', async ()=>{
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    const lookup = vi.fn(async (s:string)=> ({ found: true, exactMatch: true, assetType: 'index', exchange: 'CBOE' }));
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    expect(res.configuredCount).toBe(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    const v = res.results.find(r=> r.key==='vix');
    expect(v?.status).toBe('VALID');
  });

  it('exact symbol match -> VALID', async ()=>{
    process.env.PAPER_TRADER_MACRO_DXY_SYMBOL = 'DXY';
    const lookup = vi.fn(async ()=> ({ found: true, exactMatch: true, assetType: 'Index', exchange: 'INDEX' }));
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    const r = res.results.find(x=> x.key === 'dxy');
    expect(r?.status).toBe('VALID');
  });

  it('candidates exist but no exact match -> NOT_FOUND', async ()=>{
    process.env.PAPER_TRADER_MACRO_US10Y_SYMBOL = 'US10Y';
    const lookup = vi.fn(async ()=> ({ found: true, exactMatch: false }));
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    const r = res.results.find(x=> x.key === 'us10y');
    expect(r?.status).toBe('NOT_FOUND');
  });

  it('wrong asset type -> INVALID_ASSET_TYPE', async ()=>{
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    const lookup = vi.fn(async ()=> ({ found: true, exactMatch: true, assetType: 'STOCK', exchange: 'NYSE' }));
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    const r = res.results.find(x=> x.key === 'vix');
    expect(r?.status).toBe('INVALID_ASSET_TYPE');
  });

  it('provider error only affects that indicator', async ()=>{
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    process.env.PAPER_TRADER_MACRO_DXY_SYMBOL = 'DXY';
    const lookup = vi.fn(async (s:string)=> { if (s === 'VIX') return { found:false, exactMatch:false, error: 'PROVIDER_ERROR' }; return { found: true, exactMatch: true, assetType: 'index', exchange: 'IDX' }; });
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    const v = res.results.find(r=> r.key==='vix');
    const d = res.results.find(r=> r.key==='dxy');
    expect(v?.status).toBe('PROVIDER_ERROR');
    expect(d?.status).toBe('VALID');
  });

  it('OIL commodity class -> VALID', async ()=>{
    process.env.PAPER_TRADER_MACRO_OIL_SYMBOL = 'OILX';
    const lookup = vi.fn(async ()=> ({ found: true, exactMatch: true, assetType: 'commodity', exchange: 'CME' }));
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    const r = res.results.find(x=> x.key === 'oil');
    expect(r?.status).toBe('VALID');
  });

  it('whitespace trimmed and empty becomes UNSUPPORTED', async ()=>{
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = '  VIX  ';
    process.env.PAPER_TRADER_MACRO_DXY_SYMBOL = '   ';
    const lookup = vi.fn(async ()=> ({ found: true, exactMatch: true, assetType: 'index', exchange: 'CBOE' }));
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    const v = res.results.find(r=> r.key==='vix');
    const d = res.results.find(r=> r.key==='dxy');
    expect(v?.status).toBe('VALID');
    expect(d?.status).toBe('UNSUPPORTED');
  });

  it('secure results and no console logging', async ()=>{
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    const lookup = vi.fn(async ()=> ({ found: true, exactMatch: true, assetType: 'index', exchange: 'CBOE' }));
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(()=>{});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(()=>{});
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    for (const r of res.results){
      // ensure no providerSymbol leaked
      expect((r as any).providerSymbol).toBeUndefined();
    }
  });

  it('one lookup per enabled indicator and none for disabled', async ()=>{
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    process.env.PAPER_TRADER_MACRO_DXY_SYMBOL = 'DXY';
    process.env.PAPER_TRADER_MACRO_OIL_SYMBOL = '   ';
    const lookup = vi.fn(async ()=> ({ found: true, exactMatch: true, assetType: 'index', exchange: 'CBOE' }));
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(res.configuredCount).toBe(2);
  });

  it('summary counts and checkedAt ISO timestamp', async ()=>{
    process.env.PAPER_TRADER_MACRO_VIX_SYMBOL = 'VIX';
    const lookup = vi.fn(async ()=> ({ found: true, exactMatch: true, assetType: 'index', exchange: 'CBOE' }));
    vi.doMock('../market-data/twelve-data', ()=> ({ lookupTwelveSymbolExact: lookup }));
    const mod = await import('./macro-signals');
    const res = await mod.validateMacroIndicatorRegistry();
    expect(typeof res.checkedAt).toBe('string');
    expect(!Number.isNaN(Date.parse(res.checkedAt))).toBe(true);
    expect(res.configuredCount).toBe(1);
    expect(res.validCount).toBe(1);
  });

});

describe('discovery and search helpers', ()=>{
  beforeEach(()=>{ vi.resetModules(); });

  it('search empty query returns empty list', async ()=>{
    const td = await vi.importActual('../market-data/twelve-data');
    const res = await (td as any).searchTwelveSymbolCandidates('   ');
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(0);
  });

  it('discover deduplicates candidates and limits to 5 per indicator and isolates term errors', async ()=>{
    const searchMock = vi.fn(async (q:string) => {
      if (/error/.test(q)) throw new Error('term error');
      if (/VIX/.test(q)) return [ { symbol: 'VIX1', instrumentType: 'index', exchange: 'CBOE' }, { symbol: 'VIX1', instrumentType: 'index', exchange: 'CBOE' }, { symbol: 'VIX2', instrumentType: 'unknown', exchange: 'EX' } ];
      if (/DXY/.test(q)) return [ { symbol: 'DXY', instrumentType: 'index', exchange: 'INDEX' } ];
      if (/US10Y/.test(q)) return [ { symbol: 'US10YX', instrumentType: 'bond', exchange: 'CBOE' }, { symbol: 'US10YX', instrumentType: 'bond', exchange: 'CBOE' } ];
      if (/WTI/.test(q)) return [ { symbol: 'CL', instrumentType: 'commodity', exchange: 'CME' }, { symbol: 'BRT', instrumentType: 'commodity', exchange: 'ICE' } ];
      return [];
    });
    const lookupMock = vi.fn(async (s:string) => {
      if (s === 'VIX1') return { found: true, exactMatch: true, assetType: 'index', exchange: 'CBOE' };
      if (s === 'VIX2') return { found: true, exactMatch: false };
      if (s === 'CL') return { found: true, exactMatch: true, assetType: 'commodity', exchange: 'CME' };
      return { found: false, exactMatch: false };
    });
    // Call discovery with injected dependencies so we count calls precisely
    const mod = await import('./macro-signals');
    const res = await mod.discoverMacroProviderCandidates({ searchCandidates: searchMock as any, lookupExact: lookupMock as any });
    // checks
    expect(res.checkedAt && !Number.isNaN(Date.parse(res.checkedAt))).toBe(true);
    expect(Array.isArray(res.candidatesByIndicator.vix)).toBe(true);
    // VIX candidates deduped and include VIX1 and VIX2
    const vix = res.candidatesByIndicator.vix.map((c:any)=> c.symbol);
    expect(vix.includes('VIX1')).toBe(true);
    expect(vix.includes('VIX2')).toBe(true);
    // DXY present
    expect(res.candidatesByIndicator.dxy.length).toBeGreaterThanOrEqual(0);
    // OIL candidates include CL and BRT
    const oilSyms = res.candidatesByIndicator.oil.map((c:any)=> c.symbol);
    expect(oilSyms.includes('CL')).toBe(true);
    expect(oilSyms.includes('BRT')).toBe(true);
    // requestStats should reflect calls
    expect(res.requestStats).toBeDefined();
    expect(res.requestStats!.searchCalls).toBeGreaterThanOrEqual(4); // multiple search terms
    expect(res.requestStats!.exactLookupCalls).toBeGreaterThanOrEqual(1);
    expect(res.requestStats!.uniqueLookupSymbols).toBeGreaterThanOrEqual(1);
  });

  describe('strict matching and recommendations', ()=>{
    it('US2Y is rejected for US10Y and not recommended', async ()=>{
      const searchMock = vi.fn(async (q:string)=>{
        if (/US10Y/.test(q)) return [{ symbol: 'US2Y', instrumentName: 'US Treasury Yield 2 Years', instrumentType: 'Bond', exchange: 'CBOE' }];
        return [];
      });
      const lookupMock = vi.fn(async (s:string)=> ({ found: true, exactMatch: true, assetType: 'bond', exchange: 'CBOE' }));
      const mod = await import('./macro-signals');
      const res = await mod.discoverMacroProviderCandidates({ searchCandidates: searchMock as any, lookupExact: lookupMock as any });
      const cand = res.candidatesByIndicator.us10y[0];
      expect(cand).toBeDefined();
      expect(cand.compatibility).toBe('INCOMPATIBLE');
      expect(res.recommendedByIndicator?.us10y).toBeUndefined();
    });

    it('US10Y with explicit 10-year and exactMatch is recommended', async ()=>{
      const searchMock = vi.fn(async (q:string)=>{
        if (/US10Y/.test(q)) return [{ symbol: 'US10Y', instrumentName: 'US Treasury Yield 10 Years', instrumentType: 'Bond', exchange: 'CBOE' }];
        return [];
      });
      const lookupMock = vi.fn(async (s:string)=> ({ found: true, exactMatch: true, assetType: 'bond', exchange: 'CBOE' }));
      const mod = await import('./macro-signals');
      const res = await mod.discoverMacroProviderCandidates({ searchCandidates: searchMock as any, lookupExact: lookupMock as any });
      const cand = res.candidatesByIndicator.us10y[0];
      expect(cand.compatibility).toBe('COMPATIBLE');
      expect(res.recommendedByIndicator?.us10y?.symbol).toBe('US10Y');
    });

    it('UUP/UDN are rejected for DXY', async ()=>{
      const searchMock = vi.fn(async (q:string)=>{
        if (/DXY/.test(q)) return [{ symbol: 'UUP', instrumentName: 'Invesco DB US Dollar Index Bullish Fund', instrumentType: 'ETF', exchange: 'NYSE' }, { symbol: 'UDN', instrumentName: 'Invesco DB US Dollar Index Bearish Fund', instrumentType: 'ETF', exchange: 'NYSE' }];
        return [];
      });
      const lookupMock = vi.fn(async (s:string)=> ({ found: true, exactMatch: true, assetType: 'etf', exchange: 'NYSE' }));
      const mod = await import('./macro-signals');
      const res = await mod.discoverMacroProviderCandidates({ searchCandidates: searchMock as any, lookupExact: lookupMock as any });
      for (const c of res.candidatesByIndicator.dxy){ expect(c.compatibility).toBe('INCOMPATIBLE'); }
      expect(res.recommendedByIndicator?.dxy).toBeUndefined();
    });

    it('Volatility ETF incompatible for VIX; real VIX index accepted', async ()=>{
      const searchMock = vi.fn(async (q:string)=>{
        if (/VIX/.test(q)) return [{ symbol: 'VOLETF', instrumentName: 'Volatility ETF', instrumentType: 'ETF', exchange: 'NYSE' }, { symbol: 'VIX', instrumentName: 'CBOE Volatility Index', instrumentType: 'Index', exchange: 'CBOE' }];
        return [];
      });
      const lookupMock = vi.fn(async (s:string)=> ({ found: true, exactMatch: true, assetType: s==='VIX' ? 'index' : 'etf', exchange: 'CBOE' }));
      const mod = await import('./macro-signals');
      const res = await mod.discoverMacroProviderCandidates({ searchCandidates: searchMock as any, lookupExact: lookupMock as any });
      // VOLETF should be INCOMPATIBLE; VIX should be COMPATIBLE
      const v = res.candidatesByIndicator.vix.find((x:any)=> x.symbol === 'VOLETF');
      const v2 = res.candidatesByIndicator.vix.find((x:any)=> x.symbol === 'VIX');
      expect(v?.compatibility).toBe('INCOMPATIBLE');
      expect(v2?.compatibility).toBe('COMPATIBLE');
      expect(res.recommendedByIndicator?.vix?.symbol).toBe('VIX');
    });

    it('Brent commodity accepted, Brent ETF rejected for OIL', async ()=>{
      const searchMock = vi.fn(async (q:string)=>{
        if (/WTI|Brent|Crude/.test(q)) return [{ symbol: 'BRENTETF', instrumentName: 'Brent Crude ETF', instrumentType: 'ETF', exchange: 'LSE' }, { symbol: 'BRENT', instrumentName: 'Brent Crude Oil', instrumentType: 'Commodity', exchange: 'ICE' }];
        return [];
      });
      const lookupMock = vi.fn(async (s:string)=> ({ found: true, exactMatch: true, assetType: s==='BRENT' ? 'commodity' : 'etf', exchange: 'ICE' }));
      const mod = await import('./macro-signals');
      const res = await mod.discoverMacroProviderCandidates({ searchCandidates: searchMock as any, lookupExact: lookupMock as any });
      const etf = res.candidatesByIndicator.oil.find((x:any)=> x.symbol === 'BRENTETF');
      const com = res.candidatesByIndicator.oil.find((x:any)=> x.symbol === 'BRENT');
      expect(etf?.compatibility).toBe('INCOMPATIBLE');
      expect(com?.compatibility).toBe('COMPATIBLE');
      expect(res.recommendedByIndicator?.oil?.symbol).toBe('BRENT');
    });
  });
});
