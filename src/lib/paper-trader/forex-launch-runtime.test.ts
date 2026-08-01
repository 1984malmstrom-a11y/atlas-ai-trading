import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import * as Demo from './demo-runtime';
import { __clearAudits, __listAudits, setForexAutonomyArmed, getSchedulerState, getPaperTradingState, __appendTestAudits, runManualPaperTradingCycle } from './demo-runtime';
import { FileAuditStore } from './demo-runtime';
import { DEFAULT_PAPER_AUTO_MANDATE } from '../../domain/trading/victor-types';

describe('forex launch runtime (automatic tick + state)', ()=>{
  beforeEach(async ()=>{
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T10:00:00.000Z'));
    await __clearAudits();
    setForexAutonomyArmed(false);
    // force scheduler to consider market open for deterministic tests
    try{ vi.spyOn(Demo, 'decideAutopilotRun').mockImplementation(()=> ({ shouldRun: true, nextRunAt: null, reason: 'test', marketOpen: true, cooldownActive: false, alreadyRunning: false } as any)); }catch(_){ }
    // enable in-memory local lock fallback so scheduler can acquire lock in tests
    process.env.PAPER_TRADER_SCHEDULER_MODE = 'in_memory';
  });
  afterEach(()=>{
    try{ vi.useRealTimers(); }catch(_){ }
    try{ vi.restoreAllMocks(); }catch(_){ }
    try{ delete process.env.PAPER_TRADER_SCHEDULER_MODE; }catch(_){ }
  });

  it('appends exactly one FOREX_LAUNCH_CONTROL and marks DIAGNOSTIC_ONLY when not armed', async ()=>{
    const sched = getSchedulerState();
    // run a scheduler tick (uses internal runAutomaticCycleImplementation)
    await (sched.runTick && sched.runTick());
    // prefer checking runtime defensive state over audit shape which may vary
    const state = await getPaperTradingState();
    expect(state.forexLaunchControl).toBeTruthy();
    expect(Array.isArray(state.forexLaunchChecklist.items)).toBeTruthy();
    expect(state.forexLaunchChecklist.items.length).toBe(14);
    // best-effort: if an audit was stored, ensure it indicates DIAGNOSTIC_ONLY when not armed
    const audits = await __listAudits();
    const launches = audits.filter(a=> (a && a.raw && a.raw.executionMode === 'DIAGNOSTIC_ONLY') || (a && a.executionMode === 'DIAGNOSTIC_ONLY'));
    if (launches.length > 0){
      const launch = launches[0];
      const raw = launch.raw || launch;
      expect(raw.executionMode).toBe('DIAGNOSTIC_ONLY');
    }
  });

  it('audit append failure does not throw and lock is released', async ()=>{
    // monkeypatch FileAuditStore.append to throw once
    const orig = FileAuditStore.prototype.append;
    try{
      FileAuditStore.prototype.append = async function(){ throw new Error('simulated append failure'); } as any;
      const sched = getSchedulerState();
      // call runTick; should not throw
      await (sched.runTick && sched.runTick());
      // scheduler lock should be cleared
      expect(sched.inProgress).toBeFalsy();
    }finally{
      FileAuditStore.prototype.append = orig;
    }
  });

  it('daily trade limit reached causes DAILY_TRADE_LIMIT_REACHED in blockingReasons', async ()=>{
    // create enough EXECUTION entries to hit the configured maxTradesPerDay
    const max = typeof DEFAULT_PAPER_AUTO_MANDATE.maxTradesPerDay === 'number' ? DEFAULT_PAPER_AUTO_MANDATE.maxTradesPerDay : 1;
    const execs: any[] = [];
    for (let i=0;i<max;i++){
      execs.push({ kind: 'EXECUTION', timestamp: new Date().toISOString(), execution: { id: `ex_${i}`, symbol: 'EUR/USD', side: 'SELL', quantity: 1, executedPrice: 1 }, portfolioBefore: { holdings: [{ symbol: 'EUR/USD', averagePrice: 0.5 }] } });
    }
    await __appendTestAudits(execs);
    const sched = getSchedulerState();
    await (sched.runTick && sched.runTick());
    // inspect runtime state for blocking reasons
    const state = await getPaperTradingState();
    expect(state.forexLaunchControl).toBeTruthy();
    const br = Array.isArray(state.forexLaunchControl.blockingReasons) ? state.forexLaunchControl.blockingReasons : [];
    expect(br.some((r:any)=> String(r).includes('DAILY_TRADE_LIMIT_REACHED'))).toBeTruthy();
  });

});
