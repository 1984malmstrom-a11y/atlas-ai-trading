import { NextResponse } from 'next/server';
import { runManualPaperTradingCycle } from '../../../../lib/paper-trader/demo-runtime';
import { acquireRunCycleLockWithOwner, releaseRunCycleLock } from '../../../../lib/paper-trader/run-cycle-lock';

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

    // Acquire a single global distributed lock for the demo account so different
    // request idempotency-keys still compete for the same cycle slot.
    try {
      const lockRes = await acquireRunCycleLockWithOwner(GLOBAL_RUN_CYCLE_LOCK_KEY);
      if (lockRes.status === 'DUPLICATE') {
        return NextResponse.json({ ok: true, duplicate: true, idempotencyKey });
      }
      if (lockRes.status === 'UNAVAILABLE') {
        return NextResponse.json({ ok: false, code: 'IDEMPOTENCY_UNAVAILABLE' }, { status: 503 });
      }

      // ACQUIRED -> proceed to run cycle and ensure we release the lock in finally
      const ownerToken = (lockRes as any).ownerToken;
      let cycleResult: any = null;
      let cycleError: any = null;
      try{
        cycleResult = await runManualPaperTradingCycle({ allowWhenScheduler: true });
      }catch(e:any){
        cycleError = e;
      }finally{
        try{
          // best-effort release; do not let release errors override cycle outcome
          await releaseRunCycleLock(GLOBAL_RUN_CYCLE_LOCK_KEY, ownerToken);
        }catch(_){ /* swallow */ }
      }

      if (cycleError) return NextResponse.json({ ok: false, code: 'CYCLE_FAILED' }, { status: 500 });
      return NextResponse.json({ ok: true, idempotencyKey, cycle: cycleResult });
    } catch (e: any) {
      return NextResponse.json({ ok: false, code: 'CYCLE_FAILED' }, { status: 500 });
    }
  }catch(e:any){
    return NextResponse.json({ ok: false, code: 'CYCLE_FAILED' }, { status: 500 });
  }
}
