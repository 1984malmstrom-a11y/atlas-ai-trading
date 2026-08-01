import { expect, it, vi } from 'vitest';

// Reset modules so mocks apply
vi.resetModules();

// Mock tradable instruments to two deterministic symbols
vi.doMock('../market-data/instruments', () => {
  const TRADABLE_INSTRUMENTS = [ { id: 't1', providerSymbol: 'T1', symbol: 'T1', enabled: true, marketDataEnabled: true, assetType: 'STOCK' }, { id: 't2', providerSymbol: 'T2', symbol: 'T2', enabled: true, marketDataEnabled: true, assetType: 'STOCK' } ];
  return { TRADABLE_INSTRUMENTS, findInstrumentById: (id: string) => TRADABLE_INSTRUMENTS.find((i:any)=> i.id === id) };
});

// Force NY market open
vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: (_d?: any) => ({ open: true }) }));

// Mock TwelveData provider and technical analysis so estimateExpectedReturn runs deterministically
vi.doMock('../market-data/twelve-data', () => ({
  TwelveDataMarketDataProvider: class {
    async getHistoricalDailyCloses(_sym: string, _days: number){
      return { closes: Array.from({ length: 30 }, (_,i) => 100 + i), dates: [] };
    }
  }
}));
vi.doMock('./technical', () => ({ default: (_: any[]) => ({ technicalMomentumPercent: 5, technicalScore: 10, momentumPercent: 5, trend: 'UP' }) }));
vi.doMock('./expected-return', () => ({ __esModule: true, default: (_: any) => ({ expectedReturnPercent: 20 }) }));

// Wrap DecisionEngine to make T1 resolved as BUY and T2 as SELL
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

// Mock evidence-informed-policy to recommend HOLD for low-confidence decisions and agree for high-confidence
vi.doMock('./evidence-informed-decision-policy', () => ({
  __esModule: true,
  default: (input: any) => {
    const conf = typeof input && typeof input.currentConfidence === 'number' ? Number(input.currentConfidence) : 0;
    const current = String(input && input.currentAction ? input.currentAction : 'HOLD');
    if (conf >= 80) return { recommendedAction: current === 'BUY' || current === 'SELL' ? current : 'HOLD', recommendedConfidence: conf, agreesWithCurrentDecision: true, rationale: ['high_confidence'], blockingFactors: ['None'] };
    // low confidence -> recommend HOLD to induce disagreement when current is BUY/SELL
    return { recommendedAction: 'HOLD', recommendedConfidence: Math.max(20, conf), agreesWithCurrentDecision: current === 'HOLD', rationale: ['low_confidence'], blockingFactors: ['None'] };
  }
}));

it('runtime: shadowDecisionSummary counts agreements and disagreements and preserves actual actions', async ()=>{
  const rtMod = await import('./demo-runtime');
  const runtime = rtMod as any;

  // Clear audits and set deterministic portfolio
  try{ await runtime.__clearAudits(); }catch(_){ }
  // Append prior evaluations so buy-on-dip logic can create BUY candidates
  try{ await runtime.__appendTestAudits([
    { kind: 'EVALUATION', id: `eval_T1_${Date.now()}`, decision: { id: `eval_T1`, symbol: 'T1', action: 'HOLD', confidence: 0, referencePrice: 102, generatedAt: new Date().toISOString() }, timestamp: new Date().toISOString(), meta: { automatic: true } },
    { kind: 'EVALUATION', id: `eval_T2_${Date.now()}`, decision: { id: `eval_T2`, symbol: 'T2', action: 'HOLD', confidence: 0, referencePrice: 102, generatedAt: new Date().toISOString() }, timestamp: new Date().toISOString(), meta: { automatic: true } }
  ]); }catch(_){ }
  runtime.__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, totalValue: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 - (exec.notional || 0), totalValue: 100000 - (exec.notional || 0), holdings: [] }) });

  // Run one manual cycle with override quotes
  const override = { quotes: [ { symbol: 'T1', price: 100 }, { symbol: 'T2', price: 100 } ], portfolio: { availableCash: 100000, totalValue: 100000, holdings: [] } };
  // Mock TwelveData and technical analysis so estimateExpectedReturn can run
  // Ensure the real modules are available to demo-runtime imports - provide simple deterministic behavior
  // (done via environment-level imports in other tests is sufficient here)
  const res = await runtime.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override });
  expect(res).toBeDefined();
  if (res && (res as any).skipped) throw new Error('Cycle skipped: ' + JSON.stringify(res));

  const summary = (res && (res as any).decisionSummary) || (runtime.latestCycle && runtime.latestCycle.decisionSummary) || null;
  if (!summary) throw new Error('No decisionSummary; res=' + JSON.stringify(res) + ' latestCycle=' + JSON.stringify(runtime.latestCycle));
  const s = summary as any;
  expect(s.decisionReasons).toBeDefined();
  const drs = Array.isArray(s.decisionReasons) ? s.decisionReasons : [];

  // Each decisionReason should have evidenceInformedDecision attached
  const evaluated = drs.filter((d:any)=> d && d.evidenceInformedDecision);
  expect(evaluated.length).toBeGreaterThanOrEqual(2);

  const sd = s.shadowDecisionSummary;
  expect(sd).toBeDefined();
  // evaluatedCount should match
  expect(sd.evaluatedCount).toBe(evaluated.length);

  // We mocked T1 to BUY and policy to recommend BUY -> agreement
  // We mocked T2 to SELL and policy to recommend HOLD -> disagreement
  // Check distribution and transitions
  expect(sd.recommendedActionDistribution).toBeDefined();
  expect(sd.recommendedActionDistribution.BUY).toBeGreaterThanOrEqual(1);
  expect(sd.recommendedActionDistribution.HOLD).toBeGreaterThanOrEqual(1);

  // Ensure at least one agreement and one disagreement exist
  const agreements = drs.filter((d:any)=> d && d.evidenceInformedDecision && d.action === d.evidenceInformedDecision.recommendedAction);
  const disagreements = drs.filter((d:any)=> d && d.evidenceInformedDecision && d.action !== d.evidenceInformedDecision.recommendedAction);
  expect(agreements.length).toBeGreaterThanOrEqual(1);
  expect(disagreements.length).toBeGreaterThanOrEqual(1);
  // disagreementByTransition should include at least one recorded transition
  expect(Object.keys(sd.disagreementByTransition).length).toBeGreaterThanOrEqual(1);

  // agreementRate deterministic
  const expectedAgreementRate = sd.evaluatedCount === 0 ? 0 : Math.round((sd.agreementCount / sd.evaluatedCount) * 100);
  expect(sd.agreementRate).toBe(expectedAgreementRate);
});

