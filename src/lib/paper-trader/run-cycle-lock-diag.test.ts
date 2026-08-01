import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('runAutomaticCycleImplementation lock diagnostics', () => {
  beforeEach(()=>{
    vi.resetModules();
    vi.doMock('./run-cycle-lock', () => ({ acquireRunCycleLockWithOwner: async ()=> ({ status: 'DUPLICATE' }), releaseRunCycleLock: async ()=> false }));
    // ensure scheduler mode not interfering
    vi.stubEnv('PAPER_TRADER_SCHEDULER_MODE', 'in_memory');
    vi.stubEnv('NODE_ENV', 'test');
  });
  afterEach(()=>{
    try{ vi.unstubAllEnvs(); }catch(_){ }
  });

  it('records diagnostics when lock is duplicate', async ()=>{
    const runtime = await import('./demo-runtime');
    const sched = runtime.getSchedulerState();
    if (!sched || !sched.runTick) throw new Error('no runTick');
    await sched.runTick();
    // Scheduler state should be updated to 'skipped'
    expect((sched as any).lastAutomaticRunStatus).toBe('skipped');
    // Scheduler should also expose diagnostics
    const diag = (sched as any).lastAutomaticLockDiagnostics;
    expect(diag).toBeTruthy();
    expect(diag.skipReasonCode).toBe('DUPLICATE_LOCK');
    expect(diag.skipStage).toBe('run_cycle_lock');
  });
});
