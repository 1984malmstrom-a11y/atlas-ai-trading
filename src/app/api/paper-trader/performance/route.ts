import { NextResponse } from 'next/server';
import runtime from '../../../../lib/paper-trader/demo-runtime';

export async function GET(){
  try{
    if (!runtime || typeof runtime.getPerformanceSummary !== 'function'){
      return NextResponse.json({ ok: false, error: 'PERFORMANCE_UNAVAILABLE' }, { status: 500 });
    }
    const perf = await runtime.getPerformanceSummary();
    return NextResponse.json({ ok: true, performance: perf });
  }catch(e:any){
    return NextResponse.json({ ok: false, error: 'PERFORMANCE_UNAVAILABLE' }, { status: 500 });
  }
}

export default {} as any;