it('runtime: zero evaluated decisions produce safe empty shadow summary', async ()=>{
  vi.resetModules();
  // Mock instruments to one symbol
  vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 't1', providerSymbol: 'T1', symbol: 'T1', enabled: true, marketDataEnabled: true, assetType: 'STOCK' } ] }));
  vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: (_d?: any) => ({ open: true }) }));
  // Mock evidence policy to return null (no evidence attached)
  vi.doMock('./evidence-informed-decision-policy', () => ({ __esModule: true, default: (_: any) => null }));

  // Also mock TwelveData/technical/expected-return and append prior evaluation so cycle produces a summary
  vi.doMock('../market-data/twelve-data', () => ({
    TwelveDataMarketDataProvider: class {
      async getHistoricalDailyCloses(_sym: string, _days: number){
        return { closes: Array.from({ length: 30 }, (_,i) => 100 + i), dates: [] };
      }
    }
  }));
  vi.doMock('./technical', () => ({ default: (_: any[]) => ({ technicalMomentumPercent: 5, technicalScore: 10, momentumPercent: 5, trend: 'UP' }) }));
  vi.doMock('./expected-return', () => ({ __esModule: true, default: (_: any) => ({ expectedReturnPercent: 20 }) }));

  const rtMod = await import('./demo-runtime');
  const runtime = rtMod as any;
  try{ await runtime.__clearAudits(); }catch(_){ }
  try{ await runtime.__appendTestAudits([
    { kind: 'EVALUATION', id: `eval_T1_${Date.now()}`, decision: { id: `eval_T1`, symbol: 'T1', action: 'HOLD', confidence: 0, referencePrice: 102, generatedAt: new Date().toISOString() }, timestamp: new Date().toISOString(), meta: { automatic: true } }
  ]); }catch(_){ }
  runtime.__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, totalValue: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 - (exec.notional || 0), totalValue: 100000 - (exec.notional || 0), holdings: [] }) });
  const override = { quotes: [ { symbol: 'T1', price: 100 } ], portfolio: { availableCash: 100000, totalValue: 100000, holdings: [] } };
  const res = await runtime.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override });
  expect(res).toBeDefined();
  if (res && (res as any).skipped) throw new Error('Cycle skipped: ' + JSON.stringify(res));
  const summary = (res && (res as any).decisionSummary) || (runtime.latestCycle && runtime.latestCycle.decisionSummary) || null;
  if (!summary) throw new Error('No decisionSummary; res=' + JSON.stringify(res) + ' latestCycle=' + JSON.stringify(runtime.latestCycle));
  const sd = summary && (summary as any).shadowDecisionSummary ? (summary as any).shadowDecisionSummary : null;
  expect(sd).toBeDefined();
  expect(sd.evaluatedCount).toBe(0);
  expect(sd.agreementCount).toBe(0);
  expect(sd.disagreementCount).toBe(0);
  expect(sd.agreementRate).toBe(0);
  // distribution should include keys
  expect(sd.recommendedActionDistribution).toBeDefined();
  expect(typeof sd.recommendedActionDistribution.BUY).toBe('number');
  expect(typeof sd.recommendedActionDistribution.SELL).toBe('number');
  expect(typeof sd.recommendedActionDistribution.HOLD).toBe('number');
  // disagreements empty object
  expect(sd.disagreementByTransition && Object.keys(sd.disagreementByTransition).length === 0).toBeTruthy();
});
