import { expect, it } from 'vitest';
import { buildVictorReview } from './demo-runtime';

it('no trades produces neutral review', ()=>{
  const ds = { cycleId: 'c1', timestamp: '2026-07-29T00:00:00Z', analyzedSymbols: [], eligibleSymbols: [], skippedSymbols: [], decisions: [], executedTrades: [], rejectedTradesCount: 0, overallConclusion: 'NO_ACTION' } as any;
  const out = buildVictorReview(ds, [], [], [], { totalTrades: 0, winRate: 0, averageConfidence: 0, confidenceAccuracy: 0 });
  expect(out.cycleId).toBe('c1');
  expect(out.readinessScore).toBeGreaterThanOrEqual(0);
  expect(out.strengths.length + out.weaknesses.length).toBeGreaterThanOrEqual(0);
});

it('winning cycle yields strengths and high readiness', ()=>{
  const ds = { cycleId: 'c2', timestamp: '2026-07-29T01:00:00Z' } as any;
  const ls = [
    { tradeId: 't1', evaluationResult: 'WIN', confidenceAtExecution: 80, confidenceAccurate: true, lessonCategory: 'CORRECT_DECISION' },
    { tradeId: 't2', evaluationResult: 'WIN', confidenceAtExecution: 75, confidenceAccurate: true, lessonCategory: 'CORRECT_DECISION' }
  ];
  const pf = { totalTrades: 2, winRate: 1, averageConfidence: 77.5, confidenceAccuracy: 1, recommendedConfidenceBias: 0, recommendedRiskBias: 0 };
  const out = buildVictorReview(ds, [], [], ls as any, pf as any);
  expect(out.strengths).toContain('High win rate');
  expect(out.readinessScore).toBeGreaterThan(70);
});

it('losing cycle yields weaknesses and low readiness', ()=>{
  const ds = { cycleId: 'c3', timestamp: '2026-07-29T02:00:00Z' } as any;
  const ls = [
    { tradeId: 't1', evaluationResult: 'LOSS', confidenceAtExecution: 85, confidenceAccurate: false, lessonCategory: 'CONFIDENCE_TOO_HIGH', suggestedConfidenceAdjustment: -10 },
    { tradeId: 't2', evaluationResult: 'LOSS', confidenceAtExecution: 78, confidenceAccurate: false, lessonCategory: 'CONFIDENCE_TOO_HIGH', suggestedConfidenceAdjustment: -10 }
  ];
  const pf = { totalTrades: 2, winRate: 0, averageConfidence: 81.5, confidenceAccuracy: 0, recommendedConfidenceBias: -10, recommendedRiskBias: -0.1 };
  const out = buildVictorReview(ds, [], [], ls as any, pf as any);
  expect(out.weaknesses).toContain('Low win rate');
  expect(out.suggestedFocusAreas).toContain('Adjust confidence bias incrementally and monitor');
  expect(out.readinessScore).toBeLessThan(50);
});

it('mixed cycle produces balanced review', ()=>{
  const ds = { cycleId: 'c4', timestamp: '2026-07-29T03:00:00Z' } as any;
  const ls = [
    { tradeId: 't1', evaluationResult: 'WIN', confidenceAtExecution: 90, confidenceAccurate: true, lessonCategory: 'CORRECT_DECISION' },
    { tradeId: 't2', evaluationResult: 'LOSS', confidenceAtExecution: 40, confidenceAccurate: false, lessonCategory: 'CONFIDENCE_TOO_LOW', suggestedConfidenceAdjustment: 10 }
  ];
  const pf = { totalTrades: 2, winRate: 0.5, averageConfidence: 65, confidenceAccuracy: 0.5, recommendedConfidenceBias: 0, recommendedRiskBias: 0 };
  const out = buildVictorReview(ds, [], [], ls as any, pf as any);
  expect(out.suggestedFocusAreas.length).toBeGreaterThanOrEqual(1);
  expect(out.readinessScore).toBeGreaterThanOrEqual(30);
});
