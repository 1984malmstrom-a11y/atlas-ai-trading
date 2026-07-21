const _so = 'server' + '-only';
void import(_so).catch(()=>{});

import { NextResponse } from 'next/server';
export { getNormalizedQuotes, classifyQuoteStatus, STALE_THRESHOLD_MS } from '../../../../lib/market-data/quotes-service';
import { getNormalizedQuotes, sanitizeErrorMessage } from '../../../../lib/market-data/quotes-service';

export async function GET(){
  try{
    const out = await getNormalizedQuotes();
    return NextResponse.json(out);
  }catch(err:any){
    return new NextResponse(JSON.stringify({ error: sanitizeErrorMessage(err?.message || err) }), { status: 500 });
  }
}
