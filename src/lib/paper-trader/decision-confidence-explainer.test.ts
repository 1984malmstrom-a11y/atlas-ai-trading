import { expect, it } from 'vitest';
import buildDecisionConfidenceExplanation from './decision-confidence-explainer';

it('bullish aligned scenario -> high confidence', ()=>{
  const res = buildDecisionConfidenceExplanation({ decisionReason: { action: 'BUY', confidence: 80 }, marketRegime: { regime: 'STRONG_UPTREND', confidence: 70 }, marketContextAdvice: { outlook: 'FAVORABLE_LONG', confidence: 70 }, historicalContext: { historicalBias: 'HISTORICALLY_POSITIVE', confidence: 60, sampleSize: 5 }, adaptiveDecisionContext: { confidenceBias: 2 } });
  expect(res.overallAssessment).toBe('HIGH_CONFIDENCE');
  expect(res.confidenceDrivers.length).toBeGreaterThanOrEqual(1);
  expect(res.confidenceRisks.length).toBeGreaterThanOrEqual(1);
});

it('bearish aligned scenario -> high confidence for sell', ()=>{
  const res = buildDecisionConfidenceExplanation({ decisionReason: { action: 'SELL', confidence: 75 }, marketRegime: { regime: 'STRONG_DOWNTREND', confidence: 75 }, marketContextAdvice: { outlook: 'FAVORABLE_SHORT', confidence: 75 }, historicalContext: { historicalBias: 'HISTORICALLY_POSITIVE', confidence: 55, sampleSize: 4 }, adaptiveDecisionContext: { confidenceBias: 0 } });
  expect(res.overallAssessment).toBe('HIGH_CONFIDENCE');
});

it('conflicting signals -> medium or low', ()=>{
  const res = buildDecisionConfidenceExplanation({ decisionReason: { action: 'BUY', confidence: 60 }, marketRegime: { regime: 'STRONG_DOWNTREND', confidence: 80 }, marketContextAdvice: { outlook: 'FAVORABLE_SHORT', confidence: 80 }, historicalContext: { historicalBias: 'HISTORICALLY_NEGATIVE', confidence: 60, sampleSize: 3 }, adaptiveDecisionContext: { confidenceBias: -5 } });
  expect(['MEDIUM_CONFIDENCE','LOW_CONFIDENCE']).toContain(res.overallAssessment);
});

it('insufficient history reduces confidence', ()=>{
  const res = buildDecisionConfidenceExplanation({ decisionReason: { action: 'BUY', confidence: 70 }, marketRegime: { regime: 'STRONG_UPTREND', confidence: 70 }, marketContextAdvice: { outlook: 'FAVORABLE_LONG', confidence: 70 }, historicalContext: { historicalBias: 'INSUFFICIENT_HISTORY', confidence: 0, sampleSize: 0 }, adaptiveDecisionContext: { confidenceBias: 0 } });
  expect(res.explanationScore).toBeLessThanOrEqual(70);
});

it('high volatility penalizes score', ()=>{
  const res = buildDecisionConfidenceExplanation({ decisionReason: { action: 'BUY', confidence: 70 }, marketRegime: { regime: 'HIGH_VOLATILITY', confidence: 70 }, marketContextAdvice: { outlook: 'CAUTION', confidence: 50 }, historicalContext: { historicalBias: 'MIXED', confidence: 40, sampleSize: 4 }, adaptiveDecisionContext: { confidenceBias: 0 } });
  expect(res.confidenceRisks).toContain('Regime:HIGH_VOLATILITY');
  expect(res.explanationScore).toBeLessThan(70);
});

it('explanationScore clamping and deterministic', ()=>{
  const res = buildDecisionConfidenceExplanation({ decisionReason: { action: 'BUY', confidence: 999 }, marketRegime: { regime: 'STRONG_UPTREND', confidence: 999 }, marketContextAdvice: { outlook: 'FAVORABLE_LONG', confidence: 999 }, historicalContext: { historicalBias: 'HISTORICALLY_POSITIVE', confidence: 999, sampleSize: 10 }, adaptiveDecisionContext: { confidenceBias: 0 } });
  expect(res.explanationScore).toBeLessThanOrEqual(100);
  const a = buildDecisionConfidenceExplanation({ decisionReason: { action: 'BUY', confidence: 60 }, marketRegime: { regime: 'RANGE_BOUND', confidence: 30 }, marketContextAdvice: { outlook: 'NEUTRAL', confidence: 30 }, historicalContext: { historicalBias: 'MIXED', confidence: 30, sampleSize: 2 }, adaptiveDecisionContext: { confidenceBias: 0 } });
  const b = buildDecisionConfidenceExplanation({ decisionReason: { action: 'BUY', confidence: 60 }, marketRegime: { regime: 'RANGE_BOUND', confidence: 30 }, marketContextAdvice: { outlook: 'NEUTRAL', confidence: 30 }, historicalContext: { historicalBias: 'MIXED', confidence: 30, sampleSize: 2 }, adaptiveDecisionContext: { confidenceBias: 0 } });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
