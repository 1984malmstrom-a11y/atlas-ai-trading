import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendEvaluation } from '../../src/lib/paper-trader/demo-runtime';
import evaluateShadowDecisionOutcome from '../../src/lib/paper-trader/shadow-decision-outcome-evaluator';

// Minimal in-memory audit store mock matching runtime expectations
function createInMemoryStore(){
  const entries: any[] = [];
  return {
    entries,
    async list(){ return entries.slice(); },
    async append(e: any){ entries.push({ raw: e }); return e; }
  };
}

describe('shadow decision outcome integration', ()=>{
  let store: any;
  beforeEach(()=>{ store = createInMemoryStore(); });

  it('handles NOT_EVALUABLE when no prices available', async ()=>{
    const evalEntry = { kind: 'EVALUATION', decision: { id: 'eval_1', symbol: 'FOO', action: 'SELL' } } as any;
    await appendEvaluation(evalEntry, store as any);
    const last = store.entries[store.entries.length-1].raw;
    expect(last.evaluation).toBeDefined();
    expect(last.evaluation.shadowDecisionOutcome).toBeDefined();
    expect(last.evaluation.shadowDecisionOutcome.comparison).toBe('NOT_EVALUABLE');
    expect(last.evaluation.shadowDecisionOutcome.actualOutcome).toBe('NOT_EVALUABLE');
    expect(last.evaluation.shadowDecisionOutcome.shadowOutcome).toBe('NOT_EVALUABLE');
  });

  it('SHADOW_BETTER when actual BUY but stored shadow SELL and price declines', async ()=>{
    const summary = { kind: 'DECISION_SUMMARY', summary: { decisions: [{ symbol: 'SB', action: 'BUY', referencePrice: 100 }], decisionReasons: [{ symbol: 'SB', evidenceInformedDecision: { recommendedAction: 'SELL' } }] } };
    await store.append(summary);
    const evalEntry = { kind: 'EVALUATION', decision: { id: 'eval_sb', symbol: 'SB', action: 'BUY', referencePrice: 100 }, execution: { executedPrice: 90 } } as any;
    await appendEvaluation(evalEntry, store as any);
    const last = store.entries[store.entries.length-1].raw;
    expect(last.evaluation.shadowDecisionOutcome.comparison).toBe('SHADOW_BETTER');
    expect(last.evaluation.shadowDecisionOutcome.actualOutcome).toBe('INCORRECT');
    expect(last.evaluation.shadowDecisionOutcome.shadowOutcome).toBe('CORRECT');
  });

  it('ACTUAL_BETTER when actual SELL but stored shadow HOLD and price declines', async ()=>{
    const summary = { kind: 'DECISION_SUMMARY', summary: { decisions: [{ symbol: 'AB', action: 'SELL', referencePrice: 100 }], decisionReasons: [{ symbol: 'AB', evidenceInformedDecision: { recommendedAction: 'HOLD' } }] } };
    await store.append(summary);
    const evalEntry = { kind: 'EVALUATION', decision: { id: 'eval_ab', symbol: 'AB', action: 'SELL', referencePrice: 100 }, execution: { executedPrice: 90 } } as any;
    await appendEvaluation(evalEntry, store as any);
    const last = store.entries[store.entries.length-1].raw;
    expect(last.evaluation.shadowDecisionOutcome.comparison).toBe('ACTUAL_BETTER');
    expect(last.evaluation.shadowDecisionOutcome.actualOutcome).toBe('CORRECT');
    expect(last.evaluation.shadowDecisionOutcome.shadowOutcome).toBe('INCORRECT');
  });

  it('EQUAL when actual and stored shadow actions match and outcomes match', async ()=>{
    const summary = { kind: 'DECISION_SUMMARY', summary: { decisions: [{ symbol: 'EQ', action: 'BUY', referencePrice: 100 }], decisionReasons: [{ symbol: 'EQ', evidenceInformedDecision: { recommendedAction: 'BUY' } }] } };
    await store.append(summary);
    const evalEntry = { kind: 'EVALUATION', decision: { id: 'eval_eq', symbol: 'EQ', action: 'BUY', referencePrice: 100 }, execution: { executedPrice: 110 } } as any;
    await appendEvaluation(evalEntry, store as any);
    const last = store.entries[store.entries.length-1].raw;
    expect(last.evaluation.shadowDecisionOutcome.comparison).toBe('EQUAL');
  });

  it('reuses stored shadow recommendation and does not get replaced by TRADE_FEEDBACK recompute', async ()=>{
    // seed a TRADE_FEEDBACK that *would* suggest BUY but ensure DECISION_SUMMARY stored SELL wins
    const tf = { kind: 'TRADE_FEEDBACK', feedback: { decisionReasons: [{ symbol: 'REUSE', evidenceInformedDecision: { recommendedAction: 'BUY' } }] } };
    await store.append(tf);
    const summary = { kind: 'DECISION_SUMMARY', summary: { decisions: [{ symbol: 'REUSE', action: 'BUY', referencePrice: 100 }], decisionReasons: [{ symbol: 'REUSE', evidenceInformedDecision: { recommendedAction: 'SELL' } }] } };
    await store.append(summary);
    const evalEntry = { kind: 'EVALUATION', decision: { id: 'eval_reuse', symbol: 'REUSE', action: 'BUY', referencePrice: 100 }, execution: { executedPrice: 90 } } as any;
    await appendEvaluation(evalEntry, store as any);
    const last = store.entries[store.entries.length-1].raw;
    // ensure DECISION_SUMMARY's SELL was used rather than TRADE_FEEDBACK's BUY
    expect(last.evaluation.shadowDecisionOutcome.shadowOutcome).toBe('CORRECT');
    expect(last.evaluation.shadowDecisionOutcome.comparison).toBe('SHADOW_BETTER');
  });

  it('does not mutate existing evaluation fields or produce extra execution/portfolio entries', async ()=>{
    const summary = { kind: 'DECISION_SUMMARY', summary: { decisions: [{ symbol: 'IMM', action: 'BUY', referencePrice: 100 }], decisionReasons: [{ symbol: 'IMM', evidenceInformedDecision: { recommendedAction: 'BUY' } }] } };
    await store.append(summary);
    const existingEval = { tradeId: 't-1', evaluatedAt: 'now', evaluationResult: 'WIN' } as any;
    const evalEntry = { kind: 'EVALUATION', decision: { id: 'eval_imm', symbol: 'IMM', action: 'BUY', referencePrice: 100 }, execution: { executedPrice: 110 }, evaluation: existingEval } as any;
    const beforeLen = store.entries.length;
    await appendEvaluation(evalEntry, store as any);
    const afterLen = store.entries.length;
    expect(afterLen).toBe(beforeLen + 1);
    const last = store.entries[store.entries.length-1].raw;
    expect(last.evaluation.tradeId).toBe('t-1');
    expect(last.evaluation.evaluationResult).toBe('WIN');
    // ensure no EXECUTION entries were created by appendEvaluation
    const kinds = store.entries.map((e:any)=> e.raw && e.raw.kind).filter(Boolean);
    expect(kinds).not.toContain('EXECUTION');
  });
});
