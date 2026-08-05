import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import { TRADABLE_INSTRUMENTS } from './instruments';
import svcModule from './quotes-service';
const { getNormalizedQuotes } = svcModule as any;

describe('quotes-service scope & fallback (focused)', () => {
  it('getNormalizedQuotes without options requests full enabled registry', async () => {
    const enabled = TRADABLE_INSTRUMENTS.filter(i => i.marketDataEnabled === true || (i.marketDataEnabled === undefined && i.enabled === true)).map(i => i.id);
    const calls: string[] = [];
    const provider = {
      getQuotes: vi.fn(async (ids: string[]) => { calls.push(...ids); return []; }),
      getQuote: vi.fn(async (id: string) => ({ instrumentId: id, symbol: id.toUpperCase(), price: 1, timestamp: new Date().toISOString() })),
    } as any;

    await getNormalizedQuotes(provider, undefined);
    // the first call to provider.getQuotes should include at least all enabled ids
    expect(provider.getQuotes).toHaveBeenCalled();
    const calledWith = (provider.getQuotes as any).mock.calls[0][0] as string[];
    expect(new Set(calledWith)).toEqual(new Set(enabled));
  });

  it('explicit instrumentIds limits provider request and dedups ids', async () => {
    const requested = ['spy','qqq','nvidia','EUR_USD'];
    const expectedNormalized = ['spy','qqq','nvidia','EUR_USD'];
    const provider = {
      getQuotes: vi.fn(async (ids: string[]) => {
        // return a quote for each requested id to simulate provider success
        return ids.map(id => ({ instrumentId: id, symbol: String(id).toUpperCase(), price: 1, timestamp: new Date().toISOString() }));
      }),
      getQuote: vi.fn(async (id: string) => ({ instrumentId: id, symbol: id.toUpperCase(), price: 1, timestamp: new Date().toISOString() })),
    } as any;

    const res = await getNormalizedQuotes(provider, { instrumentIds: requested });
    expect(provider.getQuotes).toHaveBeenCalledTimes(1);
    const calledWith = (provider.getQuotes as any).mock.calls[0][0] as string[];
    // exact set equality (deduped)
    expect(new Set(calledWith)).toEqual(new Set(expectedNormalized));
    // ensure no NO_DATA errors point to instruments outside the requested set (allow FX extras)
    const allowedExtras = new Set(['usd-sek','eur-sek']);
    for (const e of res.errors || []){
      if (e && e.code === 'NO_DATA'){
        expect(new Set([...expectedNormalized, ...Array.from(allowedExtras)]).has(String(e.instrumentId))).toBeTruthy();
      }
    }
    // returned quotes should be subset of requested + allowed FX
    const quoteIds = (res.quotes || []).map((q:any)=> String(q.instrumentId));
    for (const qid of quoteIds){ expect(new Set([...expectedNormalized, ...Array.from(allowedExtras)]).has(qid)).toBeTruthy(); }
  });

  it('limited fallback attempts at most maxFallbacks per-id calls when provider.getQuotes fails', async () => {
    const ids = ['nvidia','microsoft','apple','amazon'];
    const provider = {
      getQuotes: vi.fn(async (idsRequested: string[]) => { throw new Error('batch fail'); }),
      getQuote: vi.fn(async (id: string) => ({ instrumentId: id, symbol: id.toUpperCase(), price: 1, timestamp: new Date().toISOString() })),
    } as any;

    const res = await getNormalizedQuotes(provider, { instrumentIds: ids, fallbackStrategy: 'limited', maxFallbacks: 2 });
    // provider.getQuote should be called at most 2 times
    expect((provider.getQuote as any).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('none fallback performs no per-id attempts when batch fails', async () => {
    const ids = ['nvidia','microsoft','apple'];
    const provider = {
      getQuotes: vi.fn(async () => { throw new Error('bad'); }),
      getQuote: vi.fn(async (id: string) => ({ instrumentId: id })),
    } as any;

    await getNormalizedQuotes(provider, { instrumentIds: ids, fallbackStrategy: 'none' });
    expect((provider.getQuote as any).mock.calls.length).toEqual(0);
  });

  it('full fallback attempts per-id for all ids when batch fails', async () => {
    const ids = ['nvidia','microsoft','apple'];
    const provider = {
      getQuotes: vi.fn(async () => { throw new Error('bad'); }),
      getQuote: vi.fn(async (id: string) => ({ instrumentId: id })),
    } as any;

    await getNormalizedQuotes(provider, { instrumentIds: ids, fallbackStrategy: 'full' });
    expect((provider.getQuote as any).mock.calls.length).toEqual(ids.length);
  });

  it('quotes-service file does not import demo-runtime or portfolio-service', () => {
    const p = require('path').join(process.cwd(), 'src', 'lib', 'market-data', 'quotes-service.ts');
    const src = fs.readFileSync(p, 'utf8');
    expect(src.includes('../paper-trader/demo-runtime')).toBe(false);
    expect(src.includes('../../domain/portfolio/portfolio-service')).toBe(false);
  });
});
