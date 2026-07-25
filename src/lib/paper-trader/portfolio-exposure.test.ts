import { describe, it, expect } from 'vitest';
import { calculatePortfolioExposure } from './portfolio-exposure';

describe('calculatePortfolioExposure', () => {
  it('empty portfolio', () => {
    const res = calculatePortfolioExposure({ availableCash: 0, totalValue: 0 });
    expect(res.largestHoldingPercent).toBe(0);
    expect(res.totalInvestedPercent).toBe(0);
    expect(res.cashPercent).toBe(0);
  });

  it('one holding', () => {
    const res = calculatePortfolioExposure({ availableCash: 0, totalValue: 1000, holdings: [{ symbol: 'A', quantity: 10, currentPrice: 50 }] });
    // marketValue = 500, largest = 500
    expect(res.largestHoldingPercent).toBeCloseTo(0.5);
    expect(res.totalInvestedPercent).toBeCloseTo(0.5);
    expect(res.cashPercent).toBeCloseTo(0);
  });

  it('multiple holdings', () => {
    const res = calculatePortfolioExposure({ availableCash: 0, totalValue: 1000, holdings: [
      { symbol: 'A', quantity: 0, marketValue: 300 },
      { symbol: 'B', quantity: 0, marketValue: 200 },
      { symbol: 'C', quantity: 0, marketValue: 100 }
    ]});
    expect(res.largestHoldingPercent).toBeCloseTo(0.3);
    expect(res.totalInvestedPercent).toBeCloseTo(0.6);
    expect(res.cashPercent).toBeCloseTo(0);
  });

  it('mixed cash and holdings', () => {
    const res = calculatePortfolioExposure({ availableCash: 400, totalValue: 1000, holdings: [ { symbol: 'A', quantity: 0, marketValue: 300 } ] });
    expect(res.largestHoldingPercent).toBeCloseTo(0.3);
    expect(res.totalInvestedPercent).toBeCloseTo(0.3);
    expect(res.cashPercent).toBeCloseTo(0.4);
  });
});
