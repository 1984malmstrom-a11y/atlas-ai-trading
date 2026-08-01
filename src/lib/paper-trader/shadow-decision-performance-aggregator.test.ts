import { describe, it, expect } from 'vitest';
import aggregate from './shadow-decision-performance-aggregator';

function mkEval(comparison:any, aScore:number, sScore:number){
  return { evaluation: { shadowDecisionOutcome: { comparison, actualScore: aScore, shadowScore: sScore } } };
}

describe('aggregateShadowDecisionPerformance', ()=>{
  it('returns INSUFFICIENT_DATA when evaluatedCount < 5', ()=>{
    const evals = [ mkEval('SHADOW_BETTER',1,1), mkEval('EQUAL',0,0) ];
    const res = aggregate({ evaluations: evals as any });
    expect(res.evaluatedCount).toBe(2);
    expect(res.assessment).toBe('INSUFFICIENT_DATA');
  });

  it('computes SHADOW_SIGNIFICANTLY_BETTER', ()=>{
    const evals = [ mkEval('SHADOW_BETTER',0,1), mkEval('SHADOW_BETTER',0,1), mkEval('SHADOW_BETTER',0,1), mkEval('SHADOW_BETTER',0,1), mkEval('SHADOW_BETTER',0,1) ];
    // make scores sum to >=5
    evals[0].evaluation.shadowDecisionOutcome.shadowScore = 2;
    evals[1].evaluation.shadowDecisionOutcome.shadowScore = 2;
    evals[2].evaluation.shadowDecisionOutcome.shadowScore = 1;
    const res = aggregate({ evaluations: evals as any });
    expect(res.evaluatedCount).toBe(5);
    expect(res.shadowBetterCount).toBe(5);
    expect(res.assessment).toBe('SHADOW_SIGNIFICANTLY_BETTER');
  });

  it('computes SHADOW_SLIGHTLY_BETTER when net advantage > 0', ()=>{
    const evals = [ mkEval('SHADOW_BETTER',0,1), mkEval('ACTUAL_BETTER',1,0), mkEval('EQUAL',0,0), mkEval('SHADOW_BETTER',0,1), mkEval('EQUAL',0,0) ];
    const res = aggregate({ evaluations: evals as any });
    expect(res.evaluatedCount).toBe(5);
    expect(res.netShadowAdvantage).toBeGreaterThan(0);
    expect(res.assessment).toBe('SHADOW_SLIGHTLY_BETTER');
  });

  it('computes ACTUAL_SIGNIFICANTLY_BETTER when net <= -5 and actualBetterRate >=60', ()=>{
    const evals = [ mkEval('ACTUAL_BETTER',1,0), mkEval('ACTUAL_BETTER',1,0), mkEval('ACTUAL_BETTER',1,0), mkEval('ACTUAL_BETTER',1,0), mkEval('ACTUAL_BETTER',1,0) ];
    // set actualTotalScore high
    evals.forEach((e:any)=> e.evaluation.shadowDecisionOutcome.actualScore = 2);
    const res = aggregate({ evaluations: evals as any });
    expect(res.evaluatedCount).toBe(5);
    expect(res.actualBetterCount).toBe(5);
    expect(res.assessment).toBe('ACTUAL_SIGNIFICANTLY_BETTER');
  });

  it('computes ACTUAL_SLIGHTLY_BETTER when net < 0 but not significant', ()=>{
    const evals = [ mkEval('ACTUAL_BETTER',1,0), mkEval('EQUAL',0,0), mkEval('EQUAL',0,0), mkEval('SHADOW_BETTER',0,1), mkEval('ACTUAL_BETTER',1,0) ];
    const res = aggregate({ evaluations: evals as any });
    expect(res.evaluatedCount).toBe(5);
    expect(res.netShadowAdvantage).toBeLessThan(0);
    expect(res.assessment).toBe('ACTUAL_SLIGHTLY_BETTER');
  });

  it('counts NOT_EVALUABLE and excludes from rates', ()=>{
    const evals = [ mkEval('SHADOW_BETTER',1,1), { evaluation: { shadowDecisionOutcome: { comparison: 'NOT_EVALUABLE' } } }, {} ];
    const res = aggregate({ evaluations: evals as any });
    expect(res.notEvaluableCount).toBeGreaterThanOrEqual(1);
    expect(res.evaluatedCount).toBe(1);
    expect(res.shadowBetterRate).toBe(100);
  });
});
