import { expect, it } from 'vitest';
import buildHistoricalContext from './historical-context-engine';

it('positive history -> HISTORICALLY_POSITIVE', ()=>{
  const input = { marketRegime: { regime: 'STRONG_UPTREND' }, marketContextAdvice: { outlook: 'FAVORABLE_LONG' }, completedTradeEvaluations: [ { symbol: 'A', marketRegime: { regime: 'STRONG_UPTREND' }, marketContextAdvice: { outlook: 'FAVORABLE_LONG' }, returnPercent: 2.5 }, { symbol: 'B', marketRegime: { regime: 'STRONG_UPTREND' }, marketContextAdvice: { outlook: 'FAVORABLE_LONG' }, returnPercent: 1.1 } ] };
  const res = buildHistoricalContext(input);
  expect(res.sampleSize).toBe(2);
  expect(res.historicalBias).toBe('HISTORICALLY_POSITIVE');
  expect(res.confidence).toBeGreaterThan(0);
});

it('negative history -> HISTORICALLY_NEGATIVE', ()=>{
  const input = { marketRegime: { regime: 'STRONG_DOWNTREND' }, marketContextAdvice: { outlook: 'FAVORABLE_SHORT' }, completedTradeEvaluations: [ { symbol: 'A', marketRegime: { regime: 'STRONG_DOWNTREND' }, marketContextAdvice: { outlook: 'FAVORABLE_SHORT' }, returnPercent: -3 }, { symbol: 'B', marketRegime: { regime: 'STRONG_DOWNTREND' }, marketContextAdvice: { outlook: 'FAVORABLE_SHORT' }, returnPercent: -1 } ] };
  const res = buildHistoricalContext(input);
  expect(res.historicalBias).toBe('HISTORICALLY_NEGATIVE');
});

it('mixed outcomes -> MIXED', ()=>{
  const input = { marketRegime: { regime: 'RANGE_BOUND' }, marketContextAdvice: { outlook: 'NEUTRAL' }, completedTradeEvaluations: [ { symbol: 'A', marketRegime: { regime: 'RANGE_BOUND' }, marketContextAdvice: { outlook: 'NEUTRAL' }, returnPercent: 2 }, { symbol: 'B', marketRegime: { regime: 'RANGE_BOUND' }, marketContextAdvice: { outlook: 'NEUTRAL' }, returnPercent: -1 } ] };
  const res = buildHistoricalContext(input);
  expect(res.historicalBias).toBe('MIXED');
});

it('insufficient history -> INSUFFICIENT_HISTORY', ()=>{
  const input = { marketRegime: { regime: 'STRONG_UPTREND' }, marketContextAdvice: { outlook: 'FAVORABLE_LONG' }, completedTradeEvaluations: [] };
  const res = buildHistoricalContext(input);
  expect(res.historicalBias).toBe('INSUFFICIENT_HISTORY');
  expect(res.confidence).toBe(0);
});

it('confidence scales with sample size deterministically', ()=>{
  const small = buildHistoricalContext({ marketRegime: { regime: 'X' }, completedTradeEvaluations: [ { returnPercent: 1, marketRegime: { regime: 'X' } } ] });
  const large = buildHistoricalContext({ marketRegime: { regime: 'X' }, completedTradeEvaluations: new Array(6).fill(0).map((_,i)=> ({ returnPercent: 1, marketRegime: { regime: 'X' }, symbol: `S${i}` })) });
  expect(large.confidence).toBeGreaterThanOrEqual(small.confidence);
  const a = buildHistoricalContext({ marketRegime: { regime: 'X' }, completedTradeEvaluations: new Array(3).fill(0).map(()=> ({ returnPercent: 0.1, marketRegime: { regime: 'X' } })) });
  const b = buildHistoricalContext({ marketRegime: { regime: 'X' }, completedTradeEvaluations: new Array(3).fill(0).map(()=> ({ returnPercent: 0.1, marketRegime: { regime: 'X' } })) });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
