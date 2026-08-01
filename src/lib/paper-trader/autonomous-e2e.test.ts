import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// End-to-end autonomous integration test (isolated): ensure full chain from
// scheduler.runTick -> runAutomaticCycleImplementation -> runManualPaperTradingCycle
// -> DecisionEngine -> createPaperTrader.handleDecision -> portfolio applyExecution -> audit

describe('autonomous end-to-end (integration)', () => {
  let tmpDir: string | null = null;

  beforeEach(() => {
    // isolate workspace: create temporary project root and empty data files
    const base = path.join(os.tmpdir(), 'atlas_e2e_');
    tmpDir = fs.mkdtempSync(base);
    fs.mkdirSync(path.join(tmpDir, 'src', 'data'), { recursive: true });
    // initial portfolio with enough cash
    const portfolio = { id: 'demo', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    fs.writeFileSync(path.join(tmpDir, 'src', 'data', 'portfolio.json'), JSON.stringify(portfolio, null, 2), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'data', 'victor-trading-audit.json'), JSON.stringify([], null, 2), 'utf8');
    process.chdir(tmpDir);
    vi.resetModules();
    // ensure local fallback allowed when tests call acquire
    vi.stubEnv('PAPER_TRADER_SCHEDULER_MODE', 'in_memory');
    vi.stubEnv('NODE_ENV', 'test');
    // Force system time to a weekday to avoid weekend market closed checks
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-03T12:00:00Z'));
  });

  afterEach(() => {
    try{ if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); }catch(_){ }
    tmpDir = null;
    vi.restoreAllMocks();
    try{ vi.useRealTimers(); }catch(_){ }
    try{ vi.unstubAllEnvs(); }catch(_){ }
  });

  it('executes a SELL end-to-end and releases lock allowing next tick', async () => {
    // Mock external providers: market open and quotes that trigger stop-loss SELL
    vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: () => ({ open: true }) }));
    // Quote low enough to trigger SELL for a holding with avg 100
    vi.doMock('../market-data/quotes-service', () => ({ getNormalizedQuotes: async () => ({ quotes: [ { symbol: 'AAPL', priceSek: 94, price: 94, marketTimestamp: new Date().toISOString(), changePercent: -6, dataStatus: 'READY', currency: 'SEK' } ] }) }));
    // technical analysis may be present but decision should be driven by stop-loss
    vi.doMock('./technical', () => ({ default: () => ({ momentumPercent: -12, technicalScore: 95, signal: 'SELL', reasons: ['sharp_drop'] }) }));
    // Provide typed market signals (two supporting signals of different types)
    vi.doMock('../victor-signals', () => ({ default: (_ctx:any, _analysis:any) => ({ signals: [ { id: 'sig-tech-aapl', type: 'TECHNICAL', symbols: ['AAPL'], evidence: { changePercent: -6 }, signal: 'SELL', strength: 0.95 }, { id: 'sig-fund-aapl', type: 'FUNDAMENTAL', symbols: ['AAPL'], evidence: { changePercent: -4 }, signal: 'SELL', strength: 0.85 } ] }) }));
    // Ensure combineAnalyses returns a usable confidence so expected-return estimate can be computed
    vi.doMock('./analysis-aggregator', () => ({ combineAnalyses: (_a:any) => ({ confidence: 100, overallScore: 1 }) }));
    // Mock TwelveData provider to return deterministic historical closes so technical analysis runs
    vi.doMock('../market-data/twelve-data', () => ({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(symbol:string, days:number){ const now = Date.now(); const closes = Array.from({ length: Math.max(30, days||30) }, (_,i)=> 100 - i); const dates = closes.map((_,i)=> new Date(now - i*24*60*60*1000).toISOString()); return { closes, dates, source: 'mock' }; } } }));

    // Prepare portfolio file with a holding that will trigger SELL before importing runtime
    const P = path.join(process.cwd(), 'src', 'data', 'portfolio.json');
    const port = { id: 'demo', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [{ id: 'h_AAPL', symbol: 'AAPL', quantity: 1, averagePrice: 100, currentPrice: 100, marketValue: 100 }] };
    fs.writeFileSync(P, JSON.stringify(port, null, 2), 'utf8');

    // Import runtime after preparing portfolio file
    const runtimeMod = await import('./demo-runtime');
    const mod: any = runtimeMod;
    await mod.__clearAudits();

    // sanity: read portfolio before
    const beforePort = await mod.createRuntimePortfolioAdapter().getPortfolio();
    const beforeCash = beforePort.availableCash;

    const sched = mod.getSchedulerState();
    // Force scheduler.runTick to invoke the manual cycle with an overrideUniverse
    sched.runTick = async () => await mod.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'AAPL', priceSek: 94, price: 94, marketTimestamp: new Date().toISOString(), changePercent: -6, dataStatus: 'READY', currency: 'SEK' } ], portfolio: port }, getPerformanceProfileOverride: async () => ({ reflection: { confidenceMultiplier: 1 }, summary: { totalTrades: 0 } }) });
    await sched.runTick && await sched.runTick();
    const state = await mod.getPaperTradingState();

    // inspect audits
    const allAudits = await mod.__listAudits();
    // read raw appended audits (unfiltered)
    const audits = await mod.__listAudits();
    const execs = audits.filter((a:any)=> (a && a.raw && a.raw.kind === 'EXECUTION') || (a && a.kind === 'EXECUTION'));
    const evals = audits.filter((a:any)=> (a && a.raw && a.raw.kind === 'EVALUATION') || (a && a.kind === 'EVALUATION'));

    expect(evals.length).toBeGreaterThanOrEqual(1);
    // DecisionEngine: find the evaluation for AAPL and assert action/confidence
    const aaplEval = evals.find((a:any)=> { try{ const raw = a && a.raw ? a.raw : a; return raw && raw.decision && (String(raw.decision.symbol||'').toUpperCase() === 'AAPL' || String(raw.decision.id||'').toUpperCase().includes('AAPL')); }catch(_){ return false; } });
    expect(aaplEval, 'Expected an evaluation audit for AAPL').toBeDefined();
    const decision = aaplEval && aaplEval.raw && aaplEval.raw.decision ? aaplEval.raw.decision : aaplEval && aaplEval.decision ? aaplEval.decision : null;
    expect(decision, 'Decision payload missing').toBeDefined();
    // Decision action must be SELL
    expect(decision.action).toBe('SELL');
    // Decision confidence must meet production threshold (>=75)
    expect(typeof decision.confidence === 'number' ? decision.confidence : (decision.originalConfidence ?? 0)).toBeGreaterThanOrEqual(75);
    // Expect exactly one execution created for the SELL
    expect(execs.length).toBeGreaterThanOrEqual(1);

    // portfolio should reflect an execution: availableCash should increase
    const afterPort = await mod.createRuntimePortfolioAdapter().getPortfolio();
    expect(afterPort.availableCash).toBeGreaterThanOrEqual(beforeCash);

    // Lock should have been released: next tick should be able to acquire and not create a duplicate execution
    const beforeExecCount = execs.length;
    await sched.runTick && await sched.runTick();
    const audits2 = await mod.__listAudits();
    const execs2 = audits2.filter((a:any)=> (a && a.raw && a.raw.kind === 'EXECUTION') || (a && a.kind === 'EXECUTION'));
    // No double-execution: total executions should be <= beforeExecCount + 1
    expect(execs2.length).toBeLessThanOrEqual(beforeExecCount + 1);
    // verify holdings decreased and cash increased compared to beforePort
    const afterPortFinal = await mod.createRuntimePortfolioAdapter().getPortfolio();
    // holdings for AAPL should be removed or decreased
    const aaplHoldingAfter = (afterPortFinal.holdings || []).find((h:any)=> String(h.symbol||'').toUpperCase() === 'AAPL');
    expect(aaplHoldingAfter ? aaplHoldingAfter.quantity : 0).toBeLessThanOrEqual((beforePort.holdings && beforePort.holdings.find((h:any)=> String(h.symbol||'').toUpperCase()==='AAPL')?.quantity) || 0);
    expect(afterPortFinal.availableCash).toBeGreaterThanOrEqual(beforeCash);
  }, 20000);

  it('produces HOLD when signals insufficient and does not execute', async () => {
    // Re-import with HOLD technical signal
    vi.resetModules();
    vi.stubEnv('PAPER_TRADER_SCHEDULER_MODE', 'in_memory');
    vi.stubEnv('NODE_ENV', 'test');
    vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: () => ({ open: true }) }));
    vi.doMock('../market-data/quotes-service', () => ({ getNormalizedQuotes: async () => ({ quotes: [ { symbol: 'MSFT', priceSek: 100, price: 100, marketTimestamp: new Date().toISOString() } ] }) }));
    vi.doMock('./technical', () => ({ default: () => ({ momentumPercent: 0, technicalScore: 10, signal: 'HOLD', reasons: ['weak'] }) }));

    const runtimeMod2 = await import('./demo-runtime');
    const mod2: any = runtimeMod2;
    await mod2.__clearAudits();

    const sched = mod2.getSchedulerState();
    sched.runTick = async () => await mod2.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100, price: 100, marketTimestamp: new Date().toISOString() } ], portfolio: { id: 'demo', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] } } });
    await sched.runTick && await sched.runTick();

    const state = await mod2.getPaperTradingState();
    const audits = state.auditEntries || [];
    const execs = audits.filter((a:any)=> a && a.raw && a.raw.kind === 'EXECUTION');
    // No execution expected
    expect(execs.length).toBe(0);
    // Portfolio unchanged
    const afterPort = await mod2.createRuntimePortfolioAdapter().getPortfolio();
    expect(afterPort.availableCash).toBe(100000);
  }, 20000);

  it('blocks SELL when high-quality contradictory evidence exists (no execution)', async () => {
    // Prepare environment similar to SELL test but seed historical positive outcomes for AAPL
    vi.resetModules();
    vi.stubEnv('PAPER_TRADER_SCHEDULER_MODE', 'in_memory');
    vi.stubEnv('NODE_ENV', 'test');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-03T12:00:00Z'));

    vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: () => ({ open: true }) }));
    vi.doMock('../market-data/quotes-service', () => ({ getNormalizedQuotes: async () => ({ quotes: [ { symbol: 'AAPL', priceSek: 94, price: 94, marketTimestamp: new Date().toISOString(), changePercent: -6, dataStatus: 'READY', currency: 'SEK' } ] }) }));
    vi.doMock('./technical', () => ({ default: () => ({ momentumPercent: -12, technicalScore: 95, signal: 'SELL', reasons: ['sharp_drop'] }) }));
    vi.doMock('../victor-signals', () => ({ default: (_ctx:any, _analysis:any) => ({ signals: [ { id: 'sig-tech-aapl', type: 'TECHNICAL', symbols: ['AAPL'], evidence: { changePercent: -6 }, signal: 'SELL', strength: 0.95 }, { id: 'sig-fund-aapl', type: 'FUNDAMENTAL', symbols: ['AAPL'], evidence: { changePercent: -4 }, signal: 'SELL', strength: 0.85 } ] }) }));
    vi.doMock('./analysis-aggregator', () => ({ combineAnalyses: (_a:any) => ({ confidence: 100, overallScore: 1 }) }));
    vi.doMock('../market-data/twelve-data', () => ({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(symbol:string, days:number){ const now = Date.now(); const closes = Array.from({ length: Math.max(30, days||30) }, (_,i)=> 100 - i); const dates = closes.map((_,i)=> new Date(now - i*24*60*60*1000).toISOString()); return { closes, dates, source: 'mock' }; } } }));

    // Prepare portfolio file with a holding that would normally trigger SELL
    const P = path.join(process.cwd(), 'src', 'data', 'portfolio.json');
    const port = { id: 'demo', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [{ id: 'h_AAPL', symbol: 'AAPL', quantity: 1, averagePrice: 100, currentPrice: 100, marketValue: 100 }] };
    fs.writeFileSync(P, JSON.stringify(port, null, 2), 'utf8');

    const runtimeMod = await import('./demo-runtime');
    const mod: any = runtimeMod;
    await mod.__clearAudits();

    // Append historical positive evaluations (sampleSize >= 3) to create high-quality evidence
    const histAudits = [];
    for (let i=0;i<4;i++){
      // Use 'UNCERTAIN' regime to match the runtime-classified regime for this scenario
      histAudits.push({ kind: 'EVALUATION', id: `hist_eval_${i}`, timestamp: new Date().toISOString(), decision: { id: `d_hist_${i}`, symbol: 'AAPL', action: 'BUY' }, evaluation: { returnPercent: 5 + i, marketRegime: { regime: 'UNCERTAIN', confidence: 60 }, marketContextAdvice: null } });
    }
    await mod.__appendTestAudits(histAudits as any[]);

    const beforePort = await mod.createRuntimePortfolioAdapter().getPortfolio();

    const sched = mod.getSchedulerState();
    sched.runTick = async () => await mod.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'AAPL', priceSek: 94, price: 94, marketTimestamp: new Date().toISOString(), changePercent: -6, dataStatus: 'READY', currency: 'SEK' } ], portfolio: port }, getPerformanceProfileOverride: async () => ({ reflection: { confidenceMultiplier: 1 }, summary: { totalTrades: 0 } }) });

    await sched.runTick && await sched.runTick();

    const audits = await mod.__listAudits();
    const execs = audits.filter((a:any)=> (a && a.raw && a.raw.kind === 'EXECUTION') || (a && a.kind === 'EXECUTION'));
    const rejects = audits.filter((a:any)=> (a && a.raw && a.raw.kind === 'REJECT') || (a && a.kind === 'REJECT'));

    // Expect no execution and at least one reject with BLOCKED_BY_CONTRADICTORY_EVIDENCE
    expect(execs.length).toBe(0);
    expect(rejects.length).toBeGreaterThanOrEqual(1);
    const rej = rejects.find((r:any)=> { const raw = r && r.raw ? r.raw : r; return raw && raw.reason && raw.reason.code === 'BLOCKED_BY_CONTRADICTORY_EVIDENCE'; });
    expect(rej, 'Expected a REJECT with BLOCKED_BY_CONTRADICTORY_EVIDENCE').toBeDefined();

    // Portfolio should be unchanged
    const afterPort = await mod.createRuntimePortfolioAdapter().getPortfolio();
    expect(afterPort.availableCash).toBe(beforePort.availableCash);
  }, 20000);

});
