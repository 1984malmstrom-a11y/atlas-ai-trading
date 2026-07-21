const _so = 'server' + '-only';
void import(_so).catch(()=>{});
import { NextResponse } from 'next/server';
import { runVictorTradingCycle } from '../../../../../../src/domain/trading/victor-trading-engine';
import { DEFAULT_PAPER_AUTO_MANDATE } from '../../../../../../src/domain/trading/victor-types';

export async function POST(req: Request){
  try{
    const body = await req.json();
    const mode = body?.mode as any || DEFAULT_PAPER_AUTO_MANDATE.mode;
    const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode };
    const res = await runVictorTradingCycle({ mandate, trigger: 'MANUAL' });
    return NextResponse.json({ ok: true, res });
  }catch(err:any){
    console.error('Victor run error', err);
    return new NextResponse(JSON.stringify({ error: err.message || 'internal' }), { status: 500 });
  }
}
