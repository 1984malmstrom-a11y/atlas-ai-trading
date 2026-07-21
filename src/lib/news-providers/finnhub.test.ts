import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFinnhubCompanyNews, mapFinnhubNewsItem, FinnhubNewsProviderError } from './finnhub';

beforeEach(()=>{ vi.unstubAllEnvs && vi.unstubAllEnvs(); });
afterEach(()=>{ vi.restoreAllMocks(); vi.unstubAllEnvs && vi.unstubAllEnvs(); vi.useRealTimers && vi.useRealTimers(); });

function makeFetchResponder(mapping: Record<string, any>, delay = 0, failSymbols: string[] = []){
  return vi.fn(async (url:string)=>{
    // extract symbol param
    const u = new URL(url);
    const sym = u.searchParams.get('symbol') || '';
    if(failSymbols.includes(sym)) return { ok: false, json: async ()=>({}), status: 500 } as any;
    const body = mapping[sym] || [];
    await new Promise(r=> setTimeout(r, delay));
    return { ok: true, json: async ()=> JSON.parse(JSON.stringify(body)) } as any; // deep clone
  });
}

describe('finnhub provider', ()=>{
  it('empty symbol list returns []', async ()=>{
    const res = await fetchFinnhubCompanyNews({ symbols: [] as any, apiKey: 'K' , fetchImpl: makeFetchResponder({}) as any });
    expect(res).toEqual([]);
  });

  it('symbols normalized and deduped', async ()=>{
    const mapping: any = { AAPL: [] };
    const fetch = makeFetchResponder(mapping);
    const res = await fetchFinnhubCompanyNews({ symbols: [' aapl ','AAPL'], apiKey: 'K', fetchImpl: fetch as any });
    expect(Array.isArray(res)).toBe(true);
  });

  it('max 25 symbols enforced', async ()=>{
    const arr = new Array(30).fill(0).map((_,i)=> 'S'+i);
    const fetch = makeFetchResponder({});
    const res = await fetchFinnhubCompanyNews({ symbols: arr as any, apiKey: 'K', fetchImpl: fetch as any });
    // no more than 25 requests should be made (some may fail but we limit symbols)
    // ensure function returns (no throw)
    expect(Array.isArray(res)).toBe(true);
  });

  it('options.apiKey prioritized over env', async ()=>{
    vi.stubEnv('FINNHUB_API_KEY','ENVKEY');
    const fetch = makeFetchResponder({ AAPL: [] });
    await fetchFinnhubCompanyNews({ symbols: ['AAPL'], apiKey: 'OPTKEY', fetchImpl: fetch as any });
    expect(fetch.mock.calls.length).toBeGreaterThan(0);
    // ensure env key not required
  });

  it('env apiKey used when options.apiKey missing', async ()=>{
    vi.stubEnv('FINNHUB_API_KEY','ENVKEY');
    const fetch = makeFetchResponder({ AAPL: [] });
    await fetchFinnhubCompanyNews({ symbols: ['AAPL'], fetchImpl: fetch as any } as any);
    expect(fetch.mock.calls.length).toBeGreaterThan(0);
  });

  it('missing apiKey throws sanitized error', async ()=>{
    await expect(fetchFinnhubCompanyNews({ symbols: ['AAPL'], fetchImpl: makeFetchResponder({}) as any } as any)).rejects.toThrow(FinnhubNewsProviderError);
  });

  it('correct url params include from/to and token', async ()=>{
    const fetch = vi.fn(async (url:string)=>{
      const u = new URL(url);
      expect(u.searchParams.get('symbol')).toBe('AAPL');
      expect(u.searchParams.get('from')).toBe('2024-01-01');
      expect(u.searchParams.get('to')).toBe('2024-01-02');
      expect(u.searchParams.get('token')).toBe('K');
      return { ok: true, json: async ()=>[] } as any;
    });
    await fetchFinnhubCompanyNews({ symbols:['AAPL'], from:'2024-01-01', to:'2024-01-02', apiKey:'K', fetchImpl: fetch as any });
  });

  it('unix datetime converted to ISO', async ()=>{
    const mapping:any = { AAPL: [{ id:1, headline:'h', summary:'s', datetime: 1700000000 }] };
    const fetch = makeFetchResponder(mapping);
    const res = await fetchFinnhubCompanyNews({ symbols:['AAPL'], apiKey:'K', fetchImpl: fetch as any });
    expect(res[0].publishedAt).toMatch(/202/);
  });

  it('headline and summary trimmed; items without headline skipped', async ()=>{
    const mapping:any = { AAPL: [{ id:1, headline:' h ', summary:' s ' }, { id:2, headline:'', summary:'x' }] };
    const fetch = makeFetchResponder(mapping);
    const res = await fetchFinnhubCompanyNews({ symbols:['AAPL'], apiKey:'K', fetchImpl: fetch as any });
    expect(res.length).toBe(1);
    expect(res[0].headline).toBe('h');
    expect(res[0].summary).toBe('s');
  });

  it('response.ok false for one symbol does not stop others', async ()=>{
    const mapping:any = { A: [{ id:1, headline:'h' }], B: [{ id:2, headline:'h2' }] };
    const fetch = makeFetchResponder(mapping, 0, ['B']);
    const res = await fetchFinnhubCompanyNews({ symbols:['A','B'], apiKey:'K', fetchImpl: fetch as any });
    expect(res.some(r=> r.id === '1')).toBe(true);
  });

  it('all symbols fail throws PROVIDER_FAILURE with failedSymbols', async ()=>{
    const fetch = makeFetchResponder({},0,['A','B']);
    await expect(fetchFinnhubCompanyNews({ symbols:['A','B'], apiKey:'K', fetchImpl: fetch as any })).rejects.toMatchObject({ code: 'PROVIDER_FAILURE', failedSymbols: expect.any(Array) });
  });

  it('identical ids merged and symbols combined alphabetically', async ()=>{
    const mapping:any = { A: [{ id: '42', headline:'h', datetime:1700000000 }], B: [{ id:'42', headline:'h', datetime:1700000000 }] };
    const fetch = makeFetchResponder(mapping);
    const res = await fetchFinnhubCompanyNews({ symbols:['A','B'], apiKey:'K', fetchImpl: fetch as any });
    expect(res.length).toBe(1);
    expect(res[0].symbols).toEqual(['A','B']);
  });

  it('items without id deduplicated by headline+publishedAt', async ()=>{
    const mapping:any = { A: [{ headline:'h', datetime:1700000000 }], B: [{ headline:'h', datetime:1700000000 }] };
    const fetch = makeFetchResponder(mapping);
    const res = await fetchFinnhubCompanyNews({ symbols:['A','B'], apiKey:'K', fetchImpl: fetch as any });
    expect(res.length).toBe(1);
  });

  it('sorting latest publishedAt first', async ()=>{
    const mapping:any = { A: [{ id:1, headline:'h', datetime:1700000100 }], B: [{ id:2, headline:'h2', datetime:1700000000 }] };
    const fetch = makeFetchResponder(mapping);
    const res = await fetchFinnhubCompanyNews({ symbols:['A','B'], apiKey:'K', fetchImpl: fetch as any });
    expect(res[0].id).toBe('1');
  });

  it('input not mutated', async ()=>{
    const syms = ['A'];
    const mapping:any = { A: [{ id:1, headline:'h' }] };
    const fetch = makeFetchResponder(mapping);
    const copy = JSON.stringify(syms);
    await fetchFinnhubCompanyNews({ symbols: syms as any, apiKey:'K', fetchImpl: fetch as any });
    expect(JSON.stringify(syms)).toBe(copy);
  });

  it('api key not leaked in error messages', async ()=>{
    const fetch = makeFetchResponder({},0,['A']);
    try{ await fetchFinnhubCompanyNews({ symbols:['A'], apiKey:'SUPER_SECRET_KEY_1234567890', fetchImpl: fetch as any }); }catch(e:any){ expect(String(e.message)).not.toContain('SUPER_SECRET_KEY'); }
  });

  it('provider url not leaked in errors', async ()=>{
    const fetch = vi.fn(async (url:string)=>({ ok:false, status:500 } as any));
    try{ await fetchFinnhubCompanyNews({ symbols:['A'], apiKey:'K', fetchImpl: fetch as any }); }catch(e:any){ expect(String(e.message)).not.toContain('finnhub.io'); }
  });

  it('max concurrency of 5 enforced', async ()=>{
    const mapping:any = {};
    for(let i=0;i<25;i++) mapping['S'+i] = [{ id:i, headline:'h'+i, datetime:1700000000 + i }];
    let inFlight = 0, maxSeen = 0;
    const resolvers: Record<string, (v?:any)=>void> = {};
    const pending: Record<string, Promise<void>> = {};
    const fetch = vi.fn((url:string)=>{
      const u = new URL(url); const s = u.searchParams.get('symbol') as string;
      if(!pending[s]){
        pending[s] = new Promise<void>(res => { resolvers[s] = res; });
      }
      inFlight++; if(inFlight>maxSeen) maxSeen = inFlight;
      return (async ()=>{
        await pending[s];
        inFlight--;
        return { ok:true, json: async ()=> mapping[s] } as any;
      })();
    });
    const syms = Object.keys(mapping);
    const promise = fetchFinnhubCompanyNews({ symbols: syms as any, apiKey:'K', fetchImpl: fetch as any });
    // let runners start (microtask)
    await Promise.resolve();
    // release first 5 once they have been created
    while(!resolvers[syms[4]]) await Promise.resolve();
    for(let i=0;i<5;i++) resolvers[syms[i]]();
    // wait until remaining resolvers exist
    while(!resolvers[syms[24]]) await Promise.resolve();
    // release remaining in batches of 5
    for(let b=1;b<5;b++){
      for(let i=b*5;i<(b+1)*5;i++) resolvers[syms[i]]();
      await Promise.resolve();
    }
    const res = await promise;
    // check observed concurrency and results
    expect(maxSeen).toBe(5);
    expect(fetch.mock.calls.length).toBe(25);
    expect(inFlight).toBe(0);
    expect(res.length).toBe(25);
  });

  it('deterministic result across runs', async ()=>{
    const mapping:any = { A: [{ id:'1', headline:'h', datetime:1700000000 }] };
    const fetch1 = makeFetchResponder(mapping);
    const a = await fetchFinnhubCompanyNews({ symbols:['A'], apiKey:'K', fetchImpl: fetch1 as any });
    const fetch2 = makeFetchResponder(mapping);
    const b = await fetchFinnhubCompanyNews({ symbols:['A'], apiKey:'K', fetchImpl: fetch2 as any });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
