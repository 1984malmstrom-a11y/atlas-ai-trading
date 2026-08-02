import { describe, it, expect } from 'vitest';
import { createPerCycleCompanyNewsResolver } from './company-news-context';

describe('CompanyNewsContext - runtime resolver', ()=>{
  it('one fetch per symbol per cycle and ISO behavior', async ()=>{
    const calls: string[] = [];
    const fetcher = async ({ symbol }: { symbol: string })=>{
      calls.push(symbol);
      // return a single fresh article
      return [{ id: '1', source: 'FINNHUB' as const, headline: `${symbol} news`, summary: '', url: undefined, symbols: [symbol], publishedAt: new Date().toISOString(), category: undefined, sentiment: 'POSITIVE' } as any];
    };
    const resolver = createPerCycleCompanyNewsResolver({ fetchCompanyNews: fetcher });
    const p1 = resolver.resolve({ symbol: 'NVDA', analyzed: true });
    const p2 = resolver.resolve({ symbol: 'NVDA', analyzed: true });
    const r1 = await p1; const r2 = await p2;
    expect(r1).not.toBeNull(); expect(r2).not.toBeNull();
    expect(calls.filter(c=> c === 'NVDA').length).toBe(1);
    // new resolver -> new cycle -> new fetch
    const resolver2 = createPerCycleCompanyNewsResolver({ fetchCompanyNews: fetcher });
    await resolver2.resolve({ symbol: 'NVDA', analyzed: true });
    expect(calls.filter(c=> c === 'NVDA').length).toBe(2);
  });
});
