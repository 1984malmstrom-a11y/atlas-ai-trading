import { NextResponse } from 'next/server';
import { runManualPaperTradingCycle } from '../../../../lib/paper-trader/demo-runtime';

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

    // Call exactly one cycle; allowWhenScheduler true so scheduler guards are bypassed for manual cron trigger
    try{
      const cycle = await runManualPaperTradingCycle({ allowWhenScheduler: true });
      return NextResponse.json({ ok: true, idempotencyKey, cycle });
    }catch(e:any){
      return NextResponse.json({ ok: false, code: 'CYCLE_FAILED' }, { status: 500 });
    }
  }catch(e:any){
    return NextResponse.json({ ok: false, code: 'CYCLE_FAILED' }, { status: 500 });
  }
}
