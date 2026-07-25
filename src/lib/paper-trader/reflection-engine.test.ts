import { describe, it, expect } from 'vitest';
import { evaluatePerformanceReflection } from './reflection-engine';
import type { PerformanceSummary } from './types';

describe('evaluatePerformanceReflection', () => {
  it('returns INSUFFICIENT_DATA for few trades', () => {
    const s: PerformanceSummary = { totalTrades: 5, winningTrades: 2, losingTrades: 2, breakEvenTrades: 1, winRatePercent: 40, totalPnlSek: 10, averagePnlSek: 2, averageWinnerSek: 5, averageLoserSek: -3, profitFactor: null, expectancySek: 2 };
    const r = evaluatePerformanceReflection(s);
    expect(r.status).toBe('INSUFFICIENT_DATA');
    expect(r.confidenceMultiplier).toBe(1);
    expect(r.reasons).toContain('TOO_FEW_TRADES');
  });

  it('returns POSITIVE for good expectancy and profit factor', () => {
    const s: PerformanceSummary = { totalTrades: 20, winningTrades: 12, losingTrades: 6, breakEvenTrades: 2, winRatePercent: 60, totalPnlSek: 2000, averagePnlSek: 100, averageWinnerSek: 200, averageLoserSek: -50, profitFactor: 1.5, expectancySek: 100 };
    const r = evaluatePerformanceReflection(s);
    expect(r.status).toBe('POSITIVE');
    expect(r.confidenceMultiplier).toBe(1);
    expect(r.reasons).toContain('EXPECTANCY_POSITIVE');
    expect(r.reasons).toContain('PROFIT_FACTOR_GOOD');
  });

  it('returns NEGATIVE for poor performance', () => {
    const s: PerformanceSummary = { totalTrades: 30, winningTrades: 10, losingTrades: 18, breakEvenTrades: 2, winRatePercent: 33.33, totalPnlSek: -300, averagePnlSek: -10, averageWinnerSek: 50, averageLoserSek: -30, profitFactor: 0.5, expectancySek: -10 };
    const r = evaluatePerformanceReflection(s);
    expect(r.status).toBe('NEGATIVE');
    expect(r.confidenceMultiplier).toBe(0.5);
    expect(r.reasons).toEqual(expect.arrayContaining(['EXPECTANCY_NEGATIVE','PROFIT_FACTOR_POOR']));
  });

  it('returns NEUTRAL for mixed results', () => {
    const s: PerformanceSummary = { totalTrades: 15, winningTrades: 7, losingTrades: 6, breakEvenTrades: 2, winRatePercent: 46.66, totalPnlSek: 10, averagePnlSek: 0.66, averageWinnerSek: 50, averageLoserSek: -48, profitFactor: null, expectancySek: 0.66 };
    const r = evaluatePerformanceReflection(s);
    expect(r.status).toBe('NEUTRAL');
    expect(r.confidenceMultiplier).toBe(0.75);
    expect(r.reasons).toContain('MIXED_RESULTS');
  });
});
