import { describe, it, expect } from 'vitest';
import { calculateTradeOutcome } from './trade-outcome';

describe('calculateTradeOutcome', () => {
  it('profit case', () => {
    const out = calculateTradeOutcome({ entryPrice: 100, exitPrice: 110, quantity: 2, totalFees: 5 });
    // gross = (110-100)*2 = 20, net = 15
    expect(out.pnlSek).toBe(15);
    expect(out.pnlPercent).toBe((15 / (100 * 2)) * 100);
    expect(out.winner).toBe(true);
  });

  it('loss case', () => {
    const out = calculateTradeOutcome({ entryPrice: 100, exitPrice: 90, quantity: 1, totalFees: 0 });
    // gross = -10, net = -10
    expect(out.pnlSek).toBe(-10);
    expect(out.pnlPercent).toBe((-10 / (100 * 1)) * 100);
    expect(out.winner).toBe(false);
  });

  it('break-even with fees (net == 0)', () => {
    const out = calculateTradeOutcome({ entryPrice: 100, exitPrice: 101, quantity: 1, totalFees: 1 });
    // gross = 1, net = 0
    expect(out.pnlSek).toBe(0);
    expect(out.pnlPercent).toBe(0);
    expect(out.winner).toBe(false);
  });

  it('throws on entryPrice=0', () => {
    expect(() => calculateTradeOutcome({ entryPrice: 0, exitPrice: 100, quantity: 1, totalFees: 0 })).toThrow();
  });

  it('throws on exitPrice=0', () => {
    expect(() => calculateTradeOutcome({ entryPrice: 100, exitPrice: 0, quantity: 1, totalFees: 0 })).toThrow();
  });

  it('throws on quantity=0', () => {
    expect(() => calculateTradeOutcome({ entryPrice: 100, exitPrice: 110, quantity: 0, totalFees: 0 })).toThrow();
  });

  it('throws on negative fees', () => {
    expect(() => calculateTradeOutcome({ entryPrice: 100, exitPrice: 110, quantity: 1, totalFees: -1 })).toThrow();
  });
});
