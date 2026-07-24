import { describe, it, expect } from 'vitest';
import { combineAnalyses } from './analysis-aggregator';

describe('analysis aggregator (mock)', ()=>{
  it('only technical provided', ()=>{
    const tech = { status: 'success', technicalScore: 80, score: 80, signal: 'BUY', reasons: ['T1','T2'] };
    const out = combineAnalyses({ technical: tech, fundamental: null });
    expect(out.overallScore).toBe(80);
    expect(out.overallSignal).toBe('BUY');
    expect(out.confidence).toBe(80);
    expect(Array.isArray(out.reasons)).toBeTruthy();
    expect(out.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it('only fundamental provided', ()=>{
    const fund = { status: 'success', score: 60, signal: 'HOLD', reasons: ['F1','F2','F3'] };
    const out = combineAnalyses({ technical: null, fundamental: fund });
    expect(out.overallScore).toBe(60);
    expect(out.overallSignal).toBe('HOLD');
    expect(out.confidence).toBe(60);
    expect(out.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('both engines provided', ()=>{
    const tech = { status: 'success', score: 70, signal: 'HOLD', reasons: ['T1','T2'] };
    const fund = { status: 'success', score: 80, signal: 'BUY', reasons: ['F1','F2','F3'] };
    const out = combineAnalyses({ technical: tech, fundamental: fund });
    // average of 70 and 80 = 75 -> rounded 75
    expect(out.overallScore).toBe(75);
    expect(out.overallSignal).toBe('BUY');
    expect(out.confidence).toBe(75);
    // reasons should include up to 4 items, deterministically: tech reasons then fund reasons
    expect(out.reasons.slice(0,2)).toEqual(['T1','T2']);
    expect(out.reasons.length).toBeLessThanOrEqual(4);
  });

  it('empty input yields neutral HOLD with score 0', ()=>{
    const out = combineAnalyses({ technical: null, fundamental: null });
    expect(out.overallScore).toBe(0);
    expect(out.overallSignal).toBe('HOLD');
    expect(out.confidence).toBe(0);
    expect(Array.isArray(out.reasons)).toBeTruthy();
    expect(out.reasons.length).toBe(0);
  });
});
