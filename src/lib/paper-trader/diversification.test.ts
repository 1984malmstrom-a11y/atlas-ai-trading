import { describe, it, expect } from 'vitest';
import { calculateDiversification } from './diversification';

describe('calculateDiversification', () => {
  it('single holding', () => {
    const res = calculateDiversification({ availableCash: 0, totalValue: 1000, holdings: [{ symbol: 'A', quantity: 10, currentPrice: 100 }] });
    expect(res.holdingCount).toBe(1);
    // largest holding = 1000 -> 100% -> concentrationScore = 0
    expect(res.concentrationScore).toBeCloseTo(0);
    expect(res.isConcentrated).toBe(true);
  });

  it('five equal holdings', () => {
    const each = 200;
    const res = calculateDiversification({ availableCash: 0, totalValue: 1000, holdings: [
      { symbol: 'A', marketValue: each, quantity: 0 },
      { symbol: 'B', marketValue: each, quantity: 0 },
      { symbol: 'C', marketValue: each, quantity: 0 },
      { symbol: 'D', marketValue: each, quantity: 0 },
      { symbol: 'E', marketValue: each, quantity: 0 }
    ]});
    expect(res.holdingCount).toBe(5);
    // largest = 200/1000 = 20% -> concentrationScore = 100 - 20 = 80
    expect(res.concentrationScore).toBeCloseTo(80);
    expect(res.isConcentrated).toBe(false);
  });

  it('concentrated portfolio', () => {
    const res = calculateDiversification({ availableCash: 0, totalValue: 1000, holdings: [
      { symbol: 'A', marketValue: 400, quantity: 0 },
      { symbol: 'B', marketValue: 100, quantity: 0 }
    ]});
    expect(res.holdingCount).toBe(2);
    // largest = 400/1000 = 40% -> concentrationScore = 60
    expect(res.concentrationScore).toBeCloseTo(60);
    expect(res.isConcentrated).toBe(true);
  });

  it('well diversified', () => {
    const res = calculateDiversification({ availableCash: 100, totalValue: 1000, holdings: [
      { symbol: 'A', marketValue: 100, quantity: 0 },
      { symbol: 'B', marketValue: 150, quantity: 0 },
      { symbol: 'C', marketValue: 150, quantity: 0 }
    ]});
    expect(res.holdingCount).toBe(3);
    // largest = 150/1000 = 15% -> concentrationScore = 85
    expect(res.concentrationScore).toBeCloseTo(85);
    expect(res.isConcentrated).toBe(false);
  });
});
