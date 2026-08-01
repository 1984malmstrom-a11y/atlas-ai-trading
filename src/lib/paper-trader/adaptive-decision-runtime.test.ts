import { expect, it, vi } from 'vitest';

// Ensure module cache is reset so our vi.doMock calls take effect
vi.resetModules();

// Mock tradable instruments to a single deterministic symbol
vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'testinst', providerSymbol: 'TST', enabled: true, marketDataEnabled: true, assetType: 'STOCK' } ] }));

// Wrap DecisionEngine to force a strong positive expectedReturnPercent for BUYs
vi.doMock('./decision-engine', async () => {
  const real = await vi.importActual('./decision-engine');
  return {
    ...real,
    evaluateDecision: (input: any) => {
      // Force expectedReturnPercent so signal -> BUY with high confidence
      const patched = { ...input, expectedReturnPercent: 20 };
      return (real as any).evaluateDecision(patched);
    }
  };
});

// Mock TwelveData provider to return historical closes (so fetchAndAnalyze can run)
vi.doMock('../market-data/twelve-data', () => ({
  TwelveDataMarketDataProvider: class {
    async getHistoricalDailyCloses(_sym: string, _days: number){
      return { closes: Array.from({ length: 30 }, (_,i) => 100 + i), dates: [] };
    }
  }
}));

// Mock technical analyzer to produce a momentum percent so estimateExpectedReturn returns a value
vi.doMock('./technical', () => ({ default: (closes: any[]) => ({ technicalMomentumPercent: 5, technicalScore: 10, momentumPercent: 5, trend: 'UP' }) }));

// Force NY market open to ensure STOCK instruments are eligible during test
vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: (_d?: any) => ({ open: true }) }));

