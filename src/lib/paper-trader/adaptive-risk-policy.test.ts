import { expect, it } from 'vitest';
import { applyAdaptiveRiskPolicy } from './risk-engine';

it('positive bias increases risk', ()=>{
  const orig = 50;
  const ctx = { riskBias: 0.05 };
  const out = applyAdaptiveRiskPolicy(orig, ctx as any);
  expect(out).toBe(52.5);
});

it('negative bias decreases risk', ()=>{
  const orig = 80;
  const ctx = { riskBias: -0.1 };
  const out = applyAdaptiveRiskPolicy(orig, ctx as any);
  expect(out).toBe(72);
});

it('clamps high bias to +0.20', ()=>{
  const orig = 90;
  const ctx = { riskBias: 1.0 };
  const out = applyAdaptiveRiskPolicy(orig, ctx as any);
  expect(out).toBe(100); // clamped to engine max 100
});

it('clamps low bias to -0.20', ()=>{
  const orig = 10;
  const ctx = { riskBias: -0.5 };
  const out = applyAdaptiveRiskPolicy(orig, ctx as any);
  expect(out).toBe(8);
});

it('zero bias leaves unchanged', ()=>{
  const orig = 33.33;
  const ctx = { riskBias: 0 };
  const out = applyAdaptiveRiskPolicy(orig, ctx as any);
  expect(out).toBe(33.33);
});
