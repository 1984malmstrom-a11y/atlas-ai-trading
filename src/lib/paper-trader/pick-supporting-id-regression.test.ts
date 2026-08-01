import { describe, it, expect } from 'vitest';
import { pickSupportingSignalIds } from './demo-runtime';

describe('pickSupportingSignalIds regression: no id-text fallback', ()=>{
  it('A: MARKET_TREND id contains bull but no evidence.marketSentiment -> not chosen for BUY', ()=>{
    const ms = { signals: [ { id: 'trend-bull-legacy', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', evidence: {} } ] } as any;
    const picked = pickSupportingSignalIds(ms, 'X', 'BUY');
    expect(picked).toEqual([]);
  });

  it('B: MARKET_TREND id contains bear but no evidence.marketSentiment -> not chosen for SELL', ()=>{
    const ms = { signals: [ { id: 'trend-bearish-legacy', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', evidence: {} } ] } as any;
    const picked = pickSupportingSignalIds(ms, 'X', 'SELL');
    expect(picked).toEqual([]);
  });

  it('C1: MARKET_TREND with evidence.marketSentiment=BULLISH chosen for BUY', ()=>{
    const ms = { signals: [ { id: 't1', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', evidence: { marketSentiment: 'BULLISH' } } ] } as any;
    const picked = pickSupportingSignalIds(ms, 'X', 'BUY');
    expect(picked).toEqual(['t1']);
  });

  it('C2: MARKET_TREND with evidence.marketSentiment=BEARISH chosen for SELL', ()=>{
    const ms = { signals: [ { id: 't2', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', evidence: { marketSentiment: 'BEARISH' } } ] } as any;
    const picked = pickSupportingSignalIds(ms, 'X', 'SELL');
    expect(picked).toEqual(['t2']);
  });

  it('D1: TECHNICAL_MOMENTUM BULLISH chosen for BUY and not for SELL', ()=>{
    const ms = { signals: [ { id: 'technical_X', type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', direction: 'BULLISH', symbols: ['X'], evidence: {} } ] } as any;
    expect(pickSupportingSignalIds(ms, 'X', 'BUY')).toEqual(['technical_X']);
    expect(pickSupportingSignalIds(ms, 'X', 'SELL')).toEqual([]);
  });

  it('D2: TECHNICAL_MOMENTUM BEARISH chosen for SELL and not for BUY', ()=>{
    const ms = { signals: [ { id: 'technical_X', type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', direction: 'BEARISH', symbols: ['X'], evidence: {} } ] } as any;
    expect(pickSupportingSignalIds(ms, 'X', 'SELL')).toEqual(['technical_X']);
    expect(pickSupportingSignalIds(ms, 'X', 'BUY')).toEqual([]);
  });
});
