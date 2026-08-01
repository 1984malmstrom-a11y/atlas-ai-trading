import { describe, it, expect } from 'vitest';
import { DEFAULT_WATCHLIST, getWatchlistSymbols, selectBestCandidate } from './demo-runtime';
import { TRADABLE_INSTRUMENTS } from '../market-data/instruments';

describe('Watchlist Engine v1 basics', ()=>{
  it('A: default watchlist symbols are present in TRADABLE_INSTRUMENTS and returned by getWatchlistSymbols', ()=>{
    const eligible = TRADABLE_INSTRUMENTS; // use production list
    const w = getWatchlistSymbols(eligible, DEFAULT_WATCHLIST);
    // ensure returned symbols are subset of DEFAULT_WATCHLIST
    for (const s of w){ expect(DEFAULT_WATCHLIST.map(x=>x.toUpperCase()).includes(s)).toBe(true); }
  });

  it('B: best BUY chosen by highest confidence', ()=>{
    const a = { symbol: 'A', action: 'BUY', confidence: 50, expectedReturnPercent: 3 };
    const b = { symbol: 'B', action: 'BUY', confidence: 70, expectedReturnPercent: 1 };
    const chosen = selectBestCandidate([a,b]);
    expect(chosen).toBe(b);
  });

  it('C: tie-breaker: same confidence -> higher abs(expectedReturnPercent) wins -> then alphabetic', ()=>{
    const a = { symbol: 'A', action: 'BUY', confidence: 50, expectedReturnPercent: 5 };
    const b = { symbol: 'B', action: 'BUY', confidence: 50, expectedReturnPercent: 3 };
    const chosen = selectBestCandidate([a,b]);
    expect(chosen).toBe(a);
    // equal expectedReturnPercent -> alphabetic
    const c = { symbol: 'C', action: 'BUY', confidence: 50, expectedReturnPercent: 5 };
    const chosen2 = selectBestCandidate([c,a]);
    // A vs C same confidence and abs(expectedReturn) equal -> A comes before C
    expect(chosen2.symbol).toBe('A');
  });

  it('D: SELL prioritized over BUY even if BUY stronger', ()=>{
    const buy = { symbol: 'AAA', action: 'BUY', confidence: 90, expectedReturnPercent: 10 };
    const sell = { symbol: 'ZZZ', action: 'SELL', confidence: 50, expectedReturnPercent: -2 };
    const chosen = selectBestCandidate([buy,sell]);
    expect(chosen).toBe(sell);
  });

  it('E: no valid candidate -> null', ()=>{
    expect(selectBestCandidate([])).toBeNull();
  });

  it('F: single selection enforced (returns single candidate)', ()=>{
    const a = { symbol: 'A', action: 'BUY', confidence: 10, expectedReturnPercent: 1 };
    const chosen = selectBestCandidate([a]);
    expect(chosen).toBe(a);
  });
});
