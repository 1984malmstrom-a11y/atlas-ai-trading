import { it, expect } from 'vitest';
import { evaluateEvidenceExecutionGate } from './evidence-informed-decision-policy';

it('does not block on sampleSize=0 low quality high uncertainty', ()=>{
  const decision: any = {
    action: 'SELL',
    evidenceInformedDecision: { agreesWithCurrentDecision: false, recommendedAction: 'HOLD' },
    decisionEvidence: { evidenceScore: 23, evidenceQuality: 'LOW', bullishEvidence: ['Neutral:balanced'], bearishEvidence: [], uncertaintyFactors: ['Regime:UNCERTAIN'] },
    evidenceConsistency: { consistency: 'WEAK', consistencyScore: 20, conflictingSignals: [] },
    historicalContext: { sampleSize: 0, historicalBias: 'INSUFFICIENT_HISTORY' }
  };
  const res = evaluateEvidenceExecutionGate(decision);
  expect(res.blocked).toBe(false);
});

it('does not block when evidenceInformedDecision missing', ()=>{
  const decision: any = { action: 'BUY' };
  const res = evaluateEvidenceExecutionGate(decision);
  expect(res.blocked).toBe(false);
});

it('ignores neutral/insufficient conflict markers', ()=>{
  const decision: any = {
    action: 'BUY',
    evidenceInformedDecision: { agreesWithCurrentDecision: false, recommendedAction: 'HOLD' },
    decisionEvidence: { evidenceScore: 80, evidenceQuality: 'HIGH', bullishEvidence: [], bearishEvidence: [] },
    evidenceConsistency: { consistency: 'WEAK', consistencyScore: 30, conflictingSignals: ['None','NONE','', '   ', 'Neutral:balanced', 'INSUFFICIENT_EVIDENCE'] }
  };
  const res = evaluateEvidenceExecutionGate(decision);
  // conflict markers are all neutral forms — should not be treated as conflict
  expect(res.blocked).toBe(false);
});

it('blocks on high-quality explicit conflicting signals', ()=>{
  const decision: any = {
    action: 'BUY',
    evidenceInformedDecision: { agreesWithCurrentDecision: false, recommendedAction: 'HOLD' },
    decisionEvidence: { evidenceScore: 80, evidenceQuality: 'HIGH', bullishEvidence: [], bearishEvidence: ['Bearish:signalX'] },
    evidenceConsistency: { consistency: 'STRONGLY_ALIGNED', consistencyScore: 75, conflictingSignals: ['signalX_vs_signalY'] }
  };
  const res = evaluateEvidenceExecutionGate(decision);
  expect(res.blocked).toBe(true);
  expect(res.code).toBe('BLOCKED_BY_CONTRADICTORY_EVIDENCE');
});

it('does not block on conflicting signals when quality low', ()=>{
  const decision: any = {
    action: 'BUY',
    evidenceInformedDecision: { agreesWithCurrentDecision: false, recommendedAction: 'HOLD' },
    decisionEvidence: { evidenceScore: 30, evidenceQuality: 'LOW', bullishEvidence: [], bearishEvidence: ['B'] },
    evidenceConsistency: { consistency: 'WEAK', consistencyScore: 30, conflictingSignals: ['x'] }
  };
  const res = evaluateEvidenceExecutionGate(decision);
  expect(res.blocked).toBe(false);
});

it('blocks on mixed direction with high quality', ()=>{
  const decision: any = {
    action: 'SELL',
    evidenceInformedDecision: { agreesWithCurrentDecision: false, recommendedAction: 'HOLD' },
    decisionEvidence: { evidenceScore: 85, evidenceQuality: 'HIGH', bullishEvidence: ['A'], bearishEvidence: ['B'] },
    evidenceConsistency: { consistency: 'MIXED', consistencyScore: 65, conflictingSignals: [] }
  };
  const res = evaluateEvidenceExecutionGate(decision);
  expect(res.blocked).toBe(true);
});

it('blocks on strong historical contradiction with sufficient sample', ()=>{
  const decision: any = {
    action: 'SELL',
    evidenceInformedDecision: { agreesWithCurrentDecision: false, recommendedAction: 'HOLD' },
    decisionEvidence: { evidenceScore: 75, evidenceQuality: 'HIGH', bullishEvidence: [], bearishEvidence: [] },
    evidenceConsistency: { consistency: 'MOSTLY_ALIGNED', consistencyScore: 70, conflictingSignals: [] },
    historicalContext: { sampleSize: 5, historicalBias: 'HISTORICALLY_POSITIVE' }
  };
  const res = evaluateEvidenceExecutionGate(decision);
  expect(res.blocked).toBe(true);
});
