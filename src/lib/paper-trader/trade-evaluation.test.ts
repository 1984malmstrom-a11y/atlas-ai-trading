import { describe, it, expect } from 'vitest';
import { evaluateTrade } from './trade-evaluation';
import { calculateTradeOutcome } from './trade-outcome';

describe('evaluateTrade', () => {
  it('returns correct pnl for a winning trade', () => {
    const result = evaluateTrade({ entryPrice: 100, exitPrice: 110, quantity: 2 });
    expect(result.pnlSek).toBe(20);
    expect(result.pnlPercent).toBe(10);
    expect(result.winner).toBe(true);
  });

  it('returns correct pnl for a losing trade', () => {
    const result = evaluateTrade({ entryPrice: 100, exitPrice: 90, quantity: 3 });
    expect(result.pnlSek).toBe(-30);
    expect(result.pnlPercent).toBe(-10);
    expect(result.winner).toBe(false);
  });

  it('handles break-even correctly', () => {
    const result = evaluateTrade({ entryPrice: 100, exitPrice: 100, quantity: 5 });
    expect(result.pnlSek).toBe(0);
    expect(result.pnlPercent).toBe(0);
    expect(result.winner).toBe(false);
  });

  it('handles decimal prices accurately', () => {
    const result = evaluateTrade({ entryPrice: 123.45, exitPrice: 128.75, quantity: 10 });
    expect(result.pnlSek).toBeCloseTo(53); // (128.75 - 123.45) * 10 = 53
    expect(result.pnlPercent).toBeCloseTo((128.75 - 123.45) / 123.45 * 100);
    expect(result.winner).toBe(true);
  });

  it('matches calculateTradeOutcome with totalFees:0', () => {
    const input = { entryPrice: 123.45, exitPrice: 128.75, quantity: 10 };
    const a = evaluateTrade(input);
    const b = calculateTradeOutcome({ ...input, totalFees: 0 });
    expect(a).toEqual(b);
  });

  it('is backward-compatible when totalFees omitted and applies fees when provided', () => {
    const base = { entryPrice: 100, exitPrice: 110, quantity: 1 };
    const noFee = evaluateTrade(base);
    const withZero = evaluateTrade({ ...base, totalFees: 0 });
    expect(noFee).toEqual(withZero);

    const withFee = evaluateTrade({ ...base, totalFees: 5 });
    // gross = 10, net = 5
    expect(withFee.pnlSek).toBe(5);
    expect(withFee.winner).toBe(true);
    // pnlPercent uses net / (entry * qty) * 100
    expect(withFee.pnlPercent).toBeCloseTo((5 / (100 * 1)) * 100);
  });

  it('fee can reduce gross to exact break-even and winner=false', () => {
    const res = evaluateTrade({ entryPrice: 50, exitPrice: 60, quantity: 1, totalFees: 10 });
    // gross = 10, fee = 10 -> net = 0
    expect(res.pnlSek).toBe(0);
    expect(res.winner).toBe(false);
  });

  it('throws on negative totalFees', () => {
    expect(() => evaluateTrade({ entryPrice: 100, exitPrice: 110, quantity: 1, totalFees: -1 } as any)).toThrow();
  });
});
