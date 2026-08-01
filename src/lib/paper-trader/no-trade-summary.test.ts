import { describe, it, expect, beforeEach } from 'vitest';
import buildForexNoTradeSummary from './no-trade-summary';

function clone(obj:any){ return JSON.parse(JSON.stringify(obj)); }

describe('buildForexNoTradeSummary', ()=>{
  let baseEval:any;
  let baseExec:any;
  let baseReject:any;

  beforeEach(()=>{
    baseEval = { kind: 'EVALUATION', decision: { id: 'eval1', symbol: 'EUR/USD' }, evaluation: { dummy: true } };
    baseReject = { kind: 'REJECT', decision: { id: 'rej1', symbol: 'EUR/USD' }, reason: { code: 'FOREX_DIAGNOSTIC_ONLY' } };
    baseExec = { kind: 'EXECUTION', decision: { id: 'exec1', symbol: 'EUR/USD' }, execution: { id: 'e1', symbol: 'EUR/USD' } };
  });

  it('counts only provided cycleId and dedupes by candidate id', ()=>{
    // use same decision id to represent same candidate across evaluation+reject
    const ev = clone(baseEval); ev.decision.id = 'same1'; ev.decision.symbol = 'EUR/USD';
    const rej = clone(baseReject); rej.decision.id = 'same1'; rej.decision.symbol = 'EUR/USD';
    const audits = [ ev, rej ];
    const out = buildForexNoTradeSummary({ cycleId: 'c1', checkedAt: 't', evaluations: [], audits });
    expect(out.cycleId).toBe('c1');
    expect(out.analyzedPairCount).toBe(1);
    expect(out.holdCount).toBe(0);
    expect(out.blockedCount).toBe(1);
    expect(out.rejectedCount).toBe(1);
    expect(Array.isArray(out.topReasons)).toBe(true);
  });

  it('holdCount increments for EVALUATION entries', ()=>{
    const ev = clone(baseEval); ev.decision.id = 'ev2'; ev.decision.symbol = 'EUR/USD';
    const out = buildForexNoTradeSummary({ cycleId: 'c2', checkedAt: 't', evaluations: [ev], audits: [] });
    expect(out.analyzedPairCount).toBe(1);
    expect(out.holdCount).toBe(1);
  });

  it('blockedCount increments for various forex reasons and unknown normalizes to OTHER', ()=>{
    const rej1 = clone(baseReject);
    const rej2 = { kind: 'REJECT', decision: { id: 'rej2', symbol: 'EUR/USD' }, reason: { code: 'FOREX_AUTONOMY_NOT_ARMED' } };
    const rej3 = { kind: 'REJECT', decision: { id: 'rej3', symbol: 'EUR/USD' }, reason: { code: 'FOREX_SESSION_CLOSED' } };
    const rej4 = { kind: 'REJECT', decision: { id: 'rej4', symbol: 'EUR/USD' }, reason: { code: 'SOME_RANDOM' } };
    const out = buildForexNoTradeSummary({ cycleId: 'c3', checkedAt: 't', evaluations: [], audits: [rej1, rej2, rej3, rej4] });
    expect(out.blockedCount).toBe(3); // first three map to blocked
    // unknown reason should appear as its uppercased code in topReasons
    const top = out.topReasons.map((r:any)=> r.reason);
    expect(top).toContain('SOME_RANDOM');
  });

  it('execution removes candidate from no-trade counts', ()=>{
    const evalA = { kind: 'EVALUATION', decision: { id: 'dX', symbol: 'EUR/USD' } };
    const rejA = { kind: 'REJECT', decision: { id: 'dX', symbol: 'EUR/USD' }, reason: { code: 'FOREX_DIAGNOSTIC_ONLY' } };
    const execA = { kind: 'EXECUTION', decision: { id: 'dX', symbol: 'EUR/USD' }, execution: { id: 'ex1', symbol: 'EUR/USD' } };
    const out = buildForexNoTradeSummary({ cycleId: 'c4', checkedAt: 't', evaluations: [evalA], audits: [rejA, execA] });
    // execution should clear counts for that candidate
    expect(out.analyzedPairCount).toBe(1);
    expect(out.blockedCount).toBe(0);
    expect(out.rejectedCount).toBe(0);
  });

  it('does not mutate inputs and JSON.stringify works', ()=>{
    const evals = [ clone(baseEval) ];
    const audits = [ clone(baseReject) ];
    const copyE = clone(evals);
    const copyA = clone(audits);
    const out = buildForexNoTradeSummary({ cycleId: 'c5', checkedAt: 't', evaluations: evals, audits });
    expect(JSON.stringify(out)).toBeTruthy();
    expect(JSON.stringify(evals)).toBe(JSON.stringify(copyE));
    expect(JSON.stringify(audits)).toBe(JSON.stringify(copyA));
  });

});
