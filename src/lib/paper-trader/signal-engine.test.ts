import { describe, it, expect, vi } from 'vitest';
import { evaluateSignal } from './signal-engine';
import * as ScoreMod from './signal-score';

describe('evaluateSignal', () => {
  it('BUY when expectedReturnPercent > 5', () => {
    const res = evaluateSignal({ expectedReturnPercent: 6 });
    expect(res.action).toBe('BUY');
    expect(res.reasons).toContain('EXPECT_GT_5');
  });

  it('SELL when expectedReturnPercent < -5', () => {
    const res = evaluateSignal({ expectedReturnPercent: -6 });
    expect(res.action).toBe('SELL');
    expect(res.reasons).toContain('EXPECT_LT_-5');
  });

  it('HOLD otherwise', () => {
    const res = evaluateSignal({ expectedReturnPercent: 1 });
    expect(res.action).toBe('HOLD');
    expect(res.reasons.length).toBe(0);
  });

  it('confidence follows Signal Score', () => {
    const r1 = evaluateSignal({ expectedReturnPercent: 20 });
    // calculateSignalScore for 20 -> 50 +20 (>5) +20 (>10) = 90
    expect(r1.confidence).toBe(90);

    const r2 = evaluateSignal({ expectedReturnPercent: -0.5 });
    // small expectation leaves score at baseline 50
    expect(r2.confidence).toBe(50);
  });

  it('delegates scoring to calculateSignalScore exactly once', () => {
    const spy = vi.spyOn(ScoreMod, 'calculateSignalScore');
    const res = evaluateSignal({ expectedReturnPercent: 3 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
