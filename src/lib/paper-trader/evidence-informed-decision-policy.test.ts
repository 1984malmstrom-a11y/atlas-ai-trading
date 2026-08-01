import { expect, it } from 'vitest';
import buildEvidenceInformedDecision from './evidence-informed-decision-policy';

it('strongly aligned bullish evidence recommends BUY', ()=>{
  const res = buildEvidenceInformedDecision({ currentAction: 'HOLD', currentConfidence: 50, decisionEvidence: { bullishEvidence: ['A'], bearishEvidence: [], uncertaintyFactors: ['None'], evidenceScore: 80, evidenceQuality: 'HIGH' }, evidenceConsistency: { consistency: 'STRONGLY_ALIGNED', consistencyScore: 90 } });
  expect(res.recommendedAction).toBe('BUY');
});

it('strongly aligned bearish evidence recommends SELL', ()=>{
  const res = buildEvidenceInformedDecision({ currentAction: 'HOLD', currentConfidence: 50, decisionEvidence: { bullishEvidence: [], bearishEvidence: ['B'], uncertaintyFactors: ['None'], evidenceScore: 80, evidenceQuality: 'HIGH' }, evidenceConsistency: { consistency: 'STRONGLY_ALIGNED', consistencyScore: 90 } });
  expect(res.recommendedAction).toBe('SELL');
});

it('mixed evidence recommends HOLD', ()=>{
  const res = buildEvidenceInformedDecision({ currentAction: 'BUY', currentConfidence: 70, decisionEvidence: { bullishEvidence: ['A'], bearishEvidence: ['B'], uncertaintyFactors: ['History:mixed'], evidenceScore: 50, evidenceQuality: 'MEDIUM' }, evidenceConsistency: { consistency: 'MIXED', consistencyScore: 50 } });
  expect(res.recommendedAction).toBe('HOLD');
});

it('weak consistency recommends HOLD', ()=>{
  const res = buildEvidenceInformedDecision({ currentAction: 'BUY', currentConfidence: 70, decisionEvidence: { bullishEvidence: ['Neutral:balanced'], bearishEvidence: [], uncertaintyFactors: ['None'], evidenceScore: 30, evidenceQuality: 'LOW' }, evidenceConsistency: { consistency: 'WEAK', consistencyScore: 30 } });
  expect(res.recommendedAction).toBe('HOLD');
});

it('insufficient evidence recommends HOLD', ()=>{
  const res = buildEvidenceInformedDecision({ currentAction: 'BUY', currentConfidence: 70, decisionEvidence: null, evidenceConsistency: null });
  expect(res.recommendedAction).toBe('HOLD');
});

it('agreement and disagreement detection', ()=>{
  const agree = buildEvidenceInformedDecision({ currentAction: 'BUY', currentConfidence: 60, decisionEvidence: { bullishEvidence: ['A'], bearishEvidence: [], uncertaintyFactors: ['None'], evidenceScore: 80, evidenceQuality: 'HIGH' }, evidenceConsistency: { consistency: 'STRONGLY_ALIGNED', consistencyScore: 90 } });
  expect(agree.agreesWithCurrentDecision).toBe(true);
  const disagree = buildEvidenceInformedDecision({ currentAction: 'BUY', currentConfidence: 90, decisionEvidence: { bullishEvidence: [], bearishEvidence: ['B'], uncertaintyFactors: ['None'], evidenceScore: 80, evidenceQuality: 'HIGH' }, evidenceConsistency: { consistency: 'STRONGLY_ALIGNED', consistencyScore: 90 } });
  expect(disagree.agreesWithCurrentDecision).toBe(false);
});

it('confidence clamping and deterministic', ()=>{
  const res = buildEvidenceInformedDecision({ currentAction: 'BUY', currentConfidence: 999, decisionEvidence: { bullishEvidence: ['A'], bearishEvidence: [], uncertaintyFactors: ['None'], evidenceScore: 999, evidenceQuality: 'HIGH' }, evidenceConsistency: { consistency: 'STRONGLY_ALIGNED', consistencyScore: 999 } });
  expect(res.recommendedConfidence).toBeLessThanOrEqual(100);
  const a = buildEvidenceInformedDecision({ currentAction: 'HOLD', currentConfidence: 60, decisionEvidence: { bullishEvidence: ['A'], bearishEvidence: [], uncertaintyFactors: ['None'], evidenceScore: 80, evidenceQuality: 'HIGH' }, evidenceConsistency: { consistency: 'STRONGLY_ALIGNED', consistencyScore: 90 } });
  const b = buildEvidenceInformedDecision({ currentAction: 'HOLD', currentConfidence: 60, decisionEvidence: { bullishEvidence: ['A'], bearishEvidence: [], uncertaintyFactors: ['None'], evidenceScore: 80, evidenceQuality: 'HIGH' }, evidenceConsistency: { consistency: 'STRONGLY_ALIGNED', consistencyScore: 90 } });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
