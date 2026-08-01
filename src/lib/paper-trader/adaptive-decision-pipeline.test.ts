import { expect, it } from 'vitest';
import { applyAdaptiveRiskPolicy, applyAdaptivePositionSizePolicy } from './risk-engine';
import { applyAdaptiveConfidencePolicy } from './demo-runtime';

it('positive adaptation: confidence increases, risk increases, position size adjusted by confidence only', ()=>{
  const originalConfidence = 60;
  const originalRisk = 70;
  const originalPositionSize = 1000;
  const ctx = { confidenceBias: 5, riskBias: 0.10 };

  const effectiveConfidence = applyAdaptiveConfidencePolicy(originalConfidence, ctx as any);
  const effectiveRisk = applyAdaptiveRiskPolicy(originalRisk, ctx as any);
  const effectivePositionSize = applyAdaptivePositionSizePolicy(originalPositionSize, ctx as any, 5000);

  expect(effectiveConfidence).toBeGreaterThan(originalConfidence);
  expect(effectiveRisk).toBeGreaterThan(originalRisk);
  // position size should reflect confidenceBias only: +5% -> 1050
  expect(effectivePositionSize).toBe(1050);
});

it('negative adaptation: confidence decreases, risk decreases, position size reduced appropriately', ()=>{
  const originalConfidence = 80;
  const originalRisk = 80;
  const originalPositionSize = 2000;
  const ctx = { confidenceBias: -8, riskBias: -0.10 };

  const effectiveConfidence = applyAdaptiveConfidencePolicy(originalConfidence, ctx as any);
  const effectiveRisk = applyAdaptiveRiskPolicy(originalRisk, ctx as any);
  const effectivePositionSize = applyAdaptivePositionSizePolicy(originalPositionSize, ctx as any, 5000);

  expect(effectiveConfidence).toBeLessThan(originalConfidence);
  expect(effectiveRisk).toBeLessThan(originalRisk);
  // position size should reflect -8% -> 1840
  expect(effectivePositionSize).toBe(1840);
});

it('no double-counting: riskBias changes risk but does not affect position size', ()=>{
  const origPos = 1500;
  const ctxA = { confidenceBias: 0, riskBias: 0.12 };
  const ctxB = { confidenceBias: 0, riskBias: 0.00 };
  const outA = applyAdaptivePositionSizePolicy(origPos, ctxA as any, 5000);
  const outB = applyAdaptivePositionSizePolicy(origPos, ctxB as any, 5000);
  expect(outA).toBe(outB);
});

it('zero-bias baseline: nothing changes', ()=>{
  const origConf = 55;
  const origRisk = 40;
  const origPos = 777.77;
  const ctx = { confidenceBias: 0, riskBias: 0 };
  const c = applyAdaptiveConfidencePolicy(origConf, ctx as any);
  const r = applyAdaptiveRiskPolicy(origRisk, ctx as any);
  const p = applyAdaptivePositionSizePolicy(origPos, ctx as any, 5000);
  expect(c).toBe(origConf);
  expect(r).toBe(origRisk);
  expect(p).toBe(origPos);
});

it('preserve observability: originals and effective values are distinct where adjusted', ()=>{
  const origConf = 45;
  const origRisk = 65;
  const origPos = 1000;
  const ctx = { confidenceBias: 7, riskBias: -0.05 };
  const c = applyAdaptiveConfidencePolicy(origConf, ctx as any);
  const r = applyAdaptiveRiskPolicy(origRisk, ctx as any);
  const p = applyAdaptivePositionSizePolicy(origPos, ctx as any, 2000);
  expect(c).not.toBe(origConf);
  expect(r).not.toBe(origRisk);
  expect(p).not.toBe(origPos);
});
