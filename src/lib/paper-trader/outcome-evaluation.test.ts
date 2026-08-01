import { expect, it } from 'vitest';
import { evaluateTradeOutcome } from './demo-runtime';

it('computes outcome evaluation for a BUY correctly when price goes up', ()=>{
  const tf = { tradeId: 't1', executedPrice: 100, executedAt: '2026-07-28T00:00:00.000Z', expectedDirection: 'BUY', confidenceAtExecution: 80 } as any;
  const res = evaluateTradeOutcome(tf, 110);
  expect(res.tradeId).toBe('t1');
  expect(res.evaluatedAt).toBeTruthy();
  expect(res.currentPrice).toBe(110);
  expect(typeof res.priceChangePercent).toBe('number');
  expect(res.priceChangePercent).toBeCloseTo(10, 0);
  expect(res.evaluationResult).toBe('WIN');
  expect(res.expectedDirectionCorrect).toBe(true);
  expect(res.confidenceAccurate).toBe(true);
});

it('computes outcome evaluation for a SELL correctly when price falls', ()=>{
  const tf = { tradeId: 't2', executedPrice: 200, expectedDirection: 'SELL', confidenceAtExecution: 60 } as any;
  const res = evaluateTradeOutcome(tf, 190);
  expect(res.evaluationResult).toBe('WIN');
  expect(res.expectedDirectionCorrect).toBe(true);
});

it('returns NEUTRAL when executedPrice missing', ()=>{
  const tf = { tradeId: 't3', expectedDirection: 'BUY', confidenceAtExecution: 50 } as any;
  const res = evaluateTradeOutcome(tf, 150);
  expect(res.evaluationResult).toBe('NEUTRAL');
  expect(res.priceChangePercent).toBeNull();
});
