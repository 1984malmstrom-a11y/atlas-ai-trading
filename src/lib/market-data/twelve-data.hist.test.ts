import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TwelveDataMarketDataProvider } from './twelve-data';

describe('TwelveData historical parser + cache', ()=>{
  beforeEach(()=>{ vi.resetModules(); process.env.TWELVE_DATA_API_KEY = 'testkey'; });

  it('parses closes/dates and numeric-string volumes, returns volumes when fully present', async ()=>{
    const days = 25;
    const base = new Date('2026-07-24T00:00:00.000Z');
    const values: any[] = [];
    for (let i=0;i<days;i++){
      const d = new Date(base.getTime() - i * 24*3600*1000);
      const date = d.toISOString().slice(0,10);
      values.push({ datetime: date + 'T00:00:00Z', close: String(100 + i), volume: String(1000 + i) });
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async ()=> ({ values }) } as any);
    const provider = new TwelveDataMarketDataProvider();
    const out = await provider.getHistoricalDailyCloses('MSFT', 25);
    expect(Array.isArray(out.closes)).toBe(true);
    expect(Array.isArray(out.dates)).toBe(true);
    expect(Array.isArray((out as any).volumes)).toBe(true);
    expect((out as any).volumes.length).toBe(out.closes.length);
    expect(typeof (out as any).volumes[0]).toBe('number');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('omits volumes when some rows missing volume; keeps closes/dates', async ()=>{
    const days = 25;
    const base = new Date('2026-07-24T00:00:00.000Z');
    const values: any[] = [];
    for (let i=0;i<days;i++){
      const d = new Date(base.getTime() - i * 24*3600*1000);
      const date = d.toISOString().slice(0,10);
      if (i % 5 === 0) values.push({ datetime: date + 'T00:00:00Z', close: String(200 + i) });
      else values.push({ datetime: date + 'T00:00:00Z', close: String(200 + i), volume: String(500 + i) });
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async ()=> ({ values }) } as any);
    const provider = new TwelveDataMarketDataProvider();
    const out = await provider.getHistoricalDailyCloses('MSFT', 25);
    expect(Array.isArray(out.closes)).toBe(true);
    expect(Array.isArray(out.dates)).toBe(true);
    expect((out as any).volumes === undefined).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent requests and calls provider only once per key', async ()=>{
    const days = 25;
    const base = new Date('2026-07-24T00:00:00.000Z');
    const values: any[] = [];
    for (let i=0;i<days;i++){ const d = new Date(base.getTime() - i * 24*3600*1000); const date = d.toISOString().slice(0,10); values.push({ datetime: date + 'T00:00:00Z', close: String(300 + i), volume: String(800 + i) }); }
    let resolveFetch: any; const fetchPromise = new Promise((res)=>{ resolveFetch = res; });
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockImplementation(()=> Promise.resolve({ ok: true, status: 200, json: async ()=> ({ values }) } as any));
    const provider = new TwelveDataMarketDataProvider();
    // call twice concurrently
    const [a,b] = await Promise.all([ provider.getHistoricalDailyCloses('MSFT', 25), provider.getHistoricalDailyCloses('MSFT', 25) ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.closes.length).toBeGreaterThan(0);
    expect(b.closes.length).toBeGreaterThan(0);
  });
});
