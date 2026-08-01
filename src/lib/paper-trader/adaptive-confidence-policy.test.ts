import { expect, it } from 'vitest';
import { applyAdaptiveConfidencePolicy } from './demo-runtime';

it('positive bias increases confidence', ()=>{
  const orig = 50;
  const ctx = { confidenceBias: 5 };
  const out = applyAdaptiveConfidencePolicy(orig, ctx as any);
  expect(out).toBe(55);
});

it('negative bias decreases confidence', ()=>{
  const orig = 60;
  const ctx = { confidenceBias: -7 };
  const out = applyAdaptiveConfidencePolicy(orig, ctx as any);
  expect(out).toBe(53);
});

it('clamps high to 100', ()=>{
  const orig = 98;
  const ctx = { confidenceBias: 10 };
  const out = applyAdaptiveConfidencePolicy(orig, ctx as any);
  expect(out).toBe(100);
});

it('clamps low to 0', ()=>{
  const orig = 3;
  const ctx = { confidenceBias: -10 };
  const out = applyAdaptiveConfidencePolicy(orig, ctx as any);
  expect(out).toBe(0);
});

it('zero bias leaves unchanged', ()=>{
  const orig = 42.75;
  const ctx = { confidenceBias: 0 };
  const out = applyAdaptiveConfidencePolicy(orig, ctx as any);
  expect(out).toBe(42.75);
});
