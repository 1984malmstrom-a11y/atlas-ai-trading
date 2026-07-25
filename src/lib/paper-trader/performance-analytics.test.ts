import { describe, it, expect } from 'vitest';
import { calculatePerformance } from './performance-analytics';
import type { TradeEvaluation } from './types';

describe('calculatePerformance', () => {
  it('returns zeros and null for empty list', () => {
    const res = calculatePerformance([]);
    expect(res.totalTrades).toBe(0);
    expect(res.winningTrades).toBe(0);
    expect(res.losingTrades).toBe(0);
    expect(res.breakEvenTrades).toBe(0);
    expect(res.winRatePercent).toBe(0);
    expect(res.totalPnlSek).toBe(0);
    expect(res.averagePnlSek).toBe(0);
    expect(res.averageWinnerSek).toBe(0);
    expect(res.averageLoserSek).toBe(0);
    expect(res.profitFactor).toBeNull();
    expect(res.expectancySek).toBe(0);
  });

  it('computes mixed wins, losses and break-even correctly', () => {
    const evals: TradeEvaluation[] = [
      { pnlSek: 100, pnlPercent: 10, winner: true },
      { pnlSek: -50, pnlPercent: -5, winner: false },
      { pnlSek: 0, pnlPercent: 0, winner: false },
    ];
    const res = calculatePerformance(evals);
    expect(res.totalTrades).toBe(3);
    expect(res.winningTrades).toBe(1);
    expect(res.losingTrades).toBe(1);
    expect(res.breakEvenTrades).toBe(1);
    expect(res.winRatePercent).toBeCloseTo(33.333333, 4);
    expect(res.totalPnlSek).toBe(50);
    expect(res.averagePnlSek).toBeCloseTo(50/3);
    expect(res.averageWinnerSek).toBe(100);
    expect(res.averageLoserSek).toBe(-50);
    expect(res.profitFactor).toBeCloseTo(100 / 50);
    expect(res.expectancySek).toBeCloseTo(50/3);
  });

  it('computes only winners correctly and profitFactor null', () => {
    const evals: TradeEvaluation[] = [
      { pnlSek: 10, pnlPercent: 1, winner: true },
      { pnlSek: 20, pnlPercent: 2, winner: true },
      { pnlSek: 30, pnlPercent: 3, winner: true },
    ];
    const res = calculatePerformance(evals);
    expect(res.totalTrades).toBe(3);
    expect(res.winningTrades).toBe(3);
    expect(res.losingTrades).toBe(0);
    expect(res.breakEvenTrades).toBe(0);
    expect(res.winRatePercent).toBe(100);
    expect(res.totalPnlSek).toBe(60);
    expect(res.averagePnlSek).toBeCloseTo(20);
    expect(res.averageWinnerSek).toBeCloseTo(20);
    expect(res.averageLoserSek).toBe(0);
    expect(res.profitFactor).toBeNull();
    expect(res.expectancySek).toBeCloseTo(20);
  });

  it('includes break-even trades properly', () => {
    const evals: TradeEvaluation[] = [
      { pnlSek: 0, pnlPercent: 0, winner: false },
      { pnlSek: 50, pnlPercent: 5, winner: true },
      { pnlSek: -25, pnlPercent: -2.5, winner: false },
    ];
    const res = calculatePerformance(evals);
    expect(res.totalTrades).toBe(3);
    expect(res.breakEvenTrades).toBe(1);
    expect(res.winningTrades).toBe(1);
    expect(res.losingTrades).toBe(1);
    expect(res.totalPnlSek).toBe(25);
    expect(res.profitFactor).toBeCloseTo(50 / 25);
  });
});
