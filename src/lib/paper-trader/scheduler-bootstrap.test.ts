import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSchedulerState, ensureAutonomousSchedulerStarted, startAutonomousScheduler, stopAutonomousScheduler } from './demo-runtime';
import buildAutonomousRuntimeReadiness from './autonomous-runtime-readiness';

function clearGlobalScheduler(){
  try{ (globalThis as any).__ATLAS_PAPER_TRADER_SCHEDULER__ = undefined; }catch(_){ }
}

describe('scheduler bootstrap helper', () => {
  const origNodeEnv = (process as any).env.NODE_ENV;
  const origMode = (process as any).env.PAPER_TRADER_SCHEDULER_MODE;

  beforeEach(()=>{
    clearGlobalScheduler();
  });
  afterEach(()=>{
    try{ stopAutonomousScheduler(); }catch(_){ }
    clearGlobalScheduler();
    (process as any).env.NODE_ENV = origNodeEnv;
    (process as any).env.PAPER_TRADER_SCHEDULER_MODE = origMode;
    try{ vi.useRealTimers(); }catch(_){ }
  });

  it('starts timer when mode=in_memory and not running (development)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    (process as any).env.PAPER_TRADER_SCHEDULER_MODE = 'in_memory';
    (process as any).env.NODE_ENV = 'development';
    const res = ensureAutonomousSchedulerStarted();
    expect(res && (res as any).status).toBe('started');
    const sched = getSchedulerState();
    expect(sched.timerId).toBeTruthy();
    // lastRunAt must still be null before first tick
    expect(sched.lastRunAt).toBeNull();
    // nextRunAt must be set to now + intervalMs
    expect(typeof sched.nextRunAt).toBe('number');
    expect(sched.nextRunAt).toBe(100000 + sched.intervalMs);
    // readiness exposes the same nextAutomaticRunAt
    const ready = (buildAutonomousRuntimeReadiness({ now: new Date(100000) }) as any);
    expect(ready.nextAutomaticRunAt).not.toBeNull();
    // ensure idempotent: second call reports alreadyRunning and timer unchanged
    const idBefore = sched.timerId as any;
    const res2 = ensureAutonomousSchedulerStarted();
    expect((res2 as any).status).toBe('alreadyRunning');
    expect(getSchedulerState().timerId).toBe(idBefore);
    // advance one interval -> simulate tick
    vi.advanceTimersByTime(sched.intervalMs);
    // after tick, nextRunAt should have advanced by intervalMs
    const after = getSchedulerState();
    expect(typeof after.nextRunAt).toBe('number');
    expect(after.nextRunAt).toBe(100000 + sched.intervalMs * 2);
    // cleanup
    stopAutonomousScheduler();
    expect(getSchedulerState().timerId).toBeNull();
    expect(getSchedulerState().nextRunAt).toBeNull();
    vi.useRealTimers();
  });

  it('does not start timer when mode != in_memory', () => {
    vi.useFakeTimers();
    (process as any).env.PAPER_TRADER_SCHEDULER_MODE = 'disabled';
    (process as any).env.NODE_ENV = 'development';
    const res = ensureAutonomousSchedulerStarted();
    expect((res as any).status).toBe('modeIneligible');
    expect(getSchedulerState().timerId).toBeNull();
    expect(getSchedulerState().nextRunAt).toBeNull();
    vi.useRealTimers();
  });

  it('does not start a real timer in NODE_ENV=test; startAutonomousScheduler works with fake timers', () => {
    vi.useFakeTimers();
    (process as any).env.PAPER_TRADER_SCHEDULER_MODE = 'in_memory';
    (process as any).env.NODE_ENV = 'test';
    const res = ensureAutonomousSchedulerStarted();
    expect((res as any).status).toBe('test');
    // Now explicitly start using existing function with fake timers
    vi.setSystemTime(200000);
    startAutonomousScheduler();
    const s = getSchedulerState();
    expect(s.timerId).toBeTruthy();
    expect(s.nextRunAt).toBe(200000 + s.intervalMs);
    // simulate tick
    vi.advanceTimersByTime(s.intervalMs);
    expect(getSchedulerState().nextRunAt).toBe(200000 + s.intervalMs * 2);
    stopAutonomousScheduler();
    expect(getSchedulerState().timerId).toBeNull();
    expect(getSchedulerState().nextRunAt).toBeNull();
    vi.useRealTimers();
  });
});
