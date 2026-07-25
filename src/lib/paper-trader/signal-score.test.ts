import { describe, it, expect } from 'vitest';
import { calculateSignalScore } from './signal-score';

describe('calculateSignalScore', () => {
  it('BUY condition increases score', () => {
    const r = calculateSignalScore({ expectedReturnPercent: 12 });
    // 50 +20 (>5) +20 (>10) => 90
    expect(r.score).toBe(90);
    expect(r.reasons).toContain('EXPECT_GT_5');
    expect(r.reasons).toContain('EXPECT_GT_10');
  });

  it('SELL condition decreases score', () => {
    const r = calculateSignalScore({ expectedReturnPercent: -12 });
    // 50 -20 (<-5) -20 (<-10) => 10
    expect(r.score).toBe(10);
    expect(r.reasons).toContain('EXPECT_LT_-5');
    expect(r.reasons).toContain('EXPECT_LT_-10');
  });

  it('HOLD around zero change', () => {
    const r = calculateSignalScore({ expectedReturnPercent: 2 });
    expect(r.score).toBe(50);
    expect(r.reasons.length).toBe(0);
  });

  it('clamps score to 0-100', () => {
    const r1 = calculateSignalScore({ expectedReturnPercent: 100 });
    expect(r1.score).toBe(100);
    const r2 = calculateSignalScore({ expectedReturnPercent: -100 });
    expect(r2.score).toBe(0);
  });
});
