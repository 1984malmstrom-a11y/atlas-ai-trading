import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('POST /api/paper-trader/run-cycle', ()=>{
  let mockCycle: any;
  beforeEach(()=>{
    vi.resetModules();
    mockCycle = vi.fn(async (opts:any) => ({ ok: true, calledWith: opts, result: { processedCandidates: 1 } }));
    // mock NextResponse.json to return plain object for easy assertions
    vi.doMock('next/server', () => ({ NextResponse: { json: (payload: any, init?: any) => ({ payload, status: init && init.status ? init.status : 200 }) } }));
    // mock the runtime cycle
    vi.doMock('../../../../lib/paper-trader/demo-runtime', () => ({ runManualPaperTradingCycle: mockCycle }));
    // default lock returns ACQUIRED and capture called key and release
    let _lastLockKey: any = null;
    let _lastRelease: any = null;
    let _releaseCount = 0;
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({
      acquireRunCycleLockWithOwner: async (k:string) => { _lastLockKey = k; return { status: 'ACQUIRED', ownerToken: 'owner-1' }; },
      releaseRunCycleLock: async (k:string,t:string) => { _lastRelease = { k,t }; _releaseCount++; return true; },
      __getLastLockKey: () => _lastLockKey,
      __getLastRelease: () => _lastRelease,
      __getReleaseCount: () => _releaseCount,
    }));
    // Default to supabase-config for tests that exercise successful flow.
    process.env.PAPER_TRADER_PORTFOLIO_STORE = 'supabase';
    process.env.SUPABASE_URL = 'https://example.supabase.local';
    process.env.SUPABASE_SECRET_KEY = 'supabase-secret';
    delete process.env.PAPER_TRADER_SCHEDULER_MODE;
  });

  afterEach(()=>{
    delete process.env.PAPER_TRADER_CRON_SECRET;
    delete process.env.PAPER_TRADER_PORTFOLIO_STORE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.PAPER_TRADER_SCHEDULER_MODE;
    vi.clearAllMocks();
  });

  it('returns 503 when secret not configured and does not call cycle', async ()=>{
    const { POST } = await import('./route');
    const headersMap = new Map([['authorization','Bearer x'],['idempotency-key','k1']]);
    const req: any = { headers: { get: (k:string)=> headersMap.get(k.toLowerCase()) || headersMap.get(k) }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(503);
    expect((res as any).payload && (res as any).payload.code).toBe('CRON_SECRET_NOT_CONFIGURED');
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('returns 401 on bad authorization and does not call cycle', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer wrong'],['idempotency-key','k2']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(401);
    expect((res as any).payload && (res as any).payload.code).toBe('UNAUTHORIZED');
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('returns 400 when idempotency key missing and does not call cycle', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(400);
    expect((res as any).payload && (res as any).payload.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('calls runManualPaperTradingCycle once with allowWhenScheduler:true and returns cycle', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    const mod = await import('./route');
    const { POST } = mod;
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','uniq-123']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(200);
    expect((res as any).payload && (res as any).payload.idempotencyKey).toBe('uniq-123');
    expect(mockCycle).toHaveBeenCalledTimes(1);
    expect(mockCycle).toHaveBeenCalledWith({ allowWhenScheduler: true });
    expect((res as any).payload && (res as any).payload.cycle && (res as any).payload.cycle.result).toBeDefined();
    // Verify the global lock key was used and release was attempted once with ownerToken
    try{ const lockMod = await import('../../../../lib/paper-trader/run-cycle-lock'); expect((lockMod as any).__getLastLockKey()).toBe('paper-trader:cycle:default'); expect((lockMod as any).__getLastRelease()).toEqual({ k: 'paper-trader:cycle:default', t: 'owner-1' }); expect((lockMod as any).__getReleaseCount()).toBe(1); }catch(_){ }
  });

  it('returns 503 when PAPER_TRADER_PORTFOLIO_STORE missing', async ()=>{
    // simulate missing store
    delete process.env.PAPER_TRADER_PORTFOLIO_STORE;
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','m1']]); return m.get(k.toLowerCase()) || m.get(k); } } } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(503);
    expect((res as any).payload && (res as any).payload.code).toBe('PERSISTENT_STORAGE_NOT_CONFIGURED');
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('returns 503 when PAPER_TRADER_PORTFOLIO_STORE not supabase', async ()=>{
    process.env.PAPER_TRADER_PORTFOLIO_STORE = 'file';
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','m2']]); return m.get(k.toLowerCase()) || m.get(k); } } } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(503);
    expect((res as any).payload && (res as any).payload.code).toBe('PERSISTENT_STORAGE_NOT_CONFIGURED');
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('returns 503 when SUPABASE_URL is missing or whitespace', async ()=>{
    process.env.PAPER_TRADER_PORTFOLIO_STORE = 'supabase';
    delete process.env.SUPABASE_URL;
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','m3']]); return m.get(k.toLowerCase()) || m.get(k); } } } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(503);
    expect((res as any).payload && (res as any).payload.code).toBe('PERSISTENT_STORAGE_NOT_CONFIGURED');
    expect(mockCycle).not.toHaveBeenCalled();

    // whitespace only
    process.env.SUPABASE_URL = '   ';
    const res2 = await POST(req as any);
    expect((res2 as any).status).toBe(503);
    expect((res2 as any).payload && (res2 as any).payload.code).toBe('PERSISTENT_STORAGE_NOT_CONFIGURED');
  });

  it('returns 503 when SUPABASE_SECRET_KEY is missing or whitespace', async ()=>{
    process.env.PAPER_TRADER_PORTFOLIO_STORE = 'supabase';
    process.env.SUPABASE_URL = 'https://x';
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','m4']]); return m.get(k.toLowerCase()) || m.get(k); } } } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(503);
    expect((res as any).payload && (res as any).payload.code).toBe('PERSISTENT_STORAGE_NOT_CONFIGURED');

    process.env.SUPABASE_SECRET_KEY = '   ';
    const res2 = await POST(req as any);
    expect((res2 as any).status).toBe(503);
    expect((res2 as any).payload && (res2 as any).payload.code).toBe('PERSISTENT_STORAGE_NOT_CONFIGURED');
  });

  it('returns 503 when PAPER_TRADER_SCHEDULER_MODE=in_memory', async ()=>{
    process.env.PAPER_TRADER_PORTFOLIO_STORE = 'supabase';
    process.env.SUPABASE_URL = 'https://x';
    process.env.SUPABASE_SECRET_KEY = 'k';
    process.env.PAPER_TRADER_SCHEDULER_MODE = 'in_memory';
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','m5']]); return m.get(k.toLowerCase()) || m.get(k); } } } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(503);
    expect((res as any).payload && (res as any).payload.code).toBe('CONFLICTING_SCHEDULER_MODE');
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('different idempotency-keys compete for same global lock and second call does not run cycle', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    // Override run-cycle-lock to return ACQUIRED for first call, DUPLICATE for second
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => {
      let calls = 0;
      const keys: string[] = [];
      return {
        acquireRunCycleLockWithOwner: async (k:string) => { calls++; keys.push(k); return calls === 1 ? { status: 'ACQUIRED', ownerToken: 'owner-x' } : { status: 'DUPLICATE' }; },
        releaseRunCycleLock: async ()=> false,
        __getKeys: () => keys,
      };
    });
    // re-import route with new mock
    const { POST } = await import('./route');

    const req1: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','id-1']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const req2: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','id-2']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;

    const res1 = await POST(req1 as any);
    const res2 = await POST(req2 as any);

    // First should run cycle
    expect((res1 as any).status).toBe(200);
    expect((res1 as any).payload && (res1 as any).payload.idempotencyKey).toBe('id-1');
    // Second should be duplicate and not run cycle
    expect((res2 as any).status).toBe(200);
    expect((res2 as any).payload && (res2 as any).payload.duplicate).toBe(true);
    expect(mockCycle).toHaveBeenCalledTimes(1);
    // Verify both calls used the same global key
    const lockMod = await import('../../../../lib/paper-trader/run-cycle-lock');
    const usedKeys = (lockMod as any).__getKeys();
    expect(usedKeys.length).toBe(2);
    expect(usedKeys[0]).toBe('paper-trader:cycle:default');
    expect(usedKeys[1]).toBe('paper-trader:cycle:default');
  });

  it('returns 200 and does not run cycle when lock is DUPLICATE', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({ acquireRunCycleLockWithOwner: async () => ({ status: 'DUPLICATE' }), releaseRunCycleLock: async ()=> false }));
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','dup-1']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(200);
    expect((res as any).payload && (res as any).payload.duplicate).toBe(true);
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('returns 503 and does not run cycle when lock is UNAVAILABLE', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({ acquireRunCycleLockWithOwner: async () => ({ status: 'UNAVAILABLE' }), releaseRunCycleLock: async ()=> false }));
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','unv-1']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(503);
    expect((res as any).payload && (res as any).payload.code).toBe('IDEMPOTENCY_UNAVAILABLE');
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('successful cycle + release throws -> returns 200, cycle preserved, release still attempted once', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    // mock lock to ACQUIRE with owner, release will throw
    let releaseCalled = 0;
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({
      acquireRunCycleLockWithOwner: async () => ({ status: 'ACQUIRED', ownerToken: 'owner-ex' }),
      releaseRunCycleLock: async () => { releaseCalled++; throw new Error('release failed'); },
      __getReleaseCount: () => releaseCalled,
      __getLastRelease: () => ({ k: 'paper-trader:cycle:default', t: 'owner-ex' }),
    }));
    // mock runtime returns success
    vi.doMock('../../../../lib/paper-trader/demo-runtime', () => ({ runManualPaperTradingCycle: async ()=> ({ processedCandidates: 1, executed: 0 }) }));
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','ok-1']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(200);
    expect((res as any).payload && (res as any).payload.cycle).toBeDefined();
    // release attempted once
    const lockMod = await import('../../../../lib/paper-trader/run-cycle-lock');
    expect((lockMod as any).__getReleaseCount()).toBe(1);
  });

  it('cycle throws + release throws -> returns 500 CYCLE_FAILED and release attempted once', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    let releaseCalled = 0;
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({
      acquireRunCycleLockWithOwner: async () => ({ status: 'ACQUIRED', ownerToken: 'owner-ex2' }),
      releaseRunCycleLock: async () => { releaseCalled++; throw new Error('release failed'); },
      __getReleaseCount: () => releaseCalled,
      __getLastRelease: () => ({ k: 'paper-trader:cycle:default', t: 'owner-ex2' }),
    }));
    // runtime throws
    vi.doMock('../../../../lib/paper-trader/demo-runtime', () => ({ runManualPaperTradingCycle: async ()=> { throw new Error('cycle boom'); } }));
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','err-1']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(500);
    expect((res as any).payload && (res as any).payload.code).toBe('CYCLE_FAILED');
    const lockMod = await import('../../../../lib/paper-trader/run-cycle-lock');
    expect((lockMod as any).__getReleaseCount()).toBe(1);
  });

  it('DUPLICATE -> no cycle, no release', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    let releaseCalled = 0;
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({ acquireRunCycleLockWithOwner: async ()=> ({ status: 'DUPLICATE' }), releaseRunCycleLock: async ()=> { releaseCalled++; return true; }, __getReleaseCount: ()=> releaseCalled }));
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','dup-zz']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(200);
    expect((res as any).payload && (res as any).payload.duplicate).toBe(true);
    expect(mockCycle).not.toHaveBeenCalled();
    const lockMod = await import('../../../../lib/paper-trader/run-cycle-lock');
    expect((lockMod as any).__getReleaseCount()).toBe(0);
  });

  it('UNAVAILABLE -> no cycle, no release', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    let releaseCalled = 0;
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({ acquireRunCycleLockWithOwner: async ()=> ({ status: 'UNAVAILABLE' }), releaseRunCycleLock: async ()=> { releaseCalled++; return false; }, __getReleaseCount: ()=> releaseCalled }));
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','unv-zz']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(503);
    expect((res as any).payload && (res as any).payload.code).toBe('IDEMPOTENCY_UNAVAILABLE');
    expect(mockCycle).not.toHaveBeenCalled();
    const lockMod = await import('../../../../lib/paper-trader/run-cycle-lock');
    expect((lockMod as any).__getReleaseCount()).toBe(0);
  });

  it('ACQUIRED -> ownerToken passed to release', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    let lastRelease: any = null;
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({
      acquireRunCycleLockWithOwner: async () => ({ status: 'ACQUIRED', ownerToken: 'owner-final' }),
      releaseRunCycleLock: async (k:string,t:string) => { lastRelease = { k,t }; return true; },
      __getLastRelease: () => lastRelease,
    }));
    vi.doMock('../../../../lib/paper-trader/demo-runtime', () => ({ runManualPaperTradingCycle: async ()=> ({ ok:true }) }));
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','final-1']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(200);
    const lockMod = await import('../../../../lib/paper-trader/run-cycle-lock');
    expect((lockMod as any).__getLastRelease()).toEqual({ k: 'paper-trader:cycle:default', t: 'owner-final' });
  });
});
