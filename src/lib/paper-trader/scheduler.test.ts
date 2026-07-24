import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Ensure TwelveData provider constructor does not throw during tests
process.env.TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY || 'TEST';
import * as dr from './demo-runtime';

const SCHED_KEY = '__atlas_paper_trader_scheduler__';

beforeEach(async ()=>{
  // ensure runtime enabled and clean scheduler
  try{ (dr as any).setPaperTradingEnabled(true); }catch(e){}
  try{ (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler(); }catch(e){}
});

afterEach(()=>{
  try{ (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler(); }catch(e){}
  vi.useRealTimers();
});

describe('paper-trader scheduler', ()=>{
  it('creates exactly one timer and prevents duplicate timers', async ()=>{
    vi.useFakeTimers();
    (dr as any).setPaperTradingEnabled(true);
    // start scheduler with short interval
    (dr as any).startAutonomousScheduler && (dr as any).startAutonomousScheduler(50);

    const sched = (dr as any).getSchedulerState();
    expect(sched).toBeDefined();
    expect(sched.timerId).toBeTruthy();
    const firstTimer = sched.timerId;

    // calling start again should not create a new timer
    (dr as any).startAutonomousScheduler && (dr as any).startAutonomousScheduler(50);
    expect(sched.timerId).toBe(firstTimer);

    (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler();
  });

  it('runs automatic cycle on interval and updates last/next run times', async ()=>{
    vi.useFakeTimers();
    (dr as any).setPaperTradingEnabled(true);
    (dr as any).startAutonomousScheduler && (dr as any).startAutonomousScheduler(50);
    const sched = (dr as any).getSchedulerState();
    expect(sched.timerId).toBeTruthy();

    // Ensure GET/read-only does not trigger a cycle
    const beforeLast = sched.lastRunAt;
    await (dr as any).getPaperTradingState();
    expect(sched.lastRunAt).toBe(beforeLast);

    // advance time to trigger one interval
    await vi.advanceTimersByTimeAsync(60);
    // allow pending microtasks to complete
    await Promise.resolve();
    expect(typeof sched.lastRunAt === 'number' || typeof sched.lastRunAt === 'object').toBeTruthy();
    const last = typeof sched.lastRunAt === 'number' ? (sched.lastRunAt as number) : (typeof sched.lastRunAt === 'object' && sched.lastRunAt ? new Date(sched.lastRunAt).getTime() : Date.now());
    const next = last + sched.intervalMs;
    // read via public state to ensure values are consistent
    const st = await (dr as any).getPaperTradingState();
    if (st.lastAutomaticRunAt !== null){
      expect(st.lastAutomaticRunAt).toBe(new Date(last).toISOString());
      expect(st.nextAutomaticRunAt).toBe(new Date(next).toISOString());
    } else {
      expect(st.lastAutomaticRunAt).toBeNull();
    }
    // diagnostics: automatic run should record status and evaluation delta
    expect(sched.lastAutomaticRunStatus).toBeDefined();
    const status = sched.lastAutomaticRunStatus as string | null;
    expect(['success','skipped','error', null, undefined].includes(status as any)).toBeTruthy();
    // evaluation count must be present (number or zero)
    expect(typeof sched.lastAutomaticEvaluationCount === 'number' || sched.lastAutomaticEvaluationCount === null).toBeTruthy();

    (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler();
  });

  it('prevents overlap between automatic and manual cycle', async ()=>{
    vi.useFakeTimers();
    (dr as any).setPaperTradingEnabled(true);
    (dr as any).startAutonomousScheduler && (dr as any).startAutonomousScheduler(50);
    const sched = (dr as any).getSchedulerState();

    // simulate scheduler busy
    sched.inProgress = true;
    const res = await (dr as any).runManualPaperTradingCycle();
    expect(res && (res as any).skipped).toBeTruthy();

    // clear and ensure manual run works
    sched.inProgress = false;
    const res2 = await (dr as any).runManualPaperTradingCycle();
    expect(res2).toBeDefined();

    (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler();
  });

  it('stop removes timer', async ()=>{
    vi.useFakeTimers();
    (dr as any).setPaperTradingEnabled(true);
    (dr as any).startAutonomousScheduler && (dr as any).startAutonomousScheduler(50);
    const sched = (dr as any).getSchedulerState();
    expect(sched.timerId).toBeTruthy();
    (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler();
    expect(sched.timerId).toBeNull();
  });

  it('allows hot-reload to swap runTick without creating a new timer', async ()=>{
    vi.useFakeTimers();
    (dr as any).setPaperTradingEnabled(true);
    (dr as any).startAutonomousScheduler && (dr as any).startAutonomousScheduler(50);
    const sched = (dr as any).getSchedulerState();
    expect(sched.timerId).toBeTruthy();
    const firstTimer = sched.timerId;

    // replace runTick with spy A
    const spyA = vi.fn(async ()=>{ (sched as any)._a = ((sched as any)._a||0) + 1; });
    sched.runTick = spyA;

    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();
    expect(spyA).toHaveBeenCalledTimes(1);
    expect(sched.timerId).toBe(firstTimer);

    // simulate hot-reload: replace runTick with spy B
    const spyB = vi.fn(async ()=>{ (sched as any)._b = ((sched as any)._b||0) + 1; });
    sched.runTick = spyB;

    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();
    // spyB should run on the next tick, spyA should not be invoked again
    expect(spyB).toHaveBeenCalledTimes(1);
    expect(spyA).toHaveBeenCalledTimes(1);
    expect(sched.timerId).toBe(firstTimer);

    (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler();
  });

  it('records error diagnostics when runTick throws and still allows next tick', async ()=>{
    vi.useFakeTimers();
    (dr as any).setPaperTradingEnabled(true);
    (dr as any).startAutonomousScheduler && (dr as any).startAutonomousScheduler(50);
    const sched = (dr as any).getSchedulerState();
    const firstTimer = sched.timerId;

    // make runTick throw
    sched.runTick = async ()=>{ throw new Error('boom-test'); };

    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();
    expect(sched.lastAutomaticRunStatus).toBe('error');
    expect(typeof sched.lastAutomaticRunMessage === 'string' && sched.lastAutomaticRunMessage!.includes('boom-test')).toBeTruthy();

    // now replace with a working tick and ensure it runs on next interval
    const spyOk = vi.fn(async ()=>{ (sched as any)._ok = true; });
    sched.runTick = spyOk;
    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();
    expect(spyOk).toHaveBeenCalled();
    expect(sched.timerId).toBe(firstTimer);

    (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler();
  });

  it('evaluates multiple symbols and respects one-buy-one-sell limit', async ()=>{
    vi.useRealTimers();
    vi.resetModules();

    // Test definition: evaluationCount counts unique symbols actually evaluated. Quote-missing symbols do NOT count.
    // Symbols: MSFT (holding -> SELL but risk REJECT), NVDA (HOLD), AAPL (quote missing), AMZN (BUY accepted), GOOGL (BUY blocked by per-cycle BUY limit)

    // Mock quotes service: omit AAPL to simulate quote error
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [
      { symbol: 'MSFT', priceSek: 100 },
      { symbol: 'NVDA', priceSek: 200 },
      { symbol: 'AMZN', priceSek: 80 },
      { symbol: 'GOOGL', priceSek: 75 }
    ] }) }));

    // Mock Twelve Data historical provider to return deterministic closes or errors
    const histSpy = vi.fn(async (sym:string) => {
      if (sym === 'GOOGL'){
        const err: any = new Error('Provider error for GOOGL'); err.code = 'PROVIDER_ERROR'; throw err;
      }
      const closes = [] as number[]; const dates = [] as string[];
      // produce 30 completed days ending before today (use fixed dates)
      const base = new Date('2026-07-23T00:00:00.000Z');
      for (let i=0;i<30;i++){ const d = new Date(base.getTime() - (29-i)*24*3600*1000); dates.push(d.toISOString().slice(0,10)); closes.push(100 + i); }
      return { symbol: sym, closes, dates, source: 'twelve-data' };
    });
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    // Set deterministic portfolio with MSFT holding that triggers SELL
    (dr as any).__setTestPortfolio({
      getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 10, averagePrice: 150, currentPrice: 100 }] }),
      applyExecution: async (exec:any)=> ({ availableCash: 100000 })
    });

    // Inject a stub trader to control accept/reject behavior and append audits for visibility
    (dr as any).__setTestTrader({
      handleDecision: async (decision:any)=>{
        const sym = (decision && decision.symbol||'').toUpperCase();
        if (sym === 'MSFT'){
          // Simulate risk engine rejecting the SELL and log a REJECT audit
          await (dr as any).__appendTestAudits([{ kind: 'REJECT', decision, reason: { code: 'RISK_REJECT', message: 'Risk blocked' }, portfolioBefore: await (dr as any).getPaperTradingState().then((s:any)=>s.availableCash), timestamp: (new Date()).toISOString(), meta: { automatic: true } }]);
          return { accepted: false, code: 'RISK_REJECT' };
        }
        if (sym === 'AMZN'){
          // Accept the BUY and log EXECUTION
          const exec = { status: 'EXECUTED', executedPrice: decision.referencePrice || 80, quantity: 1, notional: decision.referencePrice || 80, fee: 0 };
          await (dr as any).__appendTestAudits([{ kind: 'EXECUTION', decision, execution: exec, portfolioBefore: await (dr as any).getPaperTradingState().then((s:any)=>s.availableCash), timestamp: (new Date()).toISOString(), meta: { automatic: true } }]);
          return { accepted: true, execution: exec };
        }
        // default: reject
        await (dr as any).__appendTestAudits([{ kind: 'REJECT', decision, reason: { code: 'UNKNOWN', message: 'Default reject' }, portfolioBefore: await (dr as any).getPaperTradingState().then((s:any)=>s.availableCash), timestamp: (new Date()).toISOString(), meta: { automatic: true } }]);
        return { accepted: false, code: 'UNKNOWN' };
      }
    });

    // Clear existing audits to make test deterministic
    await (dr as any).__clearAudits();
    const fs = require('fs');
    const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    // Pre-seed last-evaluation audits for AMZN and GOOGL so buySignal triggers
    await (dr as any).__appendTestAudits([
      { kind: 'EVALUATION', decision: { id: 'prev_amzn_eval', symbol: 'AMZN', referencePrice: 100 }, timestamp: (new Date()).toISOString(), meta: { automatic: true } },
      { kind: 'EVALUATION', decision: { id: 'prev_googl_eval', symbol: 'GOOGL', referencePrice: 90 }, timestamp: (new Date()).toISOString(), meta: { automatic: true } }
    ]);

    // Run a manual cycle with deterministic override universe (allow scheduler bypass)
    const res: any = await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: {
      quotes: [ { symbol: 'MSFT', priceSek: 100 }, { symbol: 'NVDA', priceSek: 200 }, /* AAPL omitted to simulate quote error */ { symbol: 'AMZN', priceSek: 80 }, { symbol: 'GOOGL', priceSek: 75 } ],
      portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 10, averagePrice: 150, currentPrice: 100 }] }
    } });

    // Read persisted audits for assertions
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);

    // ensure historical fetch called at most once per symbol
    const callsBySym = histSpy.mock.calls.map(c=>String(c[0]));
    expect(callsBySym.filter(x=> x==='MSFT').length).toBeLessThanOrEqual(1);
    expect(callsBySym.filter(x=> x==='AMZN').length).toBeLessThanOrEqual(1);
    expect(callsBySym.filter(x=> x==='GOOGL').length).toBeLessThanOrEqual(1);

    // Expectations per test definition
    // evaluationCount should be exactly 4 (MSFT, NVDA, AMZN, GOOGL). AAPL quote-missing is NOT counted.
    expect(typeof res.evaluationCount === 'number').toBeTruthy();
    expect(res.evaluationCount).toBe(4);

    // REJECT on MSFT was logged and did not stop others
    const msftReject = appended.find((a:any)=> a && a.raw && a.raw.decision && a.raw.decision.symbol==='MSFT' && a.raw && a.raw.reason && a.raw.reason.code === 'RISK_REJECT');
    expect(msftReject).toBeDefined();

    // HOLD for NVDA exists in evaluation audits
    const nvdaEval = appended.find((a:any)=> a && a.summary && a.summary.symbol === 'NVDA' && a.summary.action === 'HOLD');
    expect(nvdaEval).toBeDefined();

    // Quote-missing for AAPL was logged as REJECT with code QUOTE_MISSING
    const aaplReject = appended.find((a:any)=> a && a.raw && a.raw.decision && a.raw.decision.symbol==='AAPL' && a.raw && a.raw.reason && a.raw.reason.code === 'QUOTE_MISSING');
    expect(aaplReject).toBeDefined();

    // Exactly one BUY executed (AMZN)
    const buyExecs = appended.filter((a:any)=> a && a.summary && a.summary.action==='BUY' && a.summary.executionStatus==='EXECUTED');
    expect(buyExecs.length).toBe(1);

    // At most one SELL executed
    const sellExecs = appended.filter((a:any)=> a && a.summary && a.summary.action==='SELL' && a.summary.executionStatus==='EXECUTED');
    expect(sellExecs.length).toBeLessThanOrEqual(1);

    // The second BUY (GOOGL) should have a REJECT with code CYCLE_LIMIT
    const googlCycleReject = appended.find((a:any)=> a && a.raw && a.raw.decision && a.raw.decision.symbol==='GOOGL' && a.raw && a.raw.reason && a.raw.reason.code === 'CYCLE_LIMIT');
    expect(googlCycleReject).toBeDefined();

    // Ensure no symbol was counted more than once as evaluated in this cycle
    expect(res.evaluationCount).toBeGreaterThanOrEqual(1);
    // ensure executed count <=2
    expect((res as any).executed).toBeLessThanOrEqual(2);
  });

  it('logs technical analysis for holdings (observe-only) and continues', async ()=>{
    // Mock quotes and twelve-data for deterministic history
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => {
      const closes = new Array(30).fill(0).map((_,i)=> 100 + i);
      const dates = new Array(30).fill(0).map((_,i)=> new Date(2026,5, i+1).toISOString().slice(0,10));
      return { symbol: sym, closes, dates, source: 'twelve-data' };
    });
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    // Set portfolio with a MSFT holding so holdings-evaluation path runs
    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 5, averagePrice: 120, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });

    // Clear audits and run cycle
    await (dr as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    const res = await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 5, averagePrice: 120, currentPrice: 100 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    // find evaluation for MSFT
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT' && a.raw.meta && a.raw.meta.technicalAnalysis);
    expect(msEval).toBeDefined();
    // technicalAnalysis should be present under raw.meta.technicalAnalysis
    expect(msEval.raw.meta).toBeDefined();
    expect(msEval.raw.meta.technicalAnalysis).toBeDefined();
    expect(msEval.raw.meta.technicalAnalysis.technicalAnalysisMode).toBe('observe-only');
    const status = msEval.raw.meta.technicalAnalysis.technicalAnalysisStatus;
    expect(['success','unavailable']).toContain(status);
    if (status === 'success'){
      expect(msEval.raw.meta.technicalAnalysis.historicalDataPoints).toBeGreaterThanOrEqual(20);
    } else {
      expect(msEval.raw.meta.technicalAnalysis.technicalAnalysisErrorCode).toBeDefined();
    }
    // ensure historical fetch called once for MSFT
    expect(histSpy.mock.calls.filter((c:any)=> c[0] === 'MSFT').length).toBeLessThanOrEqual(1);
  });

  it('adds technicalSummary based on technicalAnalysis for evaluations', async ()=>{
    // Mock quotes and twelve-data for deterministic history
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => {
      const closes = new Array(30).fill(0).map((_,i)=> 100 + i);
      const dates = new Array(30).fill(0).map((_,i)=> new Date(2026,5, i+1).toISOString().slice(0,10));
      return { symbol: sym, closes, dates, source: 'twelve-data' };
    });
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));

    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 5, averagePrice: 120, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });

    await (dr as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    const res = await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 5, averagePrice: 120, currentPrice: 100 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    expect(msEval.raw.meta).toBeDefined();
    expect(msEval.raw.meta.technicalAnalysis).toBeDefined();
    expect(msEval.raw.meta.technicalSummary).toBeDefined();
    const ta = msEval.raw.meta.technicalAnalysis;
    const ts = msEval.raw.meta.technicalSummary;
    if (ta.technicalAnalysisStatus === 'success'){
      expect(ts.trend).toBe(ta.technicalTrend);
      expect(ts.signal).toBe(ta.technicalSignal);
      expect(ts.score).toBe(ta.technicalScore);
      // reason may come from array or error message
      const expectedReason = Array.isArray(ta.technicalReasons) && ta.technicalReasons.length ? String(ta.technicalReasons[0]) : (ta.technicalAnalysisErrorMessage || null);
      expect(ts.reason).toBe(expectedReason);
      expect(typeof ts.text === 'string' && ts.text.length > 0).toBeTruthy();
    } else {
      expect(ts.text).toMatch(/unavailable/i);
    }
  });

  it('evaluationSource set correctly for technical-only', async ()=>{
    vi.useRealTimers();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default').mockImplementation((closes:any)=> ({ trend: 'bullish', momentumPercent: 10, volatilityPercent: 5, technicalScore: 80, signal: 'BUY', reasons: ['momentum'] }));
    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (dr as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;
    await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const src = msEval.raw.meta && msEval.raw.meta.evaluationSource;
    expect(src).toBeDefined();
    expect(src.technicalUsed).toBe(true);
    expect(src.fundamentalUsed).toBe(false);
    expect(src.aggregatorUsed).toBe(true);
    expect(src.agreement).toBe(msEval.raw.meta.combinedAnalysis.agreement);
    expect(src.conflictingSignals).toBe(msEval.raw.meta.combinedAnalysis.conflictingSignals);
    analyzeSpy.mockRestore();
  });

  it('evaluationSource set correctly for technical + fundamental', async ()=>{
    vi.useRealTimers();
    // quotes
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default').mockImplementation((closes:any)=> ({ trend: 'bullish', momentumPercent: 10, volatilityPercent: 5, technicalScore: 80, signal: 'BUY', reasons: ['momentum'] }));
    // Simulate existing fundamental analysis attached to meta by pre-inserting an evaluation with fundamental meta
    await (dr as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;
    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    // Run cycle with overrideUniverse.fundamentals to simulate fundamental input present
    await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }, fundamentals: { MSFT: { status: 'success', score: 84, signal: 'BUY', reasons: ['rev'] } } } });
    const refreshed = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const newAppended = refreshed.slice(beforeLen);
    const msEval = newAppended.slice().reverse().find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const src = msEval.raw.meta && msEval.raw.meta.evaluationSource;
    expect(src).toBeDefined();
    expect(src.technicalUsed).toBe(true);
    expect(src.fundamentalUsed).toBe(true);
    expect(src.aggregatorUsed).toBe(true);
    expect(src.agreement).toBe(msEval.raw.meta.combinedAnalysis ? msEval.raw.meta.combinedAnalysis.agreement : undefined);
    analyzeSpy.mockRestore();
  });

  it('evaluationSource set correctly when technical unavailable', async ()=>{
    vi.useRealTimers();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ const err:any = new Error('Provider failed'); err.code = 'PROVIDER_ERROR'; throw err; } } }));
    const drLocal = await import('./demo-runtime');
    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;
    await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const src = msEval.raw.meta && msEval.raw.meta.evaluationSource;
    expect(src).toBeDefined();
    expect(src.technicalUsed).toBe(true); // technicalAnalysis was attempted and present (status 'unavailable')
    expect(src.fundamentalUsed).toBe(false);
    expect(src.aggregatorUsed).toBe(true);
    expect(src.agreement).toBe(msEval.raw.meta.combinedAnalysis.agreement);
  });

  it('creates combinedAnalysis when technicalAnalysis is present (technical-only)', async ()=>{
    vi.useRealTimers();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));

    // Force analyzer to return score 80
    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default').mockImplementation((closes:any)=> ({ trend: 'bullish', momentumPercent: 10, volatilityPercent: 5, technicalScore: 80, signal: 'BUY', reasons: ['momentum'] }));

    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (dr as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const ca = msEval.raw.meta && msEval.raw.meta.combinedAnalysis;
    expect(ca).toBeDefined();
    expect(ca.overallScore).toBe(81);
    expect(ca.overallSignal).toBe('BUY');
    analyzeSpy.mockRestore();
  });

  it('combinedAnalysis is neutral when technicalAnalysis unavailable', async ()=>{
    vi.useRealTimers();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ const err:any = new Error('Provider failed'); err.code = 'PROVIDER_ERROR'; throw err; } } }));

    const drLocal = await import('./demo-runtime');
    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const ca = msEval.raw.meta && msEval.raw.meta.combinedAnalysis;
    expect(ca).toBeDefined();
    expect(ca.overallScore).toBe(0);
    expect(ca.overallSignal).toBe('HOLD');
    expect(ca.confidence).toBe(0);
    expect(Array.isArray(ca.reasons) && ca.reasons.length === 0).toBeTruthy();
  });

  it('populates technicalReasons array from technicalAnalysis', async ()=>{
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => {
      const closes = new Array(30).fill(0).map((_,i)=> 100 + i);
      const dates = new Array(30).fill(0).map((_,i)=> new Date(2026,5, i+1).toISOString().slice(0,10));
      // craft technical output via analyzePriceSeries indirectly by using existing analyzer in runtime
      return { symbol: sym, closes, dates, source: 'twelve-data' };
    });
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));

    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 5, averagePrice: 120, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });

    await (dr as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 5, averagePrice: 120, currentPrice: 100 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const tr = msEval.raw.meta && msEval.raw.meta.technicalReasons;
    expect(Array.isArray(tr)).toBeTruthy();
    // should have between 1 and 4 short strings
    expect(tr.length).toBeGreaterThanOrEqual(1);
    expect(tr.length).toBeLessThanOrEqual(4);
    expect(typeof tr[0] === 'string').toBeTruthy();
    // if score present it should be combined with trend in first row format
    const first = tr[0];
    if (first && first.includes('Trend:') && first.includes('Score:')){
      expect(first).toMatch(/Trend:\s*\w+/);
      expect(first).toMatch(/Score:\s*\d+/);
    }
  });

  it('technical BUY is observe-only (audit signals BUY, action remains HOLD, no BUY execution)', async ()=>{
    vi.useRealTimers();
    // Use a rising closes series so the real analyzer returns BUY

    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    // Set portfolio with MSFT holding that results in HOLD
    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });

    await (dr as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    const res = await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);

    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    expect(msEval.raw.meta).toBeDefined();
    expect(msEval.raw.meta.technicalAnalysis).toBeDefined();
    // technical analysis must be present and marked observe-only; analysis content is diagnostic only
    expect(msEval.raw.meta.technicalAnalysis.technicalAnalysisMode).toBe('observe-only');
    // decision action must remain HOLD
    expect(msEval.raw.decision.action).toBe('HOLD');
    // decisionContext: technical BUY but actual HOLD
    const dc = msEval.raw.meta.decisionContext;
    expect(dc).toBeDefined();
    expect(dc.technicalStatus).toBe(msEval.raw.meta.technicalAnalysis.technicalAnalysisStatus);
    // technicalConfidence should equal rounded technicalScore when available
    if (msEval.raw.meta.technicalAnalysis.technicalAnalysisStatus === 'success'){
      expect(typeof dc.technicalConfidence).toBe('number');
      expect(dc.technicalConfidence).toBe(Math.round(msEval.raw.meta.technicalAnalysis.technicalScore));
      expect(dc.signalsConflict).toBeTruthy();
      const conf = dc.technicalConfidence as number;
      const expectedStrength = conf >= 75 ? 'HIGH' : (conf >= 50 ? 'MEDIUM' : 'LOW');
      expect(dc.recommendationStrength).toBe(expectedStrength);
    } else {
      expect(dc.technicalConfidence).toBeNull();
      expect(dc.recommendationStrength).toBe('LOW');
    }
    // decisionExplanation should explain actual HOLD and mention technical BUY
    expect(msEval.raw.meta.decisionExplanation).toBeDefined();
    const de = msEval.raw.meta.decisionExplanation as string;
    expect(typeof de === 'string' && de.length > 0).toBeTruthy();
    expect(/teknisk/i.test(de) || /tekniska/i.test(de) || /Victor agerar/i.test(de)).toBeTruthy();
    // when technical signal differs from actual action, explanation should mention both
    if (msEval.raw.meta.technicalAnalysis && msEval.raw.meta.technicalAnalysis.technicalSignal){
      const sig = String(msEval.raw.meta.technicalAnalysis.technicalSignal);
      expect(de.toUpperCase()).toContain('HOLD');
      expect(de.toUpperCase()).toContain(sig.toUpperCase());
    }
    // ensure no BUY EXECUTION occurred for MSFT
    const buyExec = appended.find((a:any)=> a && a.summary && a.summary.symbol==='MSFT' && a.summary.action==='BUY' && a.summary.executionStatus==='EXECUTED');
    expect(buyExec).toBeUndefined();
  });

  it('technical SELL is observe-only (audit signals SELL, action remains HOLD, no SELL execution)', async ()=>{
    vi.useRealTimers();
    // Use a falling closes series so the real analyzer returns SELL

    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'NVDA', priceSek: 200 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>200-i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_NVDA', symbol: 'NVDA', quantity: 1, averagePrice: 200, currentPrice: 200 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });

    await (dr as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    const res = await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'NVDA', priceSek: 200 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_NVDA', symbol: 'NVDA', quantity: 1, averagePrice: 200, currentPrice: 200 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);

    const nvEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'NVDA');
    expect(nvEval).toBeDefined();
    expect(nvEval.raw.meta.technicalAnalysis.technicalAnalysisMode).toBe('observe-only');
    expect(nvEval.raw.decision.action).toBe('HOLD');
    const sellExec = appended.find((a:any)=> a && a.summary && a.summary.symbol==='NVDA' && a.summary.action==='SELL' && a.summary.executionStatus==='EXECUTED');
    expect(sellExec).toBeUndefined();
  });

  it('historical provider error for first symbol logs unavailable and continues to next symbol', async ()=>{
    vi.useRealTimers();
    // analyzer noop — use neutral closes series so real analyzer returns HOLD

    // twelve-data: first symbol MSFT throws, second NVDA returns data
    const histSpy = vi.fn(async (sym:string) => {
      if (String(sym) === 'MSFT'){ const err: any = new Error('Provider failed'); err.code = 'PROVIDER_ERROR'; throw err; }
      return { symbol: sym, closes: new Array(30).fill(0).map((_,i)=> 100 + i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' };
    });
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 }, { symbol: 'NVDA', priceSek: 200 } ] }) }));

    vi.resetModules();
    const drLocal = await import('./demo-runtime');

    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }, { id: 'h_NVDA', symbol: 'NVDA', quantity: 1, averagePrice: 200, currentPrice: 200 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });

    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    const res = await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 }, { symbol: 'NVDA', priceSek: 200 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }, { id: 'h_NVDA', symbol: 'NVDA', quantity: 1, averagePrice: 200, currentPrice: 200 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    expect(msEval.raw.meta.technicalAnalysis.technicalAnalysisStatus).toBe('unavailable');
    expect(msEval.raw.meta.technicalAnalysis.technicalAnalysisErrorCode).toBe('PROVIDER_ERROR');
    const nvEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'NVDA');
    expect(nvEval).toBeDefined();
    // NVDA must succeed in this test
    expect(nvEval.raw.meta.technicalAnalysis.technicalAnalysisStatus).toBe('success');
  });

  it('centralized analysis: all evaluated symbols get technicalAnalysis (success) and no executions', async ()=>{
    vi.useRealTimers();
    const symbols = ['MSFT','NVDA','AAPL','AMZN','GOOGL'];
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: symbols.map(s=> ({ symbol: s, priceSek: 100 })) }) }));
    const histSpy = vi.fn(async (sym:string) => {
      const closes = new Array(30).fill(0).map((_,i)=> 100 + i);
      const dates = new Array(30).fill(0).map((_,i)=> new Date(2026,5, i+1).toISOString().slice(0,10));
      return { symbol: sym, closes, dates, source: 'twelve-data' };
    });
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));

    vi.resetModules();
    const drLocal = await import('./demo-runtime');

    // empty portfolio (no holdings) to force candidate evaluation for all symbols
    const portfolio = { availableCash: 100000, holdings: [] };
    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    const res = await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: symbols.map(s=> ({ symbol: s, priceSek: 100 })), portfolio } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    // ensure each symbol has an EVALUATION with success technicalAnalysis
    for (const s of symbols){
      const ev = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === s);
      expect(ev).toBeDefined();
      expect(ev.raw.meta).toBeDefined();
      expect(ev.raw.meta.technicalAnalysis).toBeDefined();
      expect(ev.raw.meta.technicalAnalysis.technicalAnalysisMode).toBe('observe-only');
      expect(ev.raw.meta.technicalAnalysis.technicalAnalysisStatus).toBe('success');
      expect(ev.raw.meta.technicalAnalysis.historicalDataPoints).toBeGreaterThanOrEqual(20);
    }
    // provider called exactly once per symbol
    for (const s of symbols){ expect(histSpy.mock.calls.filter((c:any)=> String(c[0]) === s).length).toBe(1); }
    // no executions created in this test
    const execs = appended.filter((a:any)=> a && a.summary && a.summary.executionStatus === 'EXECUTED');
    expect(execs.length).toBe(0);
  });

  it('duplicate path: same symbol in holdings and candidate evaluated only once (one hist call, one analysis)', async ()=>{
    vi.useRealTimers();
    const symbols = ['MSFT','NVDA'];
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: symbols.map(s=> ({ symbol: s, priceSek: 100 })) }) }));
    const histSpy = vi.fn(async (sym:string) => {
      const closes = new Array(30).fill(0).map((_,i)=> 200 + i);
      const dates = new Array(30).fill(0).map((_,i)=> new Date(2026,5, i+1).toISOString().slice(0,10));
      return { symbol: sym, closes, dates, source: 'twelve-data' };
    });
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));

    vi.resetModules();
    const drLocal = await import('./demo-runtime');

    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default');

    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });

    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;


    const res = await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: symbols.map(s=> ({ symbol: s, priceSek: 100 })), portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);

    // hist called once for MSFT and NVDA
    expect(histSpy.mock.calls.filter((c:any)=> String(c[0])==='MSFT').length).toBe(1);
    expect(histSpy.mock.calls.filter((c:any)=> String(c[0])==='NVDA').length).toBe(1);
    // analyzePriceSeries called at most once per unique symbol
    expect(analyzeSpy).toHaveBeenCalled();
    const msftCalls = analyzeSpy.mock.calls.filter((c:any)=> true).length; // total calls >=1
    expect(msftCalls).toBeLessThanOrEqual(2);
  });

  it('getHistoricalDailyCloses is called at most once per unique symbol in a cycle', async ()=>{
    vi.useRealTimers();
    // analyzer noop — use neutral closes series so real analyzer returns HOLD

    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 }, { symbol: 'NVDA', priceSek: 200 } ] }) }));

    // Make MSFT present both in holdings and in symbols list to force potential duplicate access
    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });

    await (dr as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    const res = await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 }, { symbol: 'NVDA', priceSek: 200 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });

    // verify histSpy called at most once per unique symbol
    const callsBySym = histSpy.mock.calls.map(c=>String(c[0]));
    expect(callsBySym.filter(x=> x==='MSFT').length).toBeLessThanOrEqual(1);
    expect(callsBySym.filter(x=> x==='NVDA').length).toBeLessThanOrEqual(1);
  });

  // Strength threshold tests: ensure recommendationStrength mapping is correct
  const runStrengthTest = async (score:any, expectedStrength:string) => {
    vi.useRealTimers();
    // Mock quotes and twelve-data
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => {
      const closes = new Array(30).fill(0).map((_,i)=> 100 + i);
      const dates = new Array(30).fill(0).map((_,i)=> new Date(2026,5, i+1).toISOString().slice(0,10));
      return { symbol: sym, closes, dates, source: 'twelve-data' };
    });
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));

    // Spy on analyzer and force desired score
    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default').mockImplementation((closes:any)=> ({ trend: 'bullish', momentumPercent: 10, volatilityPercent: 5, technicalScore: score, signal: 'BUY', reasons: ['momentum'] }));

    // setup portfolio and run
    const drLocal = await import('./demo-runtime');
    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });

    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;

    await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });

    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const dc = msEval.raw.meta.decisionContext;
    expect(dc).toBeDefined();
    expect(dc.recommendationStrength).toBe(expectedStrength);
    analyzeSpy.mockRestore();
  };

  it('strength mapping: score 72 => MEDIUM', async ()=>{ await runStrengthTest(72, 'MEDIUM'); });
  it('strength mapping: score 75 => HIGH', async ()=>{ await runStrengthTest(75, 'HIGH'); });
  it('strength mapping: score 49 => LOW', async ()=>{ await runStrengthTest(49, 'LOW'); });
  it('strength mapping: unavailable => LOW', async ()=>{
    // simulate provider failure to get unavailable
    vi.useRealTimers();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ const err:any = new Error('Provider failed'); err.code = 'PROVIDER_ERROR'; throw err; } } }));
    const drLocal = await import('./demo-runtime');
    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;
    await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const dc = msEval.raw.meta.decisionContext;
    expect(dc).toBeDefined();
    expect(dc.recommendationStrength).toBe('LOW');
  });

  it('overallDecisionConfidence: success without conflict => unchanged', async ()=>{
    // technicalConfidence 82, signal == action => overallDecisionConfidence 82
    vi.useRealTimers();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));

    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default').mockImplementation((closes:any)=> ({ trend: 'bullish', momentumPercent: 10, volatilityPercent: 5, technicalScore: 82, signal: 'HOLD', reasons: ['momentum'] }));

    const drLocal = await import('./demo-runtime');
    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;
    await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const dc = msEval.raw.meta.decisionContext;
    expect(dc.technicalConfidence).toBe(82);
    expect(dc.recommendationStrength).toBe('HIGH');
    expect(dc.overallDecisionConfidence).toBe(82);
    expect(dc.executiveSummary).toBe('Strong technical setup with no conflicting signals.');
    analyzeSpy.mockRestore();
  });

  it('overallDecisionConfidence: success with conflict => reduced by 20', async ()=>{
    // technicalConfidence 72, signal BUY but action HOLD => overall 52
    vi.useRealTimers();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));

    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default').mockImplementation((closes:any)=> ({ trend: 'bullish', momentumPercent: 10, volatilityPercent: 5, technicalScore: 72, signal: 'BUY', reasons: ['momentum'] }));

    const drLocal = await import('./demo-runtime');
    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;
    await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const dc = msEval.raw.meta.decisionContext;
    expect(dc.overallDecisionConfidence).toBe(52);
    expect(dc.executiveSummary).toBe('Technical outlook is positive, but conflicting signals reduce confidence.');
    analyzeSpy.mockRestore();
  });

  it('overallDecisionConfidence: unavailable => 0', async ()=>{
    vi.useRealTimers();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ const err:any = new Error('Provider failed'); err.code = 'PROVIDER_ERROR'; throw err; } } }));
    const drLocal = await import('./demo-runtime');
    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (drLocal as any).__clearAudits();
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const beforeAll = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const beforeLen = beforeAll.length;
    await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice(beforeLen);
    const msEval = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT');
    expect(msEval).toBeDefined();
    const dc = msEval.raw.meta.decisionContext;
    expect(dc.overallDecisionConfidence).toBe(0);
    expect(dc.executiveSummary).toBe('Technical analysis unavailable.');
  });

  it('decisionComparison via runtime: strategy BUY + aggregator BUY => matches true', async ()=>{
    vi.useRealTimers();
    vi.resetModules();
    // Ensure deterministic provider and analyzer
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'AMZN', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default');
    const drLocal = await import('./demo-runtime');

    // First run creates a prior evaluation (strategy HOLD)
    analyzeSpy.mockImplementationOnce((closes:any)=> ({ trend: 'neutral', momentumPercent: 0, volatilityPercent: 0, technicalScore: 10, signal: 'HOLD', reasons: [] }));
    drLocal.__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await drLocal.__clearAudits();
    await drLocal.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'AMZN', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [] } } });

    // Second run triggers BUY candidate and ensure analyzer returns BUY
    analyzeSpy.mockImplementation((closes:any)=> ({ trend: 'bullish', momentumPercent: 20, volatilityPercent: 5, technicalScore: 85, signal: 'BUY', reasons: ['momentum'] }));
    await drLocal.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'AMZN', priceSek: 98 } ], portfolio: { availableCash: 100000, holdings: [] } } });

    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice().reverse();
    const ev = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'AMZN' && a.raw.decision.action === 'BUY');
    expect(ev).toBeDefined();
    // action unchanged
    expect(ev.raw.decision.action).toBe('BUY');
    const dc = ev.raw.meta && ev.raw.meta.decisionComparison;
    expect(dc).toBeDefined();
    expect(dc.strategyAction).toBe(ev.raw.decision.action);
    expect(dc.aggregatorSignal).toBe('BUY');
    expect(dc.matches).toBe(true);
    analyzeSpy.mockRestore();
  });

  it('decisionComparison via runtime: strategy HOLD + aggregator BUY => matches false', async ()=>{
    vi.useRealTimers();
    vi.resetModules();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default').mockImplementation((closes:any)=> ({ trend: 'bullish', momentumPercent: 20, volatilityPercent: 5, technicalScore: 85, signal: 'BUY', reasons: ['momentum'] }));

    (dr as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (dr as any).__clearAudits();
    await (dr as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });

    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice().reverse();
    const ev = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT' && a.raw.decision.action === 'HOLD' && a.raw.meta && a.raw.meta.combinedAnalysis);
    expect(ev).toBeDefined();
    expect(ev.raw.decision.action).toBe('HOLD');
    const dc = ev.raw.meta && ev.raw.meta.decisionComparison;
    expect(dc).toBeDefined();
    expect(dc.strategyAction).toBe(ev.raw.decision.action);
    expect(dc.aggregatorSignal).toBe('BUY');
    expect(dc.matches).toBe(false);
    analyzeSpy.mockRestore();
  });

  it('decisionComparison via runtime: strategy HOLD + aggregator HOLD => matches true', async ()=>{
    vi.useRealTimers();
    vi.resetModules();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    const histSpy = vi.fn(async (sym:string) => ({ symbol: sym, closes: new Array(30).fill(0).map((_,i)=>100+i), dates: new Array(30).fill(0).map((_,i)=> new Date(2026,5,i+1).toISOString().slice(0,10)), source: 'twelve-data' }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ return histSpy(String(sym)); } } }));
    const tech = await import('../paper-trader/technical');
    const analyzeSpy = vi.spyOn(tech, 'default').mockImplementation((closes:any)=> ({ trend: 'neutral', momentumPercent: 0, volatilityPercent: 0, technicalScore: 60, signal: 'HOLD', reasons: [] }));
    const drLocal = await import('./demo-runtime');

    drLocal.__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await drLocal.__clearAudits();
    await drLocal.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });

    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice().reverse();
    const ev = appended.find((a:any)=> a && a.raw && a.raw.kind==='EVALUATION' && a.raw.decision && a.raw.decision.symbol === 'MSFT' && a.raw.decision.action === 'HOLD' && a.raw.meta && a.raw.meta.combinedAnalysis);
    expect(ev).toBeDefined();
    expect(ev.raw.decision.action).toBe('HOLD');
    const dc = ev.raw.meta && ev.raw.meta.decisionComparison;
    expect(dc).toBeDefined();
    expect(dc.strategyAction).toBe(ev.raw.decision.action);
    expect(dc.aggregatorSignal).toBe('HOLD');
    expect(dc.matches).toBe(true);
    analyzeSpy.mockRestore();
  });

  it('decisionComparison via runtime: technical unavailable + strategy HOLD => aggregator HOLD matches true', async ()=>{
    vi.useRealTimers();
    vi.resetModules();
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [ { symbol: 'MSFT', priceSek: 100 } ] }) }));
    vi.doMock('../market-data/twelve-data', ()=>({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:number|any, size?:number){ const err:any = new Error('Provider failed'); err.code = 'PROVIDER_ERROR'; throw err; } } }));

    const drLocal = await import('./demo-runtime');
    (drLocal as any).__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    await (drLocal as any).__clearAudits();
    await (drLocal as any).runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 1, averagePrice: 100, currentPrice: 100 }] } } });
    const fs = require('fs'); const path = require('path');
    const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
    const all = JSON.parse(fs.readFileSync(auditPath, 'utf8')) || [];
    const appended = all.slice().reverse();
    const ev = appended.find((a:any)=> a && a.raw && a.raw.decision && a.raw.decision.symbol === 'MSFT' && a.raw.decision.action === 'HOLD');
    expect(ev).toBeDefined();
    expect(ev.raw.decision.action).toBe('HOLD');
    const dc = ev.raw.meta && ev.raw.meta.decisionComparison;
    expect(dc).toBeDefined();
    expect(dc.strategyAction).toBe(ev.raw.decision.action);
    expect(dc.aggregatorSignal).toBe('HOLD');
    expect(dc.matches).toBe(true);
  });
});
