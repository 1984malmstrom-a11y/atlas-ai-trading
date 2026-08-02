import { describe, it, expect } from 'vitest';
import { buildExternalFundamentalContext } from './external-fundamental-context';

describe('ExternalFundamentalContext runtime integration', ()=>{
  it('builds combined context and summary (analyst+health)', async ()=>{
    const mockFund = { snapshot: { fetchedAt: '2025-01-01T00:00:00Z', analyst: { buyCount: 2, strongBuyCount: 1, priceTargetMean: 150, referencePrice: 100, warnings: ['a'] }, revenue: { yearOverYearPercent: 10 }, profitability: { operatingMarginPercent: 20 }, cashFlow: { freeCashFlow: 50000 }, balance: { netDebt: -10000 }, returns: { roePercent: 15 } } };
    const ctx = await buildExternalFundamentalContext({ symbol: 'ACME', fetchFundamental: async ()=> mockFund, now: new Date('2025-01-01T00:00:00Z') });
    expect(ctx.symbol).toBe('ACME');
    expect(Array.isArray((ctx as any).summary)).toBe(true);
    expect(((ctx as any).summary).length).toBeGreaterThan(0);
    expect(((ctx as any).warnings).length).toBeGreaterThanOrEqual(0);
    // sanitized and JSON-safe
    expect(() => JSON.stringify(ctx)).not.toThrow();
  });

  it('handles missing analyst gracefully', async ()=>{
    const mockFund = { snapshot: { fetchedAt: '2025-01-01T00:00:00Z', revenue: { yearOverYearPercent: 5 } } };
    const ctx = await buildExternalFundamentalContext({ symbol: 'FOO', fetchFundamental: async ()=> mockFund, now: new Date('2025-01-01T00:00:00Z') });
    expect(ctx.symbol).toBe('FOO');
    expect(Array.isArray((ctx as any).summary)).toBe(true);
    expect(((ctx as any).summary).some((s:string)=> s.includes('Otillräcklig') || s.includes('Analytiker'))).toBeTruthy();
  });
});
