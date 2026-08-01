import { expect, it } from 'vitest';
import buildDecisionEvidence from './evidence-aggregator';

it('strongly bullish evidence', ()=>{
  const res = buildDecisionEvidence({ decisionReason: { action: 'BUY', confidence: 85 }, marketRegime: { regime: 'STRONG_UPTREND', confidence: 80 }, marketContextAdvice: { outlook: 'FAVORABLE_LONG', confidence: 75 }, historicalContext: { historicalBias: 'HISTORICALLY_POSITIVE', confidence: 60, sampleSize: 5 }, adaptiveDecisionContext: { confidenceBias: 2 }, decisionConfidenceExplanation: { overallAssessment: 'HIGH_CONFIDENCE', explanationScore: 82 } });
  expect(res.bullishEvidence.length).toBeGreaterThan(0);
  expect(res.evidenceScore).toBeGreaterThanOrEqual(70);
  expect(res.evidenceQuality).toBe('HIGH');
});

it('strongly bearish evidence', ()=>{
  const res = buildDecisionEvidence({ decisionReason: { action: 'SELL', confidence: 80 }, marketRegime: { regime: 'STRONG_DOWNTREND', confidence: 78 }, marketContextAdvice: { outlook: 'FAVORABLE_SHORT', confidence: 75 }, historicalContext: { historicalBias: 'HISTORICALLY_NEGATIVE', confidence: 60, sampleSize: 4 }, adaptiveDecisionContext: { confidenceBias: -3 }, decisionConfidenceExplanation: { overallAssessment: 'HIGH_CONFIDENCE', explanationScore: 80 } });
  expect(res.bearishEvidence.length).toBeGreaterThan(0);
  expect(res.evidenceScore).toBeLessThanOrEqual(100);
  expect(res.evidenceQuality).toBe('HIGH');
});

it('mixed evidence', ()=>{
  const res = buildDecisionEvidence({ decisionReason: { action: 'BUY', confidence: 60 }, marketRegime: { regime: 'STRONG_DOWNTREND', confidence: 80 }, marketContextAdvice: { outlook: 'FAVORABLE_SHORT', confidence: 80 }, historicalContext: { historicalBias: 'MIXED', confidence: 40, sampleSize: 3 }, adaptiveDecisionContext: { confidenceBias: 0 }, decisionConfidenceExplanation: { overallAssessment: 'MEDIUM_CONFIDENCE', explanationScore: 45 } });
  expect(res.bullishEvidence.length + res.bearishEvidence.length).toBeGreaterThan(0);
  expect(['MEDIUM','LOW','HIGH']).toContain(res.evidenceQuality);
});

it('insufficient historical evidence reduces quality', ()=>{
  const res = buildDecisionEvidence({ decisionReason: { action: 'BUY', confidence: 70 }, marketRegime: { regime: 'STRONG_UPTREND', confidence: 70 }, marketContextAdvice: { outlook: 'FAVORABLE_LONG', confidence: 70 }, historicalContext: { historicalBias: 'INSUFFICIENT_HISTORY', confidence: 0, sampleSize: 0 }, adaptiveDecisionContext: { confidenceBias: 0 }, decisionConfidenceExplanation: { overallAssessment: 'MEDIUM_CONFIDENCE', explanationScore: 60 } });
  expect(res.uncertaintyFactors).toContain('History:insufficient');
  expect(res.evidenceScore).toBeLessThanOrEqual(70);
});

it('high volatility uncertainty', ()=>{
  const res = buildDecisionEvidence({ decisionReason: { action: 'BUY', confidence: 70 }, marketRegime: { regime: 'HIGH_VOLATILITY', confidence: 70 }, marketContextAdvice: { outlook: 'CAUTION', confidence: 50 }, historicalContext: { historicalBias: 'MIXED', confidence: 40, sampleSize: 4 }, adaptiveDecisionContext: { confidenceBias: 0 }, decisionConfidenceExplanation: { overallAssessment: 'MEDIUM_CONFIDENCE', explanationScore: 50 } });
  expect(res.uncertaintyFactors).toContain('Regime:HIGH_VOLATILITY');
  expect(res.evidenceScore).toBeLessThan(70);
});

it('score clamping and deterministic', ()=>{
  const res = buildDecisionEvidence({ decisionReason: { action: 'BUY', confidence: 999 }, marketRegime: { regime: 'STRONG_UPTREND', confidence: 999 }, marketContextAdvice: { outlook: 'FAVORABLE_LONG', confidence: 999 }, historicalContext: { historicalBias: 'HISTORICALLY_POSITIVE', confidence: 999, sampleSize: 10 }, adaptiveDecisionContext: { confidenceBias: 0 }, decisionConfidenceExplanation: { overallAssessment: 'HIGH_CONFIDENCE', explanationScore: 999 } });
  expect(res.evidenceScore).toBeLessThanOrEqual(100);
  const a = buildDecisionEvidence({ decisionReason: { action: 'BUY', confidence: 60 }, marketRegime: { regime: 'RANGE_BOUND', confidence: 30 }, marketContextAdvice: { outlook: 'NEUTRAL', confidence: 30 }, historicalContext: { historicalBias: 'MIXED', confidence: 30, sampleSize: 2 }, adaptiveDecisionContext: { confidenceBias: 0 }, decisionConfidenceExplanation: { overallAssessment: 'MEDIUM_CONFIDENCE', explanationScore: 30 } });
  const b = buildDecisionEvidence({ decisionReason: { action: 'BUY', confidence: 60 }, marketRegime: { regime: 'RANGE_BOUND', confidence: 30 }, marketContextAdvice: { outlook: 'NEUTRAL', confidence: 30 }, historicalContext: { historicalBias: 'MIXED', confidence: 30, sampleSize: 2 }, adaptiveDecisionContext: { confidenceBias: 0 }, decisionConfidenceExplanation: { overallAssessment: 'MEDIUM_CONFIDENCE', explanationScore: 30 } });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
