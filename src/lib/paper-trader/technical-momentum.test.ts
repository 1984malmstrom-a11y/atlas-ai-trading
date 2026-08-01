import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateDecision } from './decision-engine';
import * as sigModule from './signal-engine';

describe('TECHNICAL_MOMENTUM integration tests', ()=>{
  afterEach(()=>{ vi.restoreAllMocks(); });

  it('A. Bullish technical + bullish market -> BUY allowed', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 80, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 'tech_AAPL', type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', direction: 'BULLISH', symbols: ['AAPL'], evidence: { momentumPercent: 5 } }, { id: 'trend-1', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', evidence: { marketSentiment: 'BULLISH' } } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'AAPL', signals: ['tech_AAPL','trend-1'] }, expectedReturnPercent: 10, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    spy.mockRestore();
  });

  it('B. Bearish technical + bearish market -> SELL allowed', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'SELL', confidence: 80, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 'tech_MSFT', type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', direction: 'BEARISH', symbols: ['MSFT'], evidence: { momentumPercent: -6 } }, { id: 'breadth-1', type: 'MARKET_BREADTH', origin: 'MARKET_QUOTES_AGGREGATE', evidence: { declining: 10, advancing: 1 } } ], confidence: 80 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'MSFT', qty: 1 }] }, decision: { side: 'SELL', symbol: 'MSFT', signals: ['tech_MSFT','breadth-1'] }, expectedReturnPercent: -12, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('SELL');
    spy.mockRestore();
  });

  it('C. Bullish technical + bearish market -> HOLD', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 80, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 'tech_GOOG', type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', direction: 'BULLISH', symbols: ['GOOG'], evidence: { momentumPercent: 4 } }, { id: 'trend-bear', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', evidence: { marketSentiment: 'BEARISH' } } ], confidence: 85 } as any;
    // Simulate runtime: pickSupportingSignalIds would not include the bearish global trend for a BUY,
    // so only the technical signal would be passed as supporting id (resulting in HOLD due to insufficient independent evidence).
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'GOOG', signals: ['tech_GOOG'] }, expectedReturnPercent: 8, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    spy.mockRestore();
  });

  it('D. Neutral technical -> not used as support, HOLD when only one quote-origin', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 85, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 'trend-only', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', evidence: { marketSentiment: 'BULLISH' } } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'ANY', signals: ['trend-only'] }, expectedReturnPercent: 10, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    spy.mockRestore();
  });

  it('E. Two quote signals (different types but same origin) -> HOLD', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 88, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 't1', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' }, { id: 'b1', type: 'MARKET_BREADTH', origin: 'MARKET_QUOTES_AGGREGATE' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'X', signals: ['t1','b1'] }, expectedReturnPercent: 12, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    spy.mockRestore();
  });

  it('F. Stale/invalid technical data: no TECHNICAL_MOMENTUM -> HOLD', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 90, reasons: [] } as any));
    // Only a MARKET_TREND exists
    const marketSignals = { signals: [ { id: 'trend-1', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', evidence: { marketSentiment: 'BULLISH' } } ], confidence: 80 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'Y', signals: ['trend-1'] }, expectedReturnPercent: 11, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    spy.mockRestore();
  });
});