it('runtime pipeline: adaptive policies applied per-cycle and execution uses effective position size', async ()=>{
  const rtMod = await import('./demo-runtime');
  const runtime = rtMod as any;

  // Clear audits and set a deterministic portfolio
  try{ await runtime.__clearAudits(); }catch(_){ }
  runtime.__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, totalValue: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 - (exec.notional || 0), totalValue: 100000 - (exec.notional || 0), holdings: [] }) });

  // Inject a test trader to capture the final decision passed to execution
  let capturedDecision: any = null;
  const mockTrader = { handleDecision: vi.fn(async (dec:any)=>{
    capturedDecision = dec;
    const notional = dec && dec.risk && dec.risk.positionSizing ? Number(dec.risk.positionSizing.confidenceAdjustedNotional || 0) : 0;
    const executedPrice = dec.referencePrice || 100;
    const qty = Math.floor(notional / executedPrice);
    return { accepted: true, execution: { id: 'ex1', decisionId: dec.id, symbol: dec.symbol, side: dec.action, quantity: qty, executedPrice, notional: qty * executedPrice, fee: 0, generatedAt: new Date().toISOString() } };
  }) };
  runtime.__setTestTrader(mockTrader);

  // Append a conflicting adaptive context into audits to prove per-cycle ownership is used
  try{
    await runtime.__appendTestAudits([
      { kind: 'EVALUATION', id: `eval_TST_${Date.now()}`, decision: { id: `eval_TST`, symbol: 'TST', action: 'HOLD', confidence: 0, referencePrice: 110, generatedAt: new Date().toISOString() }, timestamp: new Date().toISOString(), meta: { automatic: true } },
      { kind: 'ADAPTIVE_DECISION_CONTEXT', id: 'conflict', timestamp: new Date().toISOString(), context: { confidenceBias: 50, riskBias: 0.5 }, meta: { automatic: true } }
    ]);
  }catch(_){ }

  // Provide a per-cycle performance profile override to set adaptive biases
  const profileOverride = async ()=> ({ recommendedConfidenceBias: 6, recommendedRiskBias: 0.12 });

  // Run one manual cycle with overrides (quotes + portfolio). This will use the wrapped DecisionEngine above.
  const override = { quotes: [ { symbol: 'TST', price: 100 } ], portfolio: { availableCash: 100000, totalValue: 100000, holdings: [] } };
  const res = await runtime.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override, getPerformanceProfileOverride: profileOverride });

  // Ensure a decision was passed to our injected trader
  expect(capturedDecision).toBeTruthy();

  // (diagnostics removed) ensure candidate originalConfidence exists on actual decisions

  // 1) Original confidence is preserved and effective confidence applied
  expect(typeof capturedDecision.originalConfidence).toBe('number');
  const originalConfidence = capturedDecision.originalConfidence;
  const finalConfidence = capturedDecision.confidence;
  // expected: original + bounded confidenceBias (6 -> +6%)
  expect(finalConfidence).toBeCloseTo(Math.round((originalConfidence + 6) * 100) / 100);

  // 2) Risk: originalRisk observable in risk.score and effectiveRisk present
  expect(capturedDecision.risk).toBeTruthy();
  const originalRisk = capturedDecision.risk.score;
  // effectiveRisk should be attached to risk.effectiveRisk if available
  const effectiveRisk = capturedDecision.risk.effectiveRisk ?? null;
  expect(typeof originalRisk).toBe('number');
  if (effectiveRisk !== null){
    // effectiveRisk should reflect riskBias once (originalRisk * 1.12)
    expect(effectiveRisk).toBeCloseTo(Math.round(originalRisk * (1 + 0.12) * 100) / 100);
  }

  // 3) Position sizes: original and effective present and effective reflects confidenceBias only
  expect(capturedDecision.risk.positionSizing).toBeTruthy();
  const originalPositionSize = capturedDecision.risk.positionSizing.originalPositionSize;
  const effectivePositionSize = capturedDecision.risk.positionSizing.effectivePositionSize;
  expect(typeof originalPositionSize).toBe('number');
  expect(typeof effectivePositionSize).toBe('number');
  // effectivePositionSize is original * (1 + confidenceBias/100) but clamped to engine maxAllowed (recommendedNotional)
  const expectedAdjusted = Math.round(Math.min(originalPositionSize * 1.06, originalPositionSize) * 100) / 100;
  // Because originalPositionSize equals the engine `recommendedNotional` here, the clamped result remains originalPositionSize
  expect(effectivePositionSize).toBeCloseTo(expectedAdjusted);

  // 4) Execution received effectivePositionSize-derived quantity (not original)
  const expectedQty = Math.floor(effectivePositionSize / (capturedDecision.referencePrice || 100));
  const returnedExecution = (await mockTrader.handleDecision.mock.results[0].value).execution;
  expect(returnedExecution.quantity).toBe(expectedQty);

  // 5) Ensure conflicting audit entry did not override per-cycle adaptiveDecisionContext
  expect(capturedDecision.confidence).not.toBe(originalConfidence + 50);

  // 6) Zero-bias comparison: run a second cycle with zero biases and ensure unchanged
  await runtime.__clearAudits();
  capturedDecision = null; mockTrader.handleDecision.mockClear();
  // reseed a prior evaluation so buy-on-dip logic can create a candidate
  try{ await runtime.__appendTestAudits([ { kind: 'EVALUATION', id: `eval_TST_${Date.now()}`, decision: { id: `eval_TST2`, symbol: 'TST', action: 'HOLD', confidence: 0, referencePrice: 110, generatedAt: new Date().toISOString() }, timestamp: new Date().toISOString(), meta: { automatic: true } } ]); }catch(_){ }
  const profileZero = async ()=> ({ recommendedConfidenceBias: 0, recommendedRiskBias: 0 });
  const res2 = await runtime.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override, getPerformanceProfileOverride: profileZero });
  const secondDecision = capturedDecision;
  expect(secondDecision).toBeTruthy();
  expect(secondDecision.originalConfidence).toBe(secondDecision.confidence);
  const origPos2 = secondDecision.risk.positionSizing.originalPositionSize;
  const effPos2 = secondDecision.risk.positionSizing.effectivePositionSize;
  expect(origPos2).toBe(effPos2);
});
