import { expect, it } from 'vitest';
import analyzeEvidenceConsistency from './evidence-consistency-analyzer';

it('strongly aligned bullish evidence', ()=>{
  const de = { evidenceScore: 85, bullishEvidence: ['MarketRegime:STRONG_UPTREND','MarketContext:FAVORABLE_LONG','History:positive','Explainer:strong(82)'], bearishEvidence: [], uncertaintyFactors: ['None'], evidenceQuality: 'HIGH' } as any;
  const res = analyzeEvidenceConsistency({ decisionEvidence: de });
  expect(res.consistency).toBe('STRONGLY_ALIGNED');
  expect(res.alignedSignals.length).toBeGreaterThan(0);
});

it('strongly aligned bearish evidence', ()=>{
  const de = { evidenceScore: 80, bullishEvidence: [], bearishEvidence: ['MarketRegime:STRONG_DOWNTREND','MarketContext:FAVORABLE_SHORT','History:negative'], uncertaintyFactors: ['None'], evidenceQuality: 'HIGH' } as any;
  const res = analyzeEvidenceConsistency({ decisionEvidence: de });
  expect(res.consistency).toBe('STRONGLY_ALIGNED');
});

it('mixed evidence', ()=>{
  const de = { evidenceScore: 50, bullishEvidence: ['x'], bearishEvidence: ['y'], uncertaintyFactors: ['History:mixed'], evidenceQuality: 'MEDIUM' } as any;
  const res = analyzeEvidenceConsistency({ decisionEvidence: de });
  expect(res.consistency).toBe('MIXED');
});

it('weak evidence', ()=>{
  const de = { evidenceScore: 30, bullishEvidence: ['Neutral:balanced'], bearishEvidence: [], uncertaintyFactors: ['None'], evidenceQuality: 'LOW' } as any;
  const res = analyzeEvidenceConsistency({ decisionEvidence: de });
  expect(res.consistency).toBe('WEAK');
});

it('insufficient evidence', ()=>{
  const res = analyzeEvidenceConsistency({ decisionEvidence: null });
  expect(res.consistency).toBe('INSUFFICIENT_EVIDENCE');
});

it('score clamping and deterministic', ()=>{
  const de = { evidenceScore: 999, bullishEvidence: ['A','B','C','D'], bearishEvidence: [], uncertaintyFactors: [], evidenceQuality: 'HIGH' } as any;
  const res = analyzeEvidenceConsistency({ decisionEvidence: de });
  expect(res.consistencyScore).toBeLessThanOrEqual(100);
  const a = analyzeEvidenceConsistency({ decisionEvidence: de });
  const b = analyzeEvidenceConsistency({ decisionEvidence: de });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
