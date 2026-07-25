import { describe, it, expect } from 'vitest';
import { calculateDrawdown } from './drawdown';

describe('calculateDrawdown', () => {
  it('no drawdown', () => {
    const res = calculateDrawdown({ currentPortfolioValue: 1000, peakPortfolioValue: 1000 });
    expect(res.drawdownPercent).toBeCloseTo(0);
    expect(res.isDrawdownWarning).toBe(false);
    expect(res.isDrawdownCritical).toBe(false);
  });

  it('5 percent drawdown', () => {
    const res = calculateDrawdown({ currentPortfolioValue: 950, peakPortfolioValue: 1000 });
    expect(res.drawdownPercent).toBeCloseTo(5);
    expect(res.isDrawdownWarning).toBe(false);
    expect(res.isDrawdownCritical).toBe(false);
  });

  it('15 percent drawdown', () => {
    const res = calculateDrawdown({ currentPortfolioValue: 850, peakPortfolioValue: 1000 });
    expect(res.drawdownPercent).toBeCloseTo(15);
    expect(res.isDrawdownWarning).toBe(true);
    expect(res.isDrawdownCritical).toBe(false);
  });

  it('25 percent drawdown', () => {
    const res = calculateDrawdown({ currentPortfolioValue: 750, peakPortfolioValue: 1000 });
    expect(res.drawdownPercent).toBeCloseTo(25);
    expect(res.isDrawdownWarning).toBe(true);
    expect(res.isDrawdownCritical).toBe(true);
  });
});
