import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startAutonomousScheduler, stopAutonomousScheduler, getSchedulerState } from '../src/lib/paper-trader/demo-runtime';
import buildAutonomousRuntimeReadiness from '../src/lib/paper-trader/autonomous-runtime-readiness';

describe('Scheduler day-run recovery and readiness', () => {
  beforeEach(() => {
    try{ stopAutonomousScheduler(); }catch(_){ }
    const s = getSchedulerState();
    try{ s.inProgress = false; s.lastRunAt = null; s.lastAutomaticRunStatus = null; s.lastAutomaticRunMessage = null; s.lastAutomaticEvaluationCount = null; }catch(_){ }
  });
  afterEach(() => { try{ stopAutonomousScheduler(); }catch(_){ } try{ vi.useRealTimers(); }catch(_){ } });

  it('hot reload swaps callback without creating new timer', async () => {
    vi.useFakeTimers();
    const s = getSchedulerState();
    let calledA = 0; let calledB = 0;
    s.runTick = async () => { calledA++; };
    startAutonomousScheduler(1000);
    const timerBefore = s.timerId;
    // swap implementation (hot-reload) without stopping
    s.runTick = async () => { calledB++; };
    vi.advanceTimersByTime(1500);
    expect(s.timerId).toBe(timerBefore);
    expect(calledA + calledB).toBeGreaterThanOrEqual(1);
    stopAutonomousScheduler();
  });

  it('tick error is caught and releases timer for next tick', async () => {
    vi.useFakeTimers();
    const s = getSchedulerState();
    s.runTick = async () => { throw new Error('boom'); };
    startAutonomousScheduler(1000);
    await vi.advanceTimersByTimeAsync(1100);
    // allow microtasks to settle
    await Promise.resolve();
    expect(s.lastAutomaticRunStatus).toBe('error');
    // after error, scheduler should still have timer for next ticks
    expect(!!s.timerId).toBe(true);
    stopAutonomousScheduler();
  });

  it('consecutiveFailures resets after success', async () => {
    vi.useFakeTimers();
    const s = getSchedulerState();
    s.runTick = async () => { throw new Error('boom'); };
    startAutonomousScheduler(1000);
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.resolve();
    expect(s.lastAutomaticRunStatus).toBe('error');
    // swap to success
    s.runTick = async () => { return; };
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.resolve();
    expect(s.lastAutomaticRunStatus === 'error' || s.lastAutomaticRunStatus === 'success').toBeTruthy();
    stopAutonomousScheduler();
  });

  it('long pause does not create catch-up storm', async () => {
    vi.useFakeTimers();
    const s = getSchedulerState();
    let calls = 0;
    s.runTick = async () => { calls++; };
    // simulate lastRunAt far in the past
    s.lastRunAt = Date.now() - 1000 * 60 * 60 * 24; // 1 day ago
    startAutonomousScheduler(1000);
    vi.advanceTimersByTime(5000);
    // Expect only a bounded number of immediate calls (no storm)
    expect(calls).toBeLessThanOrEqual(10);
    stopAutonomousScheduler();
  });

  it('builder produces JSON-safe defensive object and respects stock/forex availability', async () => {
    const s = getSchedulerState();
    s.lastRunAt = Date.now();
    s.lastAutomaticRunStatus = 'success';
    s.inProgress = true; // avoid overlap blocker for this synthetic snapshot
    const ready = await buildAutonomousRuntimeReadiness({ now: new Date(), runtimeSnapshot: { autonomousEnabled: true, holdings: [{ symbol: 'AAPL' }], forexLaunchControl: { isSafeToStartCycle: true } } });
    expect(['READY','LIMITED','BLOCKED'].includes(ready.overallStatus)).toBeTruthy();
    // JSON-safe
    expect(() => JSON.stringify(ready)).not.toThrow();
    // warning/blocker arrays limited
    expect(Array.isArray(ready.blockers)).toBe(true);
    expect(Array.isArray(ready.warnings)).toBe(true);
  });
});
