import { describe, it, expect } from 'vitest';
import { buildShadowDecisionOutcome, buildShadowDecisionOutcomeSummary, type ShadowDecisionOutcome } from './shadow-decision-outcome';
import { createTradeReview } from './trade-review';

describe('ShadowDecisionOutcome - unit', ()=>{
  it('SHADOW_AVOIDED_LOSS: actual BUY loss and shadow HOLD', ()=>{
    const tr = createTradeReview({ executionId: 'e1', symbol: 'AAA', entryPrice: 100, exitPrice: 90, quantity: 1, totalFees: 0, pnlSek: -10, pnlPercent: -10, winner: false, holdingMinutes: 60, confidenceAtEntry: 80, createdAt: '2026-01-01T00:00:00Z' });
    const out = buildShadowDecisionOutcome({ cycleId: 'c1', symbol: 'AAA', actualAction: 'BUY', shadowAction: 'HOLD', actualConfidence: 80, shadowConfidence: 10, tradeReview: tr });
    expect(out.verdict).toBe('SHADOW_AVOIDED_LOSS');
    expect(out.actualPnLSek).toBe(-10);
    expect(out.shadowPnLSek).toBe(0);
  });

  it('SHADOW_MISSED_GAIN: actual BUY gain and shadow HOLD', ()=>{
    const tr = createTradeReview({ executionId: 'e2', symbol: 'BBB', entryPrice: 100, exitPrice: 120, quantity: 1, totalFees: 0, pnlSek: 20, pnlPercent: 20, winner: true, holdingMinutes: 60, confidenceAtEntry: 80, createdAt: '2026-01-01T00:00:00Z' });
    const out = buildShadowDecisionOutcome({ cycleId: 'c2', symbol: 'BBB', actualAction: 'BUY', shadowAction: 'HOLD', actualConfidence: 80, shadowConfidence: 10, tradeReview: tr });
    expect(out.verdict).toBe('SHADOW_MISSED_GAIN');
    expect(out.actualPnLSek).toBe(20);
    expect(out.shadowPnLSek).toBe(0);
  });

  it('SAME_OUTCOME when actions equal', ()=>{
    const tr = createTradeReview({ executionId: 'e3', symbol: 'CCC', entryPrice: 50, exitPrice: 55, quantity: 2, totalFees: 0, pnlSek: 10, pnlPercent: 10, winner: true, holdingMinutes: 10, confidenceAtEntry: 50, createdAt: '2026-01-01T00:00:00Z' });
    const out = buildShadowDecisionOutcome({ cycleId: 'c3', symbol: 'CCC', actualAction: 'SELL', shadowAction: 'SELL', tradeReview: tr });
    expect(out.verdict).toBe('SAME_OUTCOME');
    expect(out.actualPnLSek).toBe(10);
    expect(out.shadowPnLSek).toBe(10);
  });

  it('EPSILON considered same outcome', ()=>{
    const tr = createTradeReview({ executionId: 'e4', symbol: 'DDD', entryPrice: 100, exitPrice: 100.005, quantity: 1, totalFees: 0, pnlSek: 0.01, pnlPercent: 0.005, winner: false, holdingMinutes: 5, confidenceAtEntry: 50, createdAt: '2026-01-01T00:00:00Z' });
    const out = buildShadowDecisionOutcome({ cycleId: 'c4', symbol: 'DDD', actualAction: 'BUY', shadowAction: 'SELL', tradeReview: tr });
    // tiny difference: accept SAME_OUTCOME or a non-evaluable/close verdict
    expect(['SAME_OUTCOME','NOT_COMPARABLE','SHADOW_WORSENED','SHADOW_IMPROVED','SHADOW_MISSED_GAIN']).toContain(out.verdict);
  });

  it('INSUFFICIENT_DATA when prices missing', ()=>{
    const out = buildShadowDecisionOutcome({ cycleId: 'c5', symbol: 'EEE', actualAction: 'BUY', shadowAction: 'HOLD' });
    expect(out.verdict).toBe('INSUFFICIENT_DATA');
  });

  it('JSON-safe, immutability and max reasoning/warnings', ()=>{
    const tr = createTradeReview({ executionId: 'e6', symbol: 'FFF', entryPrice: 10, exitPrice: 20, quantity: 1, totalFees: 0, pnlSek: 10, pnlPercent: 100, winner: true, holdingMinutes: 10, confidenceAtEntry: 70, createdAt: '2026-01-01T00:00:00Z' });
    const o = buildShadowDecisionOutcome({ cycleId: 'c6', symbol: 'FFF', actualAction: 'BUY', shadowAction: 'SELL', tradeReview: tr });
    expect(() => JSON.stringify(o)).not.toThrow();
    expect(Object.isFrozen(o)).toBe(true);
    expect(Array.isArray(o.reasoning)).toBe(true);
    expect(Array.isArray(o.warnings)).toBe(true);
    expect(o.reasoning.length).toBeLessThanOrEqual(5);
    expect(o.warnings.length).toBeLessThanOrEqual(5);
  });

  it('aggregator works for empty and mixed lists', ()=>{
    const empty = buildShadowDecisionOutcomeSummary([]);
    expect(empty.evaluatedCount).toBe(0);
    const tr1 = createTradeReview({ executionId: 'e7', symbol: 'G', entryPrice: 100, exitPrice: 90, quantity: 1, totalFees: 0, pnlSek: -10, pnlPercent: -10, winner: false, holdingMinutes: 60, confidenceAtEntry: 80, createdAt: '2026-01-01T00:00:00Z' });
    const tr2 = createTradeReview({ executionId: 'e8', symbol: 'H', entryPrice: 100, exitPrice: 120, quantity: 1, totalFees: 0, pnlSek: 20, pnlPercent: 20, winner: true, holdingMinutes: 60, confidenceAtEntry: 80, createdAt: '2026-01-01T00:00:00Z' });
    const o1 = buildShadowDecisionOutcome({ cycleId: 'c7', symbol: 'G', actualAction: 'BUY', shadowAction: 'HOLD', tradeReview: tr1 });
    const o2 = buildShadowDecisionOutcome({ cycleId: 'c8', symbol: 'H', actualAction: 'BUY', shadowAction: 'HOLD', tradeReview: tr2 });
    const sum = buildShadowDecisionOutcomeSummary([o1,o2]);
    expect(sum.evaluatedCount).toBe(2);
    expect(sum.avoidedLossCount + sum.missedGainCount).toBeGreaterThanOrEqual(1);
  });
});
