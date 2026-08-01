import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let originalCwd: string | null = null;
let tmpDir: string | null = null;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-audit-'));
  process.chdir(tmpDir);
  vi.resetModules();
  try{ (globalThis as any).__ATLAS_PAPER_TRADER_SCHEDULER__ = undefined; }catch(_){ }
});

afterEach(() => {
  try{ if (originalCwd) process.chdir(originalCwd); }catch(_){ }
  try{ if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); }catch(_){ }
  try{ (globalThis as any).__ATLAS_PAPER_TRADER_SCHEDULER__ = undefined; }catch(_){ }
});

it('runtime: aggregates stored EVALUATION shadow outcomes into DecisionSummary.shadowPerformanceSummary (stored outcomes reused)', async ()=>{
  // Arrange: set up deterministic mocks (copied from evidence-informed runtime test)
  vi.doMock('../market-data/instruments', () => {
    const TRADABLE_INSTRUMENTS = [
      { id: 't1', providerSymbol: 'T1', symbol: 'T1', enabled: true, marketDataEnabled: true, assetType: 'STOCK' },
      { id: 't2', providerSymbol: 'T2', symbol: 'T2', enabled: true, marketDataEnabled: true, assetType: 'STOCK' }
    ];
    return { TRADABLE_INSTRUMENTS, findInstrumentById: (id: string) => TRADABLE_INSTRUMENTS.find((i:any)=> i.id === id) };
  });

  vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: (_d?: any) => ({ open: true }) }));

  vi.doMock('../market-data/twelve-data', () => ({
    TwelveDataMarketDataProvider: class {
      async getHistoricalDailyCloses(_sym: string, _days: number){ return { closes: Array.from({ length: 30 }, (_,i) => 100 + i), dates: [] }; }
    }
  }));
  vi.doMock('./technical', () => ({ default: (_: any[]) => ({ technicalMomentumPercent: 5, technicalScore: 10, momentumPercent: 5, trend: 'UP' }) }));
  vi.doMock('./expected-return', () => ({ __esModule: true, default: (_: any) => ({ expectedReturnPercent: 20 }) }));

  vi.doMock('./decision-engine', async () => {
    const real = await vi.importActual('./decision-engine');
    return {
      ...real,
      evaluateDecision: (input: any) => {
        const symbol = input && input.decision && input.decision.symbol ? String(input.decision.symbol).toUpperCase() : '';
        const expected = symbol === 'T1' ? 20 : -20;
        return (real as any).evaluateDecision({ ...input, expectedReturnPercent: expected });
      }
    };
  });

  vi.doMock('./evidence-informed-decision-policy', () => ({ __esModule: true, default: (input: any) => ({ recommendedAction: (input && input.currentAction) ? input.currentAction : 'HOLD', recommendedConfidence: 80, agreesWithCurrentDecision: true, rationale: [], blockingFactors: [] }) }));

  // evaluator spy (must not be called during aggregation)
  const evalMock = vi.fn(()=>{ throw new Error('evaluateShadowDecisionOutcome must not be called during aggregation'); });
  vi.doMock('./shadow-decision-outcome-evaluator', () => ({ __esModule: true, default: evalMock }));

  // Act: import runtime after mocks and temp cwd set
  const rtMod = await import('./demo-runtime');
  const runtime = rtMod as any;

  // Ensure isolated store is empty
  try{ await runtime.__clearAudits(); }catch(_){ }

  // Seed six evaluation audits into the isolated store
  const now = new Date().toISOString();
  const seeds = [
    { kind: 'EVALUATION', id: 'e_sh1', decision: { id: 'd1', symbol: 'T1', action: 'BUY', referencePrice: 100 }, evaluation: { shadowDecisionOutcome: { comparison: 'SHADOW_BETTER', actualScore: -1, shadowScore: 1 } }, timestamp: now, meta: { automatic: true } },
    { kind: 'EVALUATION', id: 'e_sh2', decision: { id: 'd2', symbol: 'T1', action: 'BUY', referencePrice: 100 }, evaluation: { shadowDecisionOutcome: { comparison: 'SHADOW_BETTER', actualScore: -1, shadowScore: 1 } }, timestamp: now, meta: { automatic: true } },
    { kind: 'EVALUATION', id: 'e_sh3', decision: { id: 'd3', symbol: 'T1', action: 'BUY', referencePrice: 100 }, evaluation: { shadowDecisionOutcome: { comparison: 'SHADOW_BETTER', actualScore: -1, shadowScore: 1 } }, timestamp: now, meta: { automatic: true } },
    { kind: 'EVALUATION', id: 'e_act', decision: { id: 'd4', symbol: 'T1', action: 'SELL', referencePrice: 100 }, evaluation: { shadowDecisionOutcome: { comparison: 'ACTUAL_BETTER', actualScore: 1, shadowScore: -1 } }, timestamp: now, meta: { automatic: true } },
    { kind: 'EVALUATION', id: 'e_eq', decision: { id: 'd5', symbol: 'T1', action: 'BUY', referencePrice: 100 }, evaluation: { shadowDecisionOutcome: { comparison: 'EQUAL', actualScore: 1, shadowScore: 1 } }, timestamp: now, meta: { automatic: true } },
    { kind: 'EVALUATION', id: 'e_ne', decision: { id: 'd6', symbol: 'T1', action: 'HOLD', referencePrice: null }, evaluation: { shadowDecisionOutcome: { comparison: 'NOT_EVALUABLE', actualScore: 0, shadowScore: 0 } }, timestamp: now, meta: { automatic: true } },
  ];
  try{ await runtime.__appendTestAudits(seeds); }catch(_){ }

  // Replace portfolio adapter with spy
  const applyExecution = vi.fn(async (exec:any)=> ({ availableCash: 100000 - (exec.notional || 0), totalValue: 100000 - (exec.notional || 0), holdings: [] }));
  runtime.__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, totalValue: 100000, holdings: [] }), applyExecution });

  // Run cycle
  const override = { quotes: [ { symbol: 'T1', price: 100 } ], portfolio: { availableCash: 100000, totalValue: 100000, holdings: [] } };
  const res = await runtime.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override });
  expect(res).toBeDefined();

  // DEBUG: inspect runtime.latestCycle for decisionSummary
  // eslint-disable-next-line no-console
  console.log('RUNTIME_LATEST_CYCLE', JSON.stringify(runtime.latestCycle || null, null, 2));

  // Read audits from isolated store via FileAuditStore (persisted under temp cwd)
  const { FileAuditStore } = rtMod as any;
  const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
  const fileStore = new FileAuditStore(auditPath);
  const all = Array.isArray(await fileStore.list()) ? await fileStore.list() : [];
  // DEBUG: inspect persisted audit count and kinds (temporary)
  // eslint-disable-next-line no-console
  console.log('PERSISTED_AUDIT_COUNT', (all || []).length);
  // eslint-disable-next-line no-console
  console.log('PERSISTED_AUDIT_KINDS', (all || []).map((a:any)=> { try{ const r = a && a.raw ? a.raw : a; return r && r.kind ? r.kind : '<none>'; }catch(_){ return '<err>'; } }));
  // eslint-disable-next-line no-console
  console.log('PERSISTED_AUDITS', (all || []).map((a:any)=> { try{ const r = a && a.raw ? a.raw : a; return { id: a && a.id ? a.id : null, kind: r && r.kind ? r.kind : null, keys: Object.keys(r || {}) }; }catch(_){ return { err:true }; } }));
  const found = Array.isArray(all) ? all.find((r:any)=> { const raw = r && r.raw ? r.raw : r; return raw && raw.kind === 'DECISION_SUMMARY'; }) : null;
  expect(found).toBeTruthy();

  const summary = found && found.raw && found.raw.summary ? found.raw.summary : null;
  expect(summary).toBeTruthy();

  const perf = summary.shadowPerformanceSummary as any;
  expect(perf).toBeDefined();

  // Assertions per user requirements
  expect(perf.evaluatedCount).toBe(5);
  expect(perf.shadowBetterCount).toBe(3);
  expect(perf.actualBetterCount).toBe(1);
  expect(perf.equalCount).toBe(1);
  expect(perf.notEvaluableCount).toBe(1);
  expect(perf.shadowBetterRate).toBe(60);
  expect(perf.actualBetterRate).toBe(20);
  expect(perf.actualTotalScore).toBe(-1);
  expect(perf.shadowTotalScore).toBe(3);
  expect(perf.netShadowAdvantage).toBe(4);
  expect(perf.assessment).toBe('SHADOW_SLIGHTLY_BETTER');

  // evaluator not called
  const evaluatorMod = await import('./shadow-decision-outcome-evaluator');
  expect((evaluatorMod.default as any).mock ? (evaluatorMod.default as any).mock.calls.length : 0).toBe(0);

  // existing summary still present
  expect(summary.decisionReasons || summary.decisions).toBeTruthy();

  // no execution audits produced by aggregation
  const execs = (all || []).filter((a:any)=> { const r = a && a.raw ? a.raw : a; return r && r.kind === 'EXECUTION'; });
  expect(execs.length).toBe(0);

  // portfolio applyExecution was not invoked by aggregation
  expect(applyExecution.mock.calls.length).toBe(0);
});
