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
    // We will mock calculateSignalScore to return explicit scores so we can test
    // directional confidence mapping independent of signal-score implementation.
    const spy = vi.spyOn(ScoreMod, 'calculateSignalScore');
    spy.mockReturnValueOnce({ score: 90, reasons: ['X'] } as any);
    const r1 = evaluateSignal({ expectedReturnPercent: 20 });
    // score 90 -> BUY -> confidence 90
    expect(r1.action).toBe('BUY');
    expect(r1.confidence).toBe(90);

    spy.mockReturnValueOnce({ score: 75, reasons: ['X'] } as any);
    const r2 = evaluateSignal({ expectedReturnPercent: 10 });
    // score 75 -> BUY -> confidence 75
    expect(r2.action).toBe('BUY');
    expect(r2.confidence).toBe(75);

    spy.mockReturnValueOnce({ score: 25, reasons: ['X'] } as any);
    const r3 = evaluateSignal({ expectedReturnPercent: -10 });
    // score 25 -> SELL -> confidence 75 (100-25)
    expect(r3.action).toBe('SELL');
    expect(r3.confidence).toBe(75);

    spy.mockReturnValueOnce({ score: 10, reasons: ['X'] } as any);
    const r4 = evaluateSignal({ expectedReturnPercent: -20 });
    // score 10 -> SELL -> confidence 90 (100-10)
    expect(r4.action).toBe('SELL');
    expect(r4.confidence).toBe(90);

    spy.mockReturnValueOnce({ score: 50, reasons: [] } as any);
    const r5 = evaluateSignal({ expectedReturnPercent: 0 });
    // score 50 -> HOLD, confidence should not be a high directional value
    expect(r5.action).toBe('HOLD');
    expect(r5.confidence).toBeGreaterThanOrEqual(0);
    expect(r5.confidence).toBeLessThanOrEqual(50);
    spy.mockRestore();
  });

  it('delegates scoring to calculateSignalScore exactly once', () => {
    const spy = vi.spyOn(ScoreMod, 'calculateSignalScore');
    const res = evaluateSignal({ expectedReturnPercent: 3 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
