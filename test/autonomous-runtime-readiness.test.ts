import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startAutonomousScheduler, stopAutonomousScheduler, getSchedulerState, decideAutopilotRun } from '../src/lib/paper-trader/demo-runtime';

describe('Autonomous scheduler readiness', () => {
  beforeEach(() => {
    try{ stopAutonomousScheduler(); }catch(_){ }
    const s = getSchedulerState();
    try{ s.inProgress = false; s.lastRunAt = null; s.lastAutomaticRunStatus = null; s.lastAutomaticRunMessage = null; }catch(_){ }
  });
  afterEach(() => {
    try{ stopAutonomousScheduler(); }catch(_){ }
    try{ vi.useRealTimers(); }catch(_){ }
  });

  it('starts a single timer and stop clears it', async () => {
    vi.useFakeTimers();
    startAutonomousScheduler(1000);
    const s = getSchedulerState();
    expect(s.timerId).toBeTruthy();
    const timer1 = s.timerId;
    // starting again should not create a new timer
    startAutonomousScheduler(1000);
    expect(s.timerId).toBe(timer1);
    // advance timers to ensure the callback runs without throwing
    vi.advanceTimersByTime(2000);
    stopAutonomousScheduler();
    expect(s.timerId).toBeNull();
  });

  it('decideAutopilotRun respects inProgress flag', () => {
    const s = getSchedulerState();
    s.inProgress = true;
    const res = decideAutopilotRun({ now: new Date() });
    expect(res.shouldRun).toBe(false);
    expect(String(res.reason).toLowerCase()).toContain('cycle already in progress');
  });
});
