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
    // default lock returns ACQUIRED
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({ acquireRunCycleLock: async () => 'ACQUIRED' }));
  });

  afterEach(()=>{
    delete process.env.PAPER_TRADER_CRON_SECRET;
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
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','uniq-123']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(200);
    expect((res as any).payload && (res as any).payload.idempotencyKey).toBe('uniq-123');
    expect(mockCycle).toHaveBeenCalledTimes(1);
    expect(mockCycle).toHaveBeenCalledWith({ allowWhenScheduler: true });
    expect((res as any).payload && (res as any).payload.cycle && (res as any).payload.cycle.result).toBeDefined();
  });

  it('returns 200 and does not run cycle when lock is DUPLICATE', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({ acquireRunCycleLock: async () => 'DUPLICATE' }));
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','dup-1']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(200);
    expect((res as any).payload && (res as any).payload.duplicate).toBe(true);
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('returns 503 and does not run cycle when lock is UNAVAILABLE', async ()=>{
    process.env.PAPER_TRADER_CRON_SECRET = 's3cr3t';
    vi.doMock('../../../../lib/paper-trader/run-cycle-lock', () => ({ acquireRunCycleLock: async () => 'UNAVAILABLE' }));
    const { POST } = await import('./route');
    const req: any = { headers: { get: (k:string)=> { const m = new Map([['authorization','Bearer s3cr3t'],['idempotency-key','unv-1']]); return m.get(k.toLowerCase()) || m.get(k); } }, json: async ()=> ({}) } as any;
    const res = await POST(req as any);
    expect((res as any).status).toBe(503);
    expect((res as any).payload && (res as any).payload.code).toBe('IDEMPOTENCY_UNAVAILABLE');
    expect(mockCycle).not.toHaveBeenCalled();
  });
});
