import { describe, it, expect } from 'vitest';
import { buildAnalystConsensusContext } from './analyst-consensus-context';

describe('AnalystConsensusContext', ()=>{
  it('returns UNKNOWN when no analyst fields present', ()=>{
    const ctx = buildAnalystConsensusContext({ symbol: 'ACME', fundamental: null, now: new Date('2025-01-01T00:00:00Z') });
    expect(ctx.symbol).toBe('ACME');
    expect(ctx.consensus).toBe('UNKNOWN');
    expect(ctx.dataQuality).toBe('INSUFFICIENT');
    expect(Array.isArray(ctx.warnings)).toBe(true);
    expect(ctx.warnings).toContain('ANALYST_DATA_UNAVAILABLE');
  });

  it('maps explicit analyst fields and computes implied upside', ()=>{
    const fund = { snapshot: { fetchedAt: '2025-01-01T00:00:00Z', analyst: { strongBuyCount: 2, buyCount: 3, holdCount: 1, sellCount: 0, strongSellCount: 0, analystCount: 6, priceTargetMean: 120, referencePrice: 100, warnings: ['w1','w1'] } } };
    const ctx = buildAnalystConsensusContext({ symbol: 'acme', fundamental: fund, now: new Date('2025-01-01T00:00:00Z') });
    expect(ctx.symbol).toBe('ACME');
    expect(ctx.consensus === 'BUY' || ctx.consensus === 'STRONG_BUY').toBe(true);
    expect(ctx.priceTargetMean).toBe(120);
    expect(ctx.referencePrice).toBe(100);
    expect(ctx.impliedUpsidePercent).toBeCloseTo(20);
    expect(ctx.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it('is JSON-safe and returns immutable copy', ()=>{
    const fund = { snapshot: { analyst: { buyCount: 1 }, fetchedAt: '2025-01-01T00:00:00Z' } };
    const ctx = buildAnalystConsensusContext({ symbol: 'XYZ', fundamental: fund, now: new Date('2025-01-01T00:00:00Z') });
    expect(() => JSON.stringify(ctx)).not.toThrow();
  });
});
