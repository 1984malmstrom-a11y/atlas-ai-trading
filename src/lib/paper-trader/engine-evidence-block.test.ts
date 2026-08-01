import { it, expect } from 'vitest';
import { createPaperTrader } from './engine';

it('engine rejects execution when evidence gate blocks (no execution, audit created)', async ()=>{
  const applied: any[] = [];
  const portfolioAdapter = {
    getPortfolio: async () => ({ availableCash: 100000, totalValue: 100000, holdings: [{ symbol: 'FOO', quantity: 10, marketValue: 1000, averagePrice: 100 }] }),
    applyExecution: async (exec: any) => { applied.push(exec); return { availableCash: 0, holdings: [] }; }
  } as any;

  const trader = createPaperTrader({ portfolioAdapter, config: { enabled: true } as any });

  const decision: any = {
    id: 'd1', symbol: 'FOO', action: 'BUY', confidence: 90, referencePrice: 100, requestedNotionalSek: 1000,
    // evidence indicating strong contradictory bearish signal
    evidenceInformedDecision: { agreesWithCurrentDecision: false, recommendedAction: 'HOLD' },
    decisionEvidence: { evidenceScore: 85, evidenceQuality: 'HIGH', bullishEvidence: [], bearishEvidence: ['Bearish:X'] },
    evidenceConsistency: { consistency: 'STRONGLY_ALIGNED', consistencyScore: 75, conflictingSignals: ['sigA_vs_sigB'] }
  };

  const res = await trader.handleDecision(decision as any);
  expect(res.accepted).toBe(false);
  expect(res.code).toBe('BLOCKED_BY_CONTRADICTORY_EVIDENCE');
  // applyExecution should not have been called
  expect(applied.length).toBe(0);
  const audits = await trader.getAuditEntries();
  // exactly one REJECT created, zero EXECUTION
  const rejects = (audits || []).filter((a:any)=> (a && (a.kind === 'REJECT' || (a.raw && a.raw.kind === 'REJECT'))));
  const executions = (audits || []).filter((a:any)=> (a && (a.kind === 'EXECUTION' || (a.raw && a.raw.kind === 'EXECUTION'))));
  expect(rejects.length).toBeGreaterThanOrEqual(1);
  expect(executions.length).toBe(0);
  const rej = rejects[0];
  const raw = rej && (((rej as any).raw) || rej);
  expect(raw.reason && raw.reason.code).toBe('BLOCKED_BY_CONTRADICTORY_EVIDENCE');
  // portfolio adapter should not have been mutated (applyExecution not called)
  expect(applied.length).toBe(0);
});

it('engine allows execution when evidence low quality despite conflicts', async ()=>{
  const applied: any[] = [];
  const portfolioAdapter = {
    getPortfolio: async () => ({ availableCash: 100000, totalValue: 100000, holdings: [{ symbol: 'BAR', quantity: 10, marketValue: 1000, averagePrice: 100 }] }),
    applyExecution: async (exec: any) => { applied.push(exec); return { availableCash: 0, holdings: [] }; }
  } as any;

  const trader = createPaperTrader({ portfolioAdapter, config: { enabled: true } as any });

  const decision: any = {
    id: 'd2', symbol: 'BAR', action: 'SELL', confidence: 90, referencePrice: 100, requestedNotionalSek: 1000,
    evidenceInformedDecision: { agreesWithCurrentDecision: false, recommendedAction: 'HOLD' },
    decisionEvidence: { evidenceScore: 30, evidenceQuality: 'LOW', bullishEvidence: ['Neutral:balanced'], bearishEvidence: [] },
    evidenceConsistency: { consistency: 'WEAK', consistencyScore: 20, conflictingSignals: [] },
    historicalContext: { sampleSize: 0 }
  };

  const res = await trader.handleDecision(decision as any);
  // Should attempt execution (accepted true) because gate should not block low-quality conflicts
  expect(res.accepted).toBe(true);
  expect(applied.length).toBeGreaterThanOrEqual(1);
});
