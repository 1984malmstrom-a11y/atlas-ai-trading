import { describe, it, expect } from 'vitest';
import { buildFinancialHealthContext } from './financial-health-context';

describe('FinancialHealthContext', ()=>{
  it('returns UNKNOWN when snapshot missing', ()=>{
    const ctx = buildFinancialHealthContext({ symbol: 'ACME', fundamental: null, now: new Date('2025-01-01T00:00:00Z') });
    expect(ctx.assessment).toBe('UNKNOWN');
    expect(ctx.confidence).toBeGreaterThanOrEqual(0);
    expect(ctx.confidence).toBeLessThanOrEqual(1);
  });

  it('rates STRONG for positive metrics', ()=>{
    const snap = { fetchedAt: '2025-01-01T00:00:00Z', revenue: { yearOverYearPercent: 20 }, profitability: { operatingMarginPercent: 25 }, cashFlow: { freeCashFlow: 1000000 }, balance: { netDebt: -500000 }, returns: { roePercent: 25 } };
    const ctx = buildFinancialHealthContext({ symbol: 'ACME', fundamental: { snapshot: snap }, now: new Date('2025-01-01T00:00:00Z') });
    expect(ctx.assessment).toBe('STRONG');
    expect(ctx.score).toBeGreaterThanOrEqual(70);
    expect(ctx.supportingFactors.length).toBeLessThanOrEqual(5);
  });

  it('rates WEAK for poor metrics', ()=>{
    const snap = { fetchedAt: '2025-01-01T00:00:00Z', revenue: { yearOverYearPercent: -10 }, profitability: { operatingMarginPercent: 1 }, cashFlow: { freeCashFlow: -100000 }, balance: { netDebt: 1000000 }, returns: { roePercent: 2 } };
    const ctx = buildFinancialHealthContext({ symbol: 'ACME', fundamental: { snapshot: snap }, now: new Date('2025-01-01T00:00:00Z') });
    expect(['WEAK','MIXED'].includes(ctx.assessment)).toBe(true);
    expect(ctx.conflictingFactors.length).toBeLessThanOrEqual(5);
    expect(ctx.confidence).toBeGreaterThanOrEqual(0);
    expect(ctx.confidence).toBeLessThanOrEqual(1);
  });
});
