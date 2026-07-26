import { describe, it, expect } from 'vitest';
import { createTradeReview, type TradeReview } from './trade-review';

describe('createTradeReview', () => {
  const valid: TradeReview = {
    executionId: 'exec_1',
    symbol: 'AAA',
    entryPrice: 10,
    exitPrice: 12,
    quantity: 100,
    totalFees: 5,
    pnlSek: 195,
    pnlPercent: 19.5,
    winner: true,
    holdingMinutes: 60,
    confidenceAtEntry: 0.8,
    createdAt: '2026-07-26T12:00:00.000Z',
  };

  it('valid object', () => {
    const r = createTradeReview(valid);
    expect(r).toEqual(valid);
  });

  it('immutable', () => {
    const r = createTradeReview(valid);
    expect(Object.isFrozen(r)).toBe(true);
    // attempt mutation should not change value
    try { (r as any).symbol = 'BBB'; } catch (e) {}
    expect(r.symbol).toBe('AAA');
  });

  it('empty executionId throws', () => {
    const bad = { ...valid, executionId: ' ' };
    expect(() => createTradeReview(bad as any)).toThrow();
  });

  it('empty symbol throws', () => {
    const bad = { ...valid, symbol: '' };
    expect(() => createTradeReview(bad as any)).toThrow();
  });

  it('negative holdingMinutes throws', () => {
    const bad = { ...valid, holdingMinutes: -1 };
    expect(() => createTradeReview(bad as any)).toThrow();
  });

  it('empty createdAt throws', () => {
    const bad = { ...valid, createdAt: ' ' };
    expect(() => createTradeReview(bad as any)).toThrow();
  });
});
