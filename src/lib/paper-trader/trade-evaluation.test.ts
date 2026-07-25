import { describe, it, expect } from 'vitest';
import { evaluateTrade } from './trade-evaluation';

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
});
