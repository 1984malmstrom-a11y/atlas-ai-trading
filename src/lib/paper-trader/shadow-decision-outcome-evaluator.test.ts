import { expect, it } from 'vitest';
import evaluateShadowDecisionOutcome from './shadow-decision-outcome-evaluator';

it('BUY correct after price increase', ()=>{
  const r = evaluateShadowDecisionOutcome({ actualAction: 'BUY', shadowAction: 'BUY', referencePrice: 100, evaluationPrice: 106, neutralThresholdPercent: 5 });
  expect(r.actualOutcome).toBe('CORRECT');
  expect(r.shadowOutcome).toBe('CORRECT');
});

it('BUY incorrect after price decrease', ()=>{
  const r = evaluateShadowDecisionOutcome({ actualAction: 'BUY', shadowAction: 'BUY', referencePrice: 100, evaluationPrice: 90, neutralThresholdPercent: 5 });
  expect(r.actualOutcome).toBe('INCORRECT');
});

it('SELL correct after price decrease', ()=>{
  const r = evaluateShadowDecisionOutcome({ actualAction: 'SELL', shadowAction: 'SELL', referencePrice: 100, evaluationPrice: 94, neutralThresholdPercent: 5 });
  expect(r.actualOutcome).toBe('CORRECT');
});

it('SELL incorrect after price increase', ()=>{
  const r = evaluateShadowDecisionOutcome({ actualAction: 'SELL', shadowAction: 'SELL', referencePrice: 100, evaluationPrice: 106, neutralThresholdPercent: 5 });
  expect(r.actualOutcome).toBe('INCORRECT');
});

it('HOLD correct inside neutral threshold', ()=>{
  const r = evaluateShadowDecisionOutcome({ actualAction: 'HOLD', shadowAction: 'HOLD', referencePrice: 100, evaluationPrice: 104, neutralThresholdPercent: 5 });
  expect(r.actualOutcome).toBe('CORRECT');
});

it('HOLD incorrect outside neutral threshold', ()=>{
  const r = evaluateShadowDecisionOutcome({ actualAction: 'HOLD', shadowAction: 'HOLD', referencePrice: 100, evaluationPrice: 110, neutralThresholdPercent: 5 });
  expect(r.actualOutcome).toBe('INCORRECT');
});

it('shadow better than actual', ()=>{
  // actual BUY (incorrect), shadow SELL (correct) => shadow better
  const r = evaluateShadowDecisionOutcome({ actualAction: 'BUY', shadowAction: 'SELL', referencePrice: 100, evaluationPrice: 95, neutralThresholdPercent: 1 });
  expect(r.actualOutcome).toBe('INCORRECT');
  expect(r.shadowOutcome).toBe('CORRECT');
  expect(r.comparison).toBe('SHADOW_BETTER');
});

it('actual better than shadow', ()=>{
  // actual BUY correct, shadow SELL incorrect -> actual better
  const r = evaluateShadowDecisionOutcome({ actualAction: 'BUY', shadowAction: 'SELL', referencePrice: 100, evaluationPrice: 103, neutralThresholdPercent: 1 });
  expect(r.actualOutcome).toBe('CORRECT');
  expect(r.shadowOutcome).toBe('INCORRECT');
  expect(r.comparison).toBe('ACTUAL_BETTER');
});

it('equal decisions/outcomes', ()=>{
  const r = evaluateShadowDecisionOutcome({ actualAction: 'BUY', shadowAction: 'BUY', referencePrice: 100, evaluationPrice: 106, neutralThresholdPercent: 5 });
  expect(r.actualScore).toBe(r.shadowScore);
  expect(r.comparison).toBe('EQUAL');
});

it('invalid prices', ()=>{
  const r = evaluateShadowDecisionOutcome({ actualAction: 'BUY', shadowAction: 'BUY', referencePrice: 0, evaluationPrice: NaN, neutralThresholdPercent: 5 });
  expect(r.actualOutcome).toBe('NOT_EVALUABLE');
  expect(r.shadowOutcome).toBe('NOT_EVALUABLE');
  expect(r.comparison).toBe('NOT_EVALUABLE');
});

it('threshold clamping', ()=>{
  const r = evaluateShadowDecisionOutcome({ actualAction: 'HOLD', shadowAction: 'HOLD', referencePrice: 100, evaluationPrice: 109, neutralThresholdPercent: 50 });
  // threshold is clamped to 10, so HOLD with 9% return is CORRECT
  expect(r.actualOutcome).toBe('CORRECT');
});

it('deterministic output', ()=>{
  const a = evaluateShadowDecisionOutcome({ actualAction: 'BUY', shadowAction: 'HOLD', referencePrice: 100, evaluationPrice: 103, neutralThresholdPercent: 2 });
  const b = evaluateShadowDecisionOutcome({ actualAction: 'BUY', shadowAction: 'HOLD', referencePrice: 100, evaluationPrice: 103, neutralThresholdPercent: 2 });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
