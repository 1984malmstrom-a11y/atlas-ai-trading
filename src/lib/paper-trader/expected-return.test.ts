import { describe, it, expect } from 'vitest';
import { estimateExpectedReturn } from './expected-return';

describe('estimateExpectedReturn V1', () => {
  it('momentum 8 and confidence 100 => 8', () => {
    const r = estimateExpectedReturn({ momentumPercent: 8, confidence: 100 });
    expect(r).not.toBeNull();
    expect(r!.expectedReturnPercent).toBeCloseTo(8);
  });

  it('momentum 8 and confidence 50 => 4', () => {
    const r = estimateExpectedReturn({ momentumPercent: 8, confidence: 50 });
    expect(r).not.toBeNull();
    expect(r!.expectedReturnPercent).toBeCloseTo(4);
  });

  it('momentum -10 and confidence 80 => -8', () => {
    const r = estimateExpectedReturn({ momentumPercent: -10, confidence: 80 });
    expect(r).not.toBeNull();
    expect(r!.expectedReturnPercent).toBeCloseTo(-8);
  });

  it('momentum 0 always yields 0', () => {
    const r = estimateExpectedReturn({ momentumPercent: 0, confidence: 50 });
    expect(r).not.toBeNull();
    expect(r!.expectedReturnPercent).toBeCloseTo(0);
  });

  it('extreme positive clamps to +20 and negative clamps to -20', () => {
    const rPos = estimateExpectedReturn({ momentumPercent: 100, confidence: 100 });
    const rNeg = estimateExpectedReturn({ momentumPercent: -100, confidence: 100 });
    expect(rPos).not.toBeNull(); expect(rPos!.expectedReturnPercent).toBeCloseTo(20);
    expect(rNeg).not.toBeNull(); expect(rNeg!.expectedReturnPercent).toBeCloseTo(-20);
  });

  it('NaN or Infinity inputs return null', () => {
    expect(estimateExpectedReturn({ momentumPercent: NaN, confidence: 50 })).toBeNull();
    expect(estimateExpectedReturn({ momentumPercent: 5, confidence: Infinity })).toBeNull();
  });
});
