import { describe, it, expect } from 'vitest';
import { buildTradeReview } from './trade-review-builder';
import { calculateTradeOutcome } from './trade-outcome';

describe('buildTradeReview', () => {
  const args = {
    executionId: 'exec_1',
    symbol: 'AAA',
    entryPrice: 10,
    exitPrice: 12,
    quantity: 100,
    totalFees: 5,
    holdingMinutes: 60,
    confidenceAtEntry: 0.5,
    createdAt: '2026-07-26T12:00:00.000Z',
  };

  it('bygger korrekt review', () => {
    const r = buildTradeReview(args);
    expect(r.executionId).toBe(args.executionId);
    expect(r.symbol).toBe(args.symbol);
    expect(r.entryPrice).toBe(args.entryPrice);
    expect(r.exitPrice).toBe(args.exitPrice);
    expect(r.quantity).toBe(args.quantity);
    expect(r.totalFees).toBe(args.totalFees);
    expect(r.holdingMinutes).toBe(args.holdingMinutes);
    expect(r.confidenceAtEntry).toBe(args.confidenceAtEntry);
    expect(r.createdAt).toBe(args.createdAt);
  });

  it('pnlSek kommer från calculateTradeOutcome', () => {
    const outcome = calculateTradeOutcome({
      entryPrice: args.entryPrice,
      exitPrice: args.exitPrice,
      quantity: args.quantity,
      totalFees: args.totalFees,
    });
    const r = buildTradeReview(args);
    expect(r.pnlSek).toBe(outcome.pnlSek);
  });

  it('pnlPercent kommer från calculateTradeOutcome', () => {
    const outcome = calculateTradeOutcome({
      entryPrice: args.entryPrice,
      exitPrice: args.exitPrice,
      quantity: args.quantity,
      totalFees: args.totalFees,
    });
    const r = buildTradeReview(args);
    expect(r.pnlPercent).toBe(outcome.pnlPercent);
  });

  it('winner kommer från calculateTradeOutcome', () => {
    const outcome = calculateTradeOutcome({
      entryPrice: args.entryPrice,
      exitPrice: args.exitPrice,
      quantity: args.quantity,
      totalFees: args.totalFees,
    });
    const r = buildTradeReview(args);
    expect(r.winner).toBe(outcome.winner);
  });

  it('immutable objekt returneras', () => {
    const r = buildTradeReview(args);
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('fel från createTradeReview propagaterar', () => {
    const bad = { ...args, executionId: '' };
    const badArg = bad as unknown as Parameters<typeof buildTradeReview>[0];
    expect(() => buildTradeReview(badArg)).toThrow();
  });
});
