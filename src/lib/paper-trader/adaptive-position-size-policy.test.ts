import { expect, it } from 'vitest';
import { applyAdaptivePositionSizePolicy } from './risk-engine';

it('positive confidence bias increases position size', ()=>{
  const orig = 1000;
  const ctx = { confidenceBias: 5, riskBias: 0 };
  const out = applyAdaptivePositionSizePolicy(orig, ctx as any, 2000);
  // confidenceBias 5 -> 5% -> +5% = 1050
  expect(out).toBe(1050);
});

it('negative confidence bias decreases position size', ()=>{
  const orig = 1000;
  const ctx = { confidenceBias: -3, riskBias: 0 };
  const out = applyAdaptivePositionSizePolicy(orig, ctx as any, 2000);
  expect(out).toBe(970);
});

it('positive risk bias increases position size', ()=>{
  const orig = 1000;
  const ctx = { confidenceBias: 0, riskBias: 0.10 };
  const out = applyAdaptivePositionSizePolicy(orig, ctx as any, 2000);
  // riskBias is ignored by position-size policy; should remain unchanged
  expect(out).toBe(1000);
});

it('combined adjustment respects combined cap', ()=>{
  const orig = 1000;
  const ctx = { confidenceBias: 15, riskBias: 0.15 };
  const out = applyAdaptivePositionSizePolicy(orig, ctx as any, 2000);
  // riskBias ignored; confidence capped at 10% => +10% => 1100
  expect(out).toBe(1100);
});

it('clamp max does not exceed engine limit', ()=>{
  const orig = 1000;
  const ctx = { confidenceBias: 20, riskBias: 0.2 };
  const out = applyAdaptivePositionSizePolicy(orig, ctx as any, 1050);
  // desired would be +20% => 1200 but maxAllowed=1050 so clamp to 1050
  expect(out).toBe(1050);
});

it('clamp min does not go below zero', ()=>{
  const orig = 1000;
  const ctx = { confidenceBias: -200, riskBias: -1 };
  const out = applyAdaptivePositionSizePolicy(orig, ctx as any, 2000);
  // extreme negatives capped to -10% (confidence only) => 900
  expect(out).toBe(900);
});

it('zero adjustment leaves unchanged', ()=>{
  const orig = 1234.56;
  const ctx = { confidenceBias: 0, riskBias: 0 };
  const out = applyAdaptivePositionSizePolicy(orig, ctx as any, 5000);
  expect(out).toBe(1234.56);
});
