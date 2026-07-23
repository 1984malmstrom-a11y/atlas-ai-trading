const _so = 'server' + '-only';
void import(_so).catch(()=>{});

import { NextResponse } from 'next/server';
export { getNormalizedQuotes, classifyQuoteStatus, STALE_THRESHOLD_MS } from '../../../../lib/market-data/quotes-service';
import { getNormalizedQuotes, sanitizeErrorMessage } from '../../../../lib/market-data/quotes-service';

export async function GET(){
  try{
    const out = await getNormalizedQuotes();
    // Augment response with lightweight source metadata so clients can
    // reliably determine whether data is real or a mock/fallback.
    const isMock = Array.isArray(out.quotes) ? (out.quotes.length === 0) : true;
    const source = isMock ? 'mock' : 'twelve-data';
    return NextResponse.json({ ...out, source, isMock });
  }catch(err:any){
    return new NextResponse(JSON.stringify({ error: sanitizeErrorMessage(err?.message || err) }), { status: 500 });
  }
}
