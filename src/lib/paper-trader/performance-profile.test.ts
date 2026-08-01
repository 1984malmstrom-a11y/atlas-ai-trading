import { expect, it } from 'vitest';
import { buildPerformanceProfile } from './demo-runtime';

it('empty list returns zero-values', ()=>{
  const out = buildPerformanceProfile([] as any);
  expect(out.totalTrades).toBe(0);
  expect(out.wins).toBe(0);
  expect(out.losses).toBe(0);
  expect(out.neutral).toBe(0);
  expect(out.winRate).toBe(0);
  expect(out.averageConfidence).toBe(0);
  expect(out.confidenceAccuracy).toBe(0);
});

it('mostly winning trades', ()=>{
  const signals = [
    { evaluationResult: 'WIN', confidenceAtExecution: 80, confidenceAccurate: true, lessonCategory: 'CORRECT_DECISION', suggestedConfidenceAdjustment: 0 } ,
    { evaluationResult: 'WIN', confidenceAtExecution: 70, confidenceAccurate: true, lessonCategory: 'CORRECT_DECISION', suggestedConfidenceAdjustment: 0 } ,
    { evaluationResult: 'LOSS', confidenceAtExecution: 60, confidenceAccurate: false, lessonCategory: 'CONFIDENCE_TOO_HIGH', suggestedConfidenceAdjustment: -10 }
  ];
  const out = buildPerformanceProfile(signals as any);
  expect(out.totalTrades).toBe(3);
  expect(out.wins).toBe(2);
  expect(out.losses).toBe(1);
  expect(out.winRate).toBeCloseTo(2/3);
  expect(out.averageConfidence).toBeCloseTo((80+70+60)/3);
});

it('mostly losing trades', ()=>{
  const signals = [
    { evaluationResult: 'LOSS', confidenceAtExecution: 85, confidenceAccurate: false, lessonCategory: 'CONFIDENCE_TOO_HIGH', suggestedConfidenceAdjustment: -10 },
    { evaluationResult: 'LOSS', confidenceAtExecution: 75, confidenceAccurate: false, lessonCategory: 'CONFIDENCE_TOO_HIGH', suggestedConfidenceAdjustment: -10 },
    { evaluationResult: 'WIN', confidenceAtExecution: 55, confidenceAccurate: true, lessonCategory: 'CORRECT_DECISION', suggestedConfidenceAdjustment: 0 }
  ];
  const out = buildPerformanceProfile(signals as any);
  expect(out.totalTrades).toBe(3);
  expect(out.losses).toBe(2);
  expect(out.wins).toBe(1);
  expect(out.winRate).toBeCloseTo(1/3);
  expect(out.recommendedConfidenceBias).toBeLessThan(0);
});

it('mixed outcomes', ()=>{
  const signals = [
    { evaluationResult: 'WIN', confidenceAtExecution: 90, confidenceAccurate: true, lessonCategory: 'CORRECT_DECISION', suggestedRiskAdjustment: 0.02 },
    { evaluationResult: 'LOSS', confidenceAtExecution: 40, confidenceAccurate: false, lessonCategory: 'CONFIDENCE_TOO_LOW', suggestedConfidenceAdjustment: 10 },
    { evaluationResult: 'NEUTRAL', confidenceAtExecution: null, confidenceAccurate: false, lessonCategory: 'NEUTRAL' }
  ];
  const out = buildPerformanceProfile(signals as any);
  expect(out.totalTrades).toBe(3);
  expect(out.wins).toBe(1);
  expect(out.losses).toBe(1);
  expect(out.neutral).toBe(1);
  expect(Object.keys(out.lessonBreakdown).length).toBeGreaterThanOrEqual(2);
});
