import { NextResponse } from 'next/server';
import runtime, { executePaperTradeDecision } from '../../../lib/paper-trader/demo-runtime';
import { getNormalizedQuotes } from '../../../lib/market-data/quotes-service';
import { findInstrumentById } from '../../../lib/market-data/instruments';

export async function GET(){
  try{
    const state = await runtime.getPaperTradingState();
    return NextResponse.json(state);
  }catch(e:any){
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request){
  try{
    const body = await req.json().catch(()=> null);
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    // Backwards-compatible action handling (existing API)
    if (typeof body.action === 'string'){
      const action = body.action;
      if (action === 'RUN_CYCLE'){
        const cycle = await runtime.runManualPaperTradingCycle();
        const state = await runtime.getPaperTradingState();
        return NextResponse.json({ ok: true, cycle, state });
      }
      if (action === 'ENABLE'){
        await runtime.setPaperTradingEnabled(true);
        return NextResponse.json({ ok: true, enabled: true });
      }
      if (action === 'DISABLE'){
        await runtime.setPaperTradingEnabled(false);
        return NextResponse.json({ ok: true, enabled: false });
      }
    }

    // New: accept minimal trade requests
    // { instrumentId, side: 'BUY'|'SELL', quantity }
    const { instrumentId, side, quantity } = body as any;
    if (instrumentId && typeof side === 'string' && (side.toUpperCase() === 'BUY' || side.toUpperCase() === 'SELL')){
      if (typeof quantity !== 'number' || !isFinite(quantity) || quantity <= 0){
        return NextResponse.json({ ok: false, code: 'INVALID_ORDER', message: 'quantity must be a positive number' }, { status: 400 });
      }

      // validate instrument exists
      const inst = findInstrumentById(String(instrumentId));
      if (!inst) return NextResponse.json({ ok: false, code: 'INVALID_ORDER', message: 'Unknown instrumentId' }, { status: 400 });
      if (!inst.enabled) return NextResponse.json({ ok: false, code: 'QUOTE_UNAVAILABLE', message: 'Instrument disabled for trading' }, { status: 422 });

      // fetch normalized quotes server-side
      const quotesRes = await getNormalizedQuotes();
      const quote = Array.isArray(quotesRes.quotes) ? quotesRes.quotes.find((q:any)=> q.instrumentId === inst.id) : null;
      if (!quote) return NextResponse.json({ ok: false, code: 'QUOTE_UNAVAILABLE', message: 'Quote not available for instrument' }, { status: 404 });

      // validate quote integrity
      if (!Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0) return NextResponse.json({ ok: false, code: 'QUOTE_UNAVAILABLE', message: 'Invalid quote price' }, { status: 422 });
      if (quote.isStale) return NextResponse.json({ ok: false, code: 'STALE_QUOTE', message: 'Quote is stale' }, { status: 422 });
      if (quote.dataStatus === 'UNAVAILABLE') return NextResponse.json({ ok: false, code: 'QUOTE_UNAVAILABLE', message: 'Quote data unavailable' }, { status: 422 });

      // Build decision for engine: request notional = quantity * price
      const requestedNotionalSek = Number(quantity) * Number(quote.price);
      const decision = {
        id: `api_trade_${inst.id}_${Date.now()}`,
        symbol: (inst.providerSymbol || quote.symbol || '').toString().toUpperCase(),
        action: side.toUpperCase(),
        confidence: 100,
        referencePrice: Number(quote.price),
        requestedNotionalSek,
        generatedAt: new Date().toISOString(),
      } as any;

      // execute via runtime wrapper (keeps all engine/risk rules centralized)
      try{
        const { result, state } = await executePaperTradeDecision(decision as any);
        if (!result || !result.accepted){
          const code = result && result.code ? result.code : 'RISK_REJECTED';
          const message = result && result.message ? result.message : 'Order rejected by risk engine';
          return NextResponse.json({ ok: false, code, message }, { status: 409 });
        }

        const exec = result.execution as any;
        return NextResponse.json({ ok: true, trade: {
          instrumentId: inst.id,
          symbol: exec.symbol || decision.symbol,
          side: exec.side,
          quantity: exec.quantity,
          marketPrice: Number(quote.price),
          executionPrice: exec.executedPrice,
          fee: exec.fee,
          currency: quote.currency || inst.currency || null,
        }, portfolio: { cashBalance: state.availableCash, holdings: state.holdings } });
      }catch(e:any){
        return NextResponse.json({ ok: false, code: 'SERVER_ERROR', message: 'Failed to execute trade' }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Unknown action or invalid body' }, { status: 400 });
  }catch(e:any){
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
