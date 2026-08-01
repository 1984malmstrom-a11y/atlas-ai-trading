import { expect, it } from 'vitest';
import { generateLearningSignal } from './demo-runtime';

it('generates CONFIDENCE_TOO_HIGH when loss and high confidence', ()=>{
  const outcome = { tradeId: 't1', evaluationResult: 'LOSS', expectedDirectionCorrect: false, confidenceAccurate: false } as any;
  const tf = { tradeId: 't1', symbol: 'NVDA', confidenceAtExecution: 80, decisionReasons: [] } as any;
  const sig = generateLearningSignal(outcome, tf);
  expect(sig.tradeId).toBe('t1');
  expect(sig.lessonCategory).toBe('CONFIDENCE_TOO_HIGH');
  expect(sig.suggestedConfidenceAdjustment).toBeLessThan(0);
});

it('generates CONFIDENCE_TOO_LOW when win and low confidence', ()=>{
  const outcome = { tradeId: 't2', evaluationResult: 'WIN', expectedDirectionCorrect: true, confidenceAccurate: true } as any;
  const tf = { tradeId: 't2', symbol: 'MSFT', confidenceAtExecution: 40, decisionReasons: [] } as any;
  const sig = generateLearningSignal(outcome, tf);
  expect(sig.lessonCategory).toBe('CONFIDENCE_TOO_LOW');
  expect(sig.suggestedConfidenceAdjustment).toBeGreaterThan(0);
});

it('generates RISK_TOO_AGGRESSIVE when risk warnings and loss', ()=>{
  const outcome = { tradeId: 't3', evaluationResult: 'LOSS', expectedDirectionCorrect: false, confidenceAccurate: false } as any;
  const tf = { tradeId: 't3', symbol: 'AAPL', confidenceAtExecution: 60, decisionReasons: [{ symbol: 'AAPL', riskWarnings: ['concentration'] }] } as any;
  const sig = generateLearningSignal(outcome, tf);
  expect(sig.lessonCategory).toBe('RISK_TOO_AGGRESSIVE');
  expect(sig.suggestedRiskAdjustment).toBeLessThan(0);
});
