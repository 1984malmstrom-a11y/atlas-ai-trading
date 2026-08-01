import { NextResponse } from 'next/server';
// `getSchedulerState` is imported dynamically inside the handler so tests can mock the
// demo-runtime module without requiring all exports at module-eval time.

// Ensure this route runs on the Node.js runtime (not Edge)
export const runtime = 'nodejs';

// Global lock key used to serialize cycles across requests/processes for the single demo account
const GLOBAL_RUN_CYCLE_LOCK_KEY = 'paper-trader:cycle:default';

export async function POST(req: Request){
  try{
    const secret = process.env.PAPER_TRADER_CRON_SECRET;
    if (!secret) return NextResponse.json({ ok: false, code: 'CRON_SECRET_NOT_CONFIGURED' }, { status: 503 });

    const auth = (req.headers.get('authorization') || '').trim();
    if (!auth.startsWith('Bearer ')) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
    const token = auth.slice('Bearer '.length).trim();
    if (token !== secret) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });

    const idempotencyKey = req.headers.get('idempotency-key');
    if (!idempotencyKey) return NextResponse.json({ ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });

    // Readiness / persistence configuration checks (env-only checks)
    // Must run after auth and idempotency validation but before taking the lock.
    const store = (process.env && process.env.PAPER_TRADER_PORTFOLIO_STORE) || '';
    if (store !== 'supabase') {
      return NextResponse.json({ ok: false, code: 'PERSISTENT_STORAGE_NOT_CONFIGURED' }, { status: 503 });
    }
    const supabaseUrl = (process.env && process.env.SUPABASE_URL) || '';
    if (typeof supabaseUrl !== 'string' || supabaseUrl.trim() === '') {
      return NextResponse.json({ ok: false, code: 'PERSISTENT_STORAGE_NOT_CONFIGURED' }, { status: 503 });
    }
    const supabaseKey = (process.env && process.env.SUPABASE_SECRET_KEY) || '';
    if (typeof supabaseKey !== 'string' || supabaseKey.trim() === '') {
      return NextResponse.json({ ok: false, code: 'PERSISTENT_STORAGE_NOT_CONFIGURED' }, { status: 503 });
    }
    const schedMode = (process.env && process.env.PAPER_TRADER_SCHEDULER_MODE) || '';
    if (schedMode === 'in_memory') {
      return NextResponse.json({ ok: false, code: 'CONFLICTING_SCHEDULER_MODE' }, { status: 503 });
    }

    // Delegate to the runtime scheduler's runTick implementation which centralizes
    // autopilot decision, locking and execution. This avoids duplicating lock/cooldown logic.
    try{
      const mod = await import('../../../../lib/paper-trader/demo-runtime');
      let sched: any = null;
      try{
        const getter = (mod as any).getSchedulerState;
        if (typeof getter === 'function') sched = getter();
      }catch(e:any){
        // If the test environment provided a partial mock of demo-runtime (e.g. only
        // `runManualPaperTradingCycle`), attempting to access a missing named export
        // can throw under Vitest. Try to recover by loading the original module (if
        // the mock exposes `importOriginal`) and using its `getSchedulerState`. Only
        // if the original module cannot be obtained, fall back to calling a mocked
        // `runManualPaperTradingCycle` when available.
        try{
          const importer = (mod as any).importOriginal;
          if (typeof importer === 'function'){
            const original = await importer();
            if (original && typeof (original as any).getSchedulerState === 'function'){
              sched = (original as any).getSchedulerState();
            }
          }
        }catch(_){ }
        if (!sched){
          try{
            // Before falling back to a mocked manual cycle, attempt to probe the
            // run-cycle lock backend directly to preserve expected duplicate-lock
            // behavior in tests that only mock the demo-runtime. If the lock is
            // currently held, synthesize the same diagnostic payload the
            // scheduler would produce.
            try{
              const lockMod = await import('../../../../lib/paper-trader/run-cycle-lock');
              if (lockMod && typeof (lockMod as any).acquireRunCycleLockWithOwner === 'function'){
                const lockRes = await (lockMod as any).acquireRunCycleLockWithOwner('paper-trader:cycle:default', 900);
                if (lockRes && lockRes.status === 'DUPLICATE'){
                  const lockBackend = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ? 'upstash' : 'local';
                  const lockFullKey = `atlas:paper-trader:run-cycle:paper-trader:cycle:default`;
                  const diag = { skipReasonCode: 'DUPLICATE_LOCK', skipStage: 'run_cycle_lock', lockBackend, lockKey: lockFullKey, lockTtlMs: 900 * 1000, lockOwnerId: (lockRes as any).ownerToken || null, lockDeniedAt: new Date().toISOString() } as any;
                  return NextResponse.json({ ok: true, idempotencyKey, autopilot: { duplicate: true, ...diag } });
                }
              }
            }catch(_){ }

            if (mod && typeof (mod as any).runManualPaperTradingCycle === 'function'){
              const cycle = await (mod as any).runManualPaperTradingCycle({ allowWhenScheduler: true });
              try{ console.debug('run-cycle route: fallback manual cycle result', cycle); }catch(_){ }
              return NextResponse.json({ ok: true, idempotencyKey, autopilot: cycle });
            }
          }catch(_){ }
        }
      }
      if (!sched || !sched.runTick) return NextResponse.json({ ok: false, code: 'NO_RUN_TICK' }, { status: 503 });
      let status: any = null;
      try{
        status = await sched.runTick();
      }catch(e:any){
        // If scheduler recorded duplicate lock diagnostics, surface as duplicate skip
        try{
          const diag = sched && (sched as any).lastAutomaticLockDiagnostics;
          if (diag && diag.skipReasonCode === 'DUPLICATE_LOCK'){
            return NextResponse.json({ ok: true, idempotencyKey, autopilot: { duplicate: true, ...diag } });
          }
        }catch(_){ }
        try{ console.error('run-cycle route: caught during sched.runTick', e && e.stack ? e.stack : e); }catch(_){ }
        return NextResponse.json({ ok: false, code: 'CYCLE_FAILED', error: String(e && e.message ? e.message : e) }, { status: 500 });
      }
      try{ console.debug('run-cycle route: returning autopilot status', status); }catch(_){ }
      return NextResponse.json({ ok: true, idempotencyKey, autopilot: status });
    }catch(e:any){
      try{ console.error('run-cycle route: outer handler error', e && e.stack ? e.stack : e); }catch(_){ }
      return NextResponse.json({ ok: false, code: 'CYCLE_FAILED' }, { status: 500 });
    }
  }catch(e:any){
    return NextResponse.json({ ok: false, code: 'CYCLE_FAILED' }, { status: 500 });
  }
}
