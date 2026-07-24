import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    const sched = (globalThis as any)[SCHED_KEY];
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
    const sched = (globalThis as any)[SCHED_KEY];
    expect(sched.timerId).toBeTruthy();

    // Ensure GET/read-only does not trigger a cycle
    const beforeLast = sched.lastRunAt;
    await (dr as any).getPaperTradingState();
    expect(sched.lastRunAt).toBe(beforeLast);

    // advance time to trigger one interval
    await vi.advanceTimersByTimeAsync(60);
    // allow pending microtasks to complete
    await Promise.resolve();
    expect(typeof sched.lastRunAt).toBe('number');
    const last = sched.lastRunAt as number;
    const next = last + sched.intervalMs;
    // read via public state to ensure values are consistent
    const st = await (dr as any).getPaperTradingState();
    expect(st.lastAutomaticRunAt).toBe(new Date(last).toISOString());
    expect(st.nextAutomaticRunAt).toBe(new Date(next).toISOString());
    // diagnostics: automatic run should record status and evaluation delta
    expect(sched.lastAutomaticRunStatus).toBeDefined();
    const status = sched.lastAutomaticRunStatus as string | null;
    expect(['success','skipped','error'].includes(String(status))).toBeTruthy();
    // evaluation count must be present (number or zero)
    expect(typeof sched.lastAutomaticEvaluationCount === 'number' || sched.lastAutomaticEvaluationCount === null).toBeTruthy();

    (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler();
  });

  it('prevents overlap between automatic and manual cycle', async ()=>{
    vi.useFakeTimers();
    (dr as any).setPaperTradingEnabled(true);
    (dr as any).startAutonomousScheduler && (dr as any).startAutonomousScheduler(50);
    const sched = (globalThis as any)[SCHED_KEY];

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
    const sched = (globalThis as any)[SCHED_KEY];
    expect(sched.timerId).toBeTruthy();
    (dr as any).stopAutonomousScheduler && (dr as any).stopAutonomousScheduler();
    expect(sched.timerId).toBeNull();
  });

  it('allows hot-reload to swap runTick without creating a new timer', async ()=>{
    vi.useFakeTimers();
    (dr as any).setPaperTradingEnabled(true);
    (dr as any).startAutonomousScheduler && (dr as any).startAutonomousScheduler(50);
    const sched = (globalThis as any)[SCHED_KEY];
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
    const sched = (globalThis as any)[SCHED_KEY];
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

    // Test definition: evaluationCount counts unique symbols actually evaluated. Quote-missing symbols do NOT count.
    // Symbols: MSFT (holding -> SELL but risk REJECT), NVDA (HOLD), AAPL (quote missing), AMZN (BUY accepted), GOOGL (BUY blocked by per-cycle BUY limit)

    // Mock quotes service: omit AAPL to simulate quote error
    vi.mock('../market-data/quotes-service', ()=>({ getNormalizedQuotes: async ()=> ({ quotes: [
      { symbol: 'MSFT', priceSek: 100 },
      { symbol: 'NVDA', priceSek: 200 },
      { symbol: 'AMZN', priceSek: 80 },
      { symbol: 'GOOGL', priceSek: 75 }
    ] }) }));

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
});
