import { describe, it, expect } from 'vitest';
import { computeTradeFeedbackSummary } from './demo-runtime';

function makeAudit(execId: string, pnl: number, winner: boolean, signals?: string[]){
  return { raw: { evaluation: { tradeReview: { executionId: execId, pnlSek: pnl, pnlPercent: Math.round((pnl/100) * 100) / 100, winner } }, decision: { signals: signals || [] } } };
}

function makeStore(list: any[]){
  return { list: async ()=> list };
}

describe('computeTradeFeedbackSummary bySignal aggregation', ()=>{
  it('groups per signalId and computes counts, winRate and avgPnlSek', async ()=>{
    const audits = [
      makeAudit('t1', 100, true, ['SIG_A']),
      makeAudit('t2', 50, true, ['SIG_A','SIG_B']),
      makeAudit('t3', -20, false, ['SIG_B']),
    ];
    const store = makeStore(audits);
    const out = await computeTradeFeedbackSummary(store as any);
    expect(out).toBeDefined();
    const o = out as any;
    expect(o.evaluatedCount).toBe(3);
    expect(Array.isArray(o.bySignal)).toBe(true);
    const a = o.bySignal.find((s:any)=> s.signalId === 'SIG_A');
    const b = o.bySignal.find((s:any)=> s.signalId === 'SIG_B');
    expect(a).toBeDefined();
    expect(a.evaluatedCount).toBe(2);
    expect(a.winRate).toBeCloseTo(1);
    expect(a.avgPnlSek).toBeCloseTo((100 + 50)/2);
    expect(b).toBeDefined();
    expect(b.evaluatedCount).toBe(2);
    expect(b.winRate).toBeCloseTo(0.5);
    expect(b.avgPnlSek).toBeCloseTo((50 + -20)/2);
  });

  it('deduplicates duplicate signal ids within same evaluation', async ()=>{
    const audits = [ makeAudit('x1', 30, true, ['S1','S1','S2']) ];
    const store = makeStore(audits);
    const out = await computeTradeFeedbackSummary(store as any);
    expect(out).toBeDefined();
    const o2 = out as any;
    expect(Array.isArray(o2.bySignal)).toBe(true);
    const s1 = o2.bySignal.find((s:any)=> s.signalId === 'S1');
    const s2 = o2.bySignal.find((s:any)=> s.signalId === 'S2');
    expect(s1.evaluatedCount).toBe(1);
    expect(s2.evaluatedCount).toBe(1);
  });

  it('returns empty bySignal when audits have evaluations but no decision.signals', async ()=>{
    const audits = [ { raw: { evaluation: { tradeReview: { executionId: 'zz', pnlSek: 10, pnlPercent: 1, winner: true } }, decision: { signals: [] } } } ];
    const store = makeStore(audits);
    const out = await computeTradeFeedbackSummary(store as any);
    expect(out).toBeDefined();
    const o3 = out as any;
    expect(Array.isArray(o3.bySignal)).toBe(true);
    expect(o3.bySignal.length).toBe(0);
  });

  it('returns undefined for completely empty audit list', async ()=>{
    const store = makeStore([]);
    const out = await computeTradeFeedbackSummary(store as any);
    expect(out).toBeUndefined();
  });
});
