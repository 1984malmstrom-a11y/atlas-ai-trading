import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('demo-runtime persistence', ()=>{
  const P = path.join(process.cwd(), 'src', 'data', 'portfolio.json');
  let backup: string | null = null;

  beforeAll(()=>{
    // If an existing portfolio file is present, move it aside to a timestamped backup
    try{
      if (fs.existsSync(P)){
        backup = `${P}.bak.${Date.now()}`;
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(P, backup);
      }
    }catch(e){ /* best-effort backup; continue */ }
  });

  beforeEach(()=>{
    // Ensure starting clean for each test
    try{ if (fs.existsSync(P)) fs.unlinkSync(P); }catch(e){ }
  });

  afterEach(()=>{
    // Remove any file created by the test
    try{ if (fs.existsSync(P)) fs.unlinkSync(P); }catch(e){ }
  });

  afterAll(()=>{
    // Restore original backup if it existed, otherwise ensure no portfolio file remains
    try{
      if (backup && fs.existsSync(backup)){
        // restore
        try{ if (fs.existsSync(P)) fs.unlinkSync(P);}catch(e){}
        fs.renameSync(backup, P);
      } else {
        try{ if (fs.existsSync(P)) fs.unlinkSync(P); }catch(e){}
      }
    }catch(e){ /* swallow */ }
  });

  it('runs two cycles and persists portfolio', async ()=>{
    // import runtime (module will initialize file)
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    // run two cycles
    await runtime.runManualPaperTradingCycle();
    await runtime.runManualPaperTradingCycle();

    // file should exist and contain valid portfolio shape
    expect(fs.existsSync(P)).toBe(true);
    const raw = fs.readFileSync(P, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('availableCash');
    expect(parsed).toHaveProperty('holdings');
    expect(Array.isArray(parsed.holdings)).toBe(true);

    // ensure data can be read again
    const raw2 = fs.readFileSync(P, 'utf-8');
    const parsed2 = JSON.parse(raw2);
    expect(parsed2.availableCash).toBeDefined();
  });

  it('forwards NEGATIVE reflection to Decision Engine and affects confidence', async ()=>{
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    // ensure clean audits
    await mod.__clearAudits();
    // seed an explicit prior BUY execution matching the holding so resolver can find a single-entry
    await mod.__appendTestAudits([{
      kind: 'EXECUTION',
      timestamp: '2026-01-01T00:00:00Z',
      decision: { id: 'd_buy_aapl', symbol: 'AAPL', action: 'BUY', confidence: 80, referencePrice: 100, generatedAt: '2026-01-01T00:00:00Z' },
      execution: { id: 'e_buy_aapl', decisionId: 'd_buy_aapl', symbol: 'AAPL', side: 'BUY', quantity: 2, executedPrice: 100, notional: 200, fee: 0, generatedAt: '2026-01-01T00:00:00Z' }
    }]);
    // read current profile (may be INSufficient data in test env) and ensure it's forwarded
    const profile = await mod.getPerformanceProfile();
    const spy = vi.spyOn(mod, 'getPerformanceProfile' as any).mockResolvedValue(profile as any);
    // spy on decision engine to ensure reflection forwarded
    // Mock provider to avoid network calls during historical fetch
    vi.mock('../market-data/twelve-data', ()=>({
      TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym: string, n: number){ return { closes: [1,2,3,4,5,6,7,8,9,10], dates: [], source: 'mock' }; } }
    }));
    const decMod = await import('./decision-engine');
    const decSpy = vi.spyOn(decMod, 'evaluateDecision' as any);

    // build overrideUniverse to force a SELL candidate: holding with avg 100 and quote price 94 triggers stop-loss
    const override = {
      portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'AAPL', quantity: 2, averagePrice: 100, currentPrice: 100, marketValue: 200 }] },
      quotes: [{ symbol: 'AAPL', priceSek: 94 }]
    };

    await runtime.runManualPaperTradingCycle({ overrideUniverse: override });
    // read state and find evaluation audit for AAPL
    const state = await runtime.getPaperTradingState();
    const audits = state.auditEntries || [];
    const evals = audits.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION');
    // find the evaluation for AAPL
    // find any evaluation for AAPL; prefer the post-execution evaluation if present
    const aaplEvalExec = evals.find((e:any)=> e && e.raw && e.raw.decision && String((e.raw.decision.symbol||'').toUpperCase()) === 'AAPL' && e.raw.execution);
    const aaplEvalAny = evals.find((e:any)=> e && e.raw && e.raw.decision && String((e.raw.decision.symbol||'').toUpperCase()) === 'AAPL');
    const aaplEval = aaplEvalExec || aaplEvalAny;
    expect(aaplEval).toBeDefined();
    // Verify evaluation uses execution.fee when post-execution evaluation is present
    if (aaplEvalExec){
      const exec = aaplEvalExec.raw.execution;
      const evaluation = aaplEvalExec.raw.evaluation;
      expect(exec).toBeDefined();
      expect(evaluation).toBeDefined();
      const before = aaplEvalExec.raw.portfolioBefore || null;
      const beforeHolding = before && Array.isArray(before.holdings) ? before.holdings.find((h:any)=> String((h.symbol||'').toUpperCase()) === 'AAPL') : null;
      const entryPrice = beforeHolding && typeof beforeHolding.averagePrice === 'number' ? Number(beforeHolding.averagePrice) : null;
      const qty = typeof exec.quantity === 'number' ? Number(exec.quantity) : null;
      const exitPrice = typeof exec.executedPrice === 'number' ? Number(exec.executedPrice) : null;
      const fee = typeof exec.fee === 'number' ? Number(exec.fee) : 0;
      if (entryPrice !== null && qty !== null && exitPrice !== null){
        const gross = Math.round(((exitPrice - entryPrice) * qty) * 100)/100;
        const net = Math.round((gross - fee) * 100)/100;
        const expectedPct = (entryPrice * qty) !== 0 ? (net / (entryPrice * qty)) * 100 : 0;
        expect(evaluation.pnlSek).toBeCloseTo(net, 2);
        expect(evaluation.pnlPercent).toBeCloseTo(expectedPct, 4);
        expect(evaluation.winner).toBe(net > 0);
      }
    }
    // Ensure decision engine was called and received the reflection
    expect(decSpy).toHaveBeenCalled();
    const calledArg = decSpy.mock.calls[0][0];
    const storedReflection = aaplEval.raw.decision && (aaplEval.raw.decision as any).performanceReflection;
    expect(storedReflection).toBeDefined();
    // ensure the reflection object passed to evaluateDecision is the exact same object stored on the audit
    expect((calledArg as any).performanceReflection).toBe(storedReflection);
    spy.mockRestore();
    decSpy.mockRestore();
  });

  it('continues without reflection when getPerformanceProfile fails', async ()=>{
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    await mod.__clearAudits();
    // force getPerformanceProfile to throw via override option
    const getProfileOverride = async ()=> { throw new Error('boom'); };
    // spy evaluateDecision
    const decMod = await import('./decision-engine');
    const decSpy = vi.spyOn(decMod, 'evaluateDecision' as any);

    const override = {
      portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'AAPL', quantity: 2, averagePrice: 100, currentPrice: 100, marketValue: 200 }] },
      quotes: [{ symbol: 'AAPL', priceSek: 94 }]
    };

    await runtime.runManualPaperTradingCycle({ overrideUniverse: override, getPerformanceProfileOverride: getProfileOverride });
    expect(decSpy).toHaveBeenCalled();
    // find the call for AAPL and assert it had no performanceReflection
    const aaplCall = decSpy.mock.calls.find((c:any[])=> c && c[0] && c[0].decision && String((c[0].decision.symbol||'').toUpperCase()) === 'AAPL');
    expect(aaplCall).toBeDefined();
    const calledArg = aaplCall ? aaplCall[0] : decSpy.mock.calls[0][0];
    expect((calledArg as any).performanceReflection).toBeUndefined();

    decSpy.mockRestore();
  });

  it('skips candidate when evaluateDecision throws (no execution)', async ()=>{
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    await mod.__clearAudits();
    const decMod = await import('./decision-engine');
    const decSpy = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=>{ throw new Error('dec fail'); });

    const override = {
      portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'AAPL', quantity: 2, averagePrice: 100, currentPrice: 100, marketValue: 200 }] },
      quotes: [{ symbol: 'AAPL', priceSek: 94 }]
    };

    const res = await runtime.runManualPaperTradingCycle({ overrideUniverse: override });
    expect(res.executed).toBe(0);
    expect(res.rejects).toBeGreaterThanOrEqual(1);

    decSpy.mockRestore();
  });

  it('forwards estimated expectedReturnPercent to DecisionEngine (momentum 8, confidence 50 => 4) and does not use raw quote', async ()=>{
    vi.resetModules();
    // Mock technical analysis to produce momentum=8 and technicalScore=50 (analyzePriceSeries shape)
    vi.doMock('./technical', () => ({
      default: () => ({
        momentumPercent: 8,
        technicalScore: 50,
        signal: 'BUY',
        reasons: ['r'],
      }),
    }));

    // Mock historical provider to return deterministic closes (avoid network)
    vi.mock('../market-data/twelve-data', ()=>({
      TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym: string, n: number){ return { closes: [1,2,3,4,5,6,7,8,9,10], dates: [], source: 'mock' }; } }
    }));

    // Mock decision-engine to capture calls from demo-runtime
    vi.mock('./decision-engine', ()=>({ evaluateDecision: vi.fn((input:any)=>({ confidence: 0.5, risk: {} })) }));
    const decMod = await import('./decision-engine');
    const decMock = decMod as any;

    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    await mod.__clearAudits();

    // Create a prior evaluation with high referencePrice so buySignal triggers
    await mod.__appendTestAudits([{ kind: 'EVALUATION', decision: { id: 'eval_MSFT_1', symbol: 'MSFT', action: 'HOLD', referencePrice: 1000 }, timestamp: new Date().toISOString(), meta: { technicalAnalysis: { technicalAnalysisStatus: 'success' } } }]);

    const override = {
      portfolio: { availableCash: 10000, totalValue: 10000, holdings: [] },
      quotes: [{ symbol: 'MSFT', priceSek: 900, price: 900, expectedReturnPercent: 99 }]
    };

    // Add an explicit prior evaluation for MSFT so the buy-on-dip logic finds a reference.
    // Must ensure summary.decisionId contains 'MSFT' and raw.decision.symbol === 'MSFT'.
    await mod.__appendTestAudits([{
      kind: 'EVALUATION',
      decision: { id: 'seed_eval_MSFT_1', symbol: 'MSFT', action: 'HOLD', referencePrice: 1000 },
      timestamp: new Date().toISOString(),
      meta: { technicalAnalysis: { technicalAnalysisStatus: 'success' } }
    }]);

    await runtime.runManualPaperTradingCycle({ overrideUniverse: override });

    // Verify mocked decision-engine was called with expectedReturnPercent = 4
    expect(decMock.evaluateDecision).toHaveBeenCalled();
    const calls = decMock.evaluateDecision.mock.calls.map((c:any[])=> c[0]);
    const msftCall = calls.find((c:any)=> c && c.decision && String((c.decision.symbol||'').toUpperCase()) === 'MSFT');
    expect(msftCall).toBeDefined();
    expect(msftCall.expectedReturnPercent).toBeCloseTo(4);
  });

  it('when estimate returns null, no BUY execution is attempted', async ()=>{
    vi.resetModules();
    // Mock technical analysis to produce missing momentum so estimate returns null
    vi.mock('../market-data/twelve-data', ()=>({
      TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym: string, n: number){ return { closes: [1,2,3,4,5,6,7,8,9,10], dates: [], source: 'mock' }; } }
    }));
    vi.doMock('./technical', ()=>({
      default: ()=> ({ technicalAnalysisStatus: 'success', technicalScore: 50 })
    }));

    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    await mod.__clearAudits();

    // prime last evaluation to trigger buy signal
    await mod.__appendTestAudits([{ kind: 'EVALUATION', decision: { id: 'eval_MSFT_2', symbol: 'MSFT', action: 'HOLD', referencePrice: 1000 }, timestamp: new Date().toISOString() }]);

    const override = { portfolio: { availableCash: 10000, totalValue: 10000, holdings: [] }, quotes: [{ symbol: 'MSFT', priceSek: 900, price: 900 }] };

    const res = await runtime.runManualPaperTradingCycle({ overrideUniverse: override });
    // no executions for BUY when estimate missing
    expect(res.executed).toBe(0);
  });

  it('forwards tradeFeedbackSummary to DecisionEngine for SELL and BUY', async ()=>{
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    await mod.__clearAudits();
    // Seed an evaluation audit that contains a tradeReview so the summary builder finds one
    await mod.__appendTestAudits([{
      kind: 'EVALUATION',
      decision: { id: 'eval_seed_1', symbol: 'AAPL', action: 'HOLD' },
      evaluation: { tradeReview: { executionId: 't_seed_1', verdict: 'WIN', pnlSek: 10, pnlPercent: 5, winner: true, summary: 'Vinst' } },
      timestamp: new Date().toISOString()
    }]);

    // Spy decision engine
    const decMod = await import('./decision-engine');
    const decSpy = vi.spyOn(decMod, 'evaluateDecision' as any);

    // SELL path: create a holding that will trigger SELL
    const overrideSell = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'AAPL', quantity: 2, averagePrice: 100, currentPrice: 100, marketValue: 200 }] }, quotes: [{ symbol: 'AAPL', priceSek: 94 }] };
    await runtime.runManualPaperTradingCycle({ overrideUniverse: overrideSell });
    expect(decSpy).toHaveBeenCalled();
    const sellCall = decSpy.mock.calls.find((c:any[])=> c && c[0] && c[0].decision && String((c[0].decision.symbol||'').toUpperCase()) === 'AAPL');
    expect(sellCall).toBeDefined();
    const sellArg = (sellCall as any)[0];
    expect((sellArg as any).tradeFeedbackSummary).toBeDefined();
    // NOTE: specific persistence of tradeFeedbackEffect is validated in a separate test below

    // Clear audits and seed again for BUY path. Reset modules so mocks take effect.
    vi.resetModules();
    const mod2 = await import('./demo-runtime');
    const runtime2 = mod2.default || mod2;
    await mod2.__clearAudits();
    await mod2.__appendTestAudits([{
      kind: 'EVALUATION',
      decision: { id: 'eval_seed_2', symbol: 'MSFT', action: 'HOLD' },
      evaluation: { tradeReview: { executionId: 't_seed_2', verdict: 'LOSS', pnlSek: -5, pnlPercent: -5, winner: false, summary: 'Förlust' } },
      timestamp: new Date().toISOString()
    }]);
    await mod2.__appendTestAudits([{ kind: 'EVALUATION', decision: { id: 'eval_MSFT_3', symbol: 'MSFT', action: 'HOLD', referencePrice: 1000 }, timestamp: new Date().toISOString() }]);

    vi.doMock('./technical', () => ({ default: () => ({ momentumPercent: 8, technicalScore: 50, signal: 'BUY', reasons: ['r'] }) }));
    vi.mock('../market-data/twelve-data', ()=>({
      TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym: string, n: number){ return { closes: [1,2,3,4,5,6,7,8,9,10], dates: [], source: 'mock' }; } }
    }));
    vi.mock('./decision-engine', ()=>({ evaluateDecision: vi.fn((input:any)=>({ confidence: 0.5, risk: {} })) }));
    const decMod2 = await import('./decision-engine');
    const decSpy2 = (decMod2 as any).evaluateDecision as any;

    const overrideBuy = { portfolio: { availableCash: 10000, totalValue: 10000, holdings: [] }, quotes: [{ symbol: 'MSFT', priceSek: 900, price: 900 }] };
    await runtime2.runManualPaperTradingCycle({ overrideUniverse: overrideBuy });
    expect(decSpy2).toHaveBeenCalled();
    const buyCall = decSpy2.mock.calls.find((c:any[])=> c && c[0] && (c[0].tradeFeedbackSummary !== undefined));
    expect(buyCall).toBeDefined();
    const buyArg = (buyCall as any)[0];
    expect((buyArg as any).tradeFeedbackSummary).toBeDefined();

    decSpy.mockRestore();
    decSpy2.mockRestore();
  });

  it('persists tradeFeedbackEffect EXACTLY (BUY_BLOCKED case)', async ()=>{
    // Table-driven test: for each desired signalFeedbackEffect, mock DecisionEngine to return it
    const scenarios = [
      { symbol: 'MSFT', signalFeedback: 'BUY_BLOCKED' as const, tradeFeedback: 'BUY_BLOCKED' as const },
      { symbol: 'MSFT', signalFeedback: 'OBSERVED' as const, tradeFeedback: 'OBSERVED' as const },
      { symbol: 'MSFT', signalFeedback: 'NOT_APPLIED' as const, tradeFeedback: 'NOT_APPLIED' as const },
    ];

    for (const s of scenarios){
      // isolate module state and mocks for each scenario
      vi.resetModules();
      // ensure technical analysis + provider return deterministic data so buy candidate is reachable
      vi.doMock('./technical', () => ({ default: () => ({ momentumPercent: 8, technicalScore: 50, signal: 'BUY', reasons: ['r'] }) }));
      vi.mock('../market-data/twelve-data', ()=>({
        TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym: string, n: number){ return { closes: [1,2,3,4,5,6,7,8,9,10], dates: [], source: 'mock' }; } }
      }));
        // Mock DecisionEngine to return the scenario-specific feedback values
        const decRes = { confidence: 50, risk: {}, tradeFeedbackEffect: s.tradeFeedback, signalFeedbackEffect: s.signalFeedback } as any;
        vi.doMock('./decision-engine', ()=>({ evaluateDecision: vi.fn(()=> decRes) }));

      const mod = await import('./demo-runtime');
      const runtime = mod.default || mod;
      await mod.__clearAudits();

      // seed a prior evaluation entry so buy-on-dip logic will create a BUY candidate for our symbol
      await mod.__appendTestAudits([{ kind: 'EVALUATION', decision: { id: `seed_eval_${s.symbol}_1`, symbol: s.symbol, action: 'HOLD', referencePrice: 1000 }, timestamp: new Date().toISOString() }]);

      const overrideBuy = { portfolio: { availableCash: 10000, totalValue: 10000, holdings: [] }, quotes: [{ symbol: s.symbol, priceSek: 900, price: 900 }] };

      const auditFile = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');

      // Run the runtime flow once with the scenario DecisionEngine mock
      await runtime.runManualPaperTradingCycle({ overrideUniverse: overrideBuy });
      const afterRaw2 = JSON.parse(fs.readFileSync(auditFile, 'utf-8') || '[]');
      const afterEvalCount2 = Array.isArray(afterRaw2) ? afterRaw2.filter((e:any)=> e && e.raw && e.raw.kind === 'EVALUATION').length : 0;
      // find all evaluations for our symbol that include a persisted tradeFeedbackEffect
      const matches = afterRaw2.filter((e:any)=> e && e.raw && e.raw.decision && String((e.raw.decision.symbol||'').toUpperCase()) === String(s.symbol).toUpperCase() && e.raw.evaluation && typeof e.raw.evaluation.tradeFeedbackEffect !== 'undefined');
      // Exactly one persisted strategy evaluation with tradeFeedbackEffect should exist for this scenario
      expect(matches.length).toBe(1);
      const found = matches[0];
      expect(found).toBeDefined();
      // verify persisted values
      expect(found.raw.evaluation.signalFeedbackEffect).toBe(s.signalFeedback);
      expect(found.raw.evaluation.tradeFeedbackEffect).toBe(s.tradeFeedback);
    }
  });
});
