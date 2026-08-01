import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Integration tests: ensure runTick acquires and always releases the lock
describe('run-cycle lock lifecycle (integration)', () => {
  let tmpDir: string | null = null;
  beforeEach(async () => {
    // isolated workspace
    const tmpBase = path.join(os.tmpdir(), 'atlas_test_');
    tmpDir = fs.mkdtempSync(tmpBase);
    fs.mkdirSync(path.join(tmpDir, 'src', 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'data', 'victor-trading-audit.json'), '[]', 'utf8');
    process.chdir(tmpDir);
    vi.resetModules();
  });

  afterEach(() => {
    try{ if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); }catch(_){}
    tmpDir = null;
    vi.restoreAllMocks();
  });

  async function importRuntimeWithLockMocks(acquireImpl: any, releaseImpl: any){
    // mock the lock module before importing runtime
    vi.doMock('./run-cycle-lock', () => ({
      acquireRunCycleLockWithOwner: acquireImpl,
      releaseRunCycleLock: releaseImpl,
    }));
    const runtime = await import('./demo-runtime');
    return runtime;
  }

  it('releases lock after successful cycle', async ()=>{
    const acquireSpy = vi.fn(async () => ({ status: 'ACQUIRED', ownerToken: 'owner-1' }));
    const releaseSpy = vi.fn(async (_k:any, t:any) => {
      // must receive same owner token
      return t === 'owner-1';
    });
    const runtime = await importRuntimeWithLockMocks(acquireSpy, releaseSpy);

    const sched = (runtime as any).getSchedulerState();
    // call the configured runTick (runs real lightweight cycle in isolated tmp)
    await sched.runTick && await sched.runTick();

    expect(acquireSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    // owner token matched
    expect(releaseSpy.mock.calls[0][1]).toBe('owner-1');
  });

  it('releases lock after early skipped cycle result', async ()=>{
    const acquireSpy = vi.fn(async () => ({ status: 'ACQUIRED', ownerToken: 'owner-2' }));
    const releaseSpy = vi.fn(async (_k:any, t:any) => t === 'owner-2');
    const runtime = await importRuntimeWithLockMocks(acquireSpy, releaseSpy);
    const sched = (runtime as any).getSchedulerState();
    await sched.runTick && await sched.runTick();
    expect(acquireSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    expect(releaseSpy.mock.calls[0][1]).toBe('owner-2');
  });

  it('releases lock when cycle throws', async ()=>{
    const acquireSpy = vi.fn(async () => ({ status: 'ACQUIRED', ownerToken: 'owner-3' }));
    const releaseSpy = vi.fn(async (_k:any, t:any) => t === 'owner-3');
    const runtime = await importRuntimeWithLockMocks(acquireSpy, releaseSpy);
    const sched = (runtime as any).getSchedulerState();
    await sched.runTick && await sched.runTick();
    expect(acquireSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    expect(releaseSpy.mock.calls[0][1]).toBe('owner-3');
  });

});
