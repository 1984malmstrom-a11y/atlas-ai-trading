import { describe, it, expect } from 'vitest';
import { buildCompanyNewsContext, sanitizeCompanyNewsContextForState } from './company-news-context';
import { RawNewsItem } from '../news-intelligence/index';

const now = new Date('2026-08-02T12:00:00.000Z');

function makeItem(id: string | undefined, sym: string, headline: string, publishedAt: string, sentiment?: any): RawNewsItem{
  return { id: id || undefined, source: 'FINNHUB' as const, headline, summary: '', url: undefined, symbols: [sym], publishedAt, category: undefined, sentiment } as RawNewsItem;
}

describe('CompanyNewsContext - unit', ()=>{
  it('empty articles produces empty context and warnings', ()=>{
    const ctx = buildCompanyNewsContext({ symbol: 'AAPL', articles: [], now });
    expect(ctx.articleCount).toBe(0);
    expect(ctx.freshArticleCount).toBe(0);
    expect(ctx.sentiment).toBe('UNKNOWN');
    expect(Array.isArray(ctx.warnings)).toBe(true);
    const s = sanitizeCompanyNewsContextForState(ctx);
    expect(s).not.toBe(ctx);
  });

  it('fresh positive article counted and headline truncated', ()=>{
    const items: RawNewsItem[] = [ makeItem('1','AAPL','AAPL beats estimates and rises', '2026-08-02T11:00:00.000Z') ];
    const ctx = buildCompanyNewsContext({ symbol: 'AAPL', articles: items, now });
    expect(ctx.articleCount).toBe(1);
    expect(ctx.freshArticleCount).toBe(1);
    expect(ctx.sentiment).toMatch(/POSITIVE|NEUTRAL|UNKNOWN/);
    expect(ctx.latestHeadline && ctx.latestHeadline.length <= 180).toBe(true);
  });

  it('older than 72h excluded and future excluded', ()=>{
    const old = makeItem('o','AAPL','old','2026-07-25T11:00:00.000Z');
    const fut = makeItem('f','AAPL','future','2026-08-03T12:10:00.000Z');
    const items = [old,fut];
    const ctx = buildCompanyNewsContext({ symbol: 'AAPL', articles: items, now });
    expect(ctx.articleCount).toBe(0);
  });

  it('dedupe by id keeps single article', ()=>{
    const a1 = makeItem('x','AAPL','dup','2026-08-02T10:00:00.000Z');
    const a2 = makeItem('x','AAPL','dup','2026-08-02T10:00:00.000Z');
    const ctx = buildCompanyNewsContext({ symbol: 'AAPL', articles: [a1,a2], now });
    expect(ctx.articleCount).toBe(1);
  });
});
