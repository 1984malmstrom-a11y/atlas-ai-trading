import { describe, it, expect } from 'vitest';
import { TRADABLE_INSTRUMENTS } from '../market-data/instruments';
import { getWatchlistSymbols, DEFAULT_WATCHLIST } from './demo-runtime';

describe('Watchlist instruments and TRADABLE_INSTRUMENTS', ()=>{
  it('A: TRADABLE_INSTRUMENTS contains all ten requested US tickers without duplicates', ()=>{
    const wanted = ['NVDA','MSFT','AAPL','META','AMZN','GOOGL','TSLA','AMD','NFLX','AVGO'];
    const present: string[] = [];
    for (const inst of TRADABLE_INSTRUMENTS){ if (inst && inst.providerSymbol) present.push(String(inst.providerSymbol).toUpperCase()); }
    for (const w of wanted){ expect(present.filter(p=>p===w).length).toBe(1); }
  });

  it('B: getWatchlistSymbols returns the ten when eligibleInstruments contains them', ()=>{
    // build an eligibleInstruments array that mimics TRADABLE_INSTRUMENTS entries for these symbols
    const eligible = TRADABLE_INSTRUMENTS.filter(i => i && i.providerSymbol && ['NVDA','MSFT','AAPL','META','AMZN','GOOGL','TSLA','AMD','NFLX','AVGO'].includes(String(i.providerSymbol).toUpperCase()));
    const w = getWatchlistSymbols(eligible, DEFAULT_WATCHLIST);
    const upper = w.map(s=>String(s).toUpperCase());
    for (const s of DEFAULT_WATCHLIST){ expect(upper.includes(String(s).toUpperCase())).toBe(true); }
    // ensure no duplicates
    const uniq = Array.from(new Set(upper));
    expect(uniq.length).toBe(upper.length);
  });

  it('C/D: FX pairs present with correct assetType and marketDataEnabled=true but tradingEnabled=false', ()=>{
    const fxWanted = [ { id: 'EUR_USD', sym: 'EUR/USD' }, { id: 'GBP_USD', sym: 'GBP/USD' }, { id: 'USD_JPY', sym: 'USD/JPY' } ];
    for (const f of fxWanted){
      const found = TRADABLE_INSTRUMENTS.find(i => i && (i.id === f.id || String(i.providerSymbol||'').toUpperCase() === f.sym.toUpperCase()));
      expect(found).toBeTruthy();
      if (found){
        expect(String(found.assetType).toUpperCase()).toBe('FOREX');
        expect(found.marketDataEnabled).toBe(true);
        expect(found.tradingEnabled).toBe(false);
      }
    }
  });

  it('E: No duplicate ids or providerSymbols in TRADABLE_INSTRUMENTS', ()=>{
    const ids = TRADABLE_INSTRUMENTS.map(i => String(i.id).toUpperCase());
    const syms = TRADABLE_INSTRUMENTS.map(i => String(i.providerSymbol || '').toUpperCase());
    const dupId = ids.length !== Array.from(new Set(ids)).length;
    const dupSym = syms.length !== Array.from(new Set(syms)).length;
    expect(dupId).toBe(false);
    expect(dupSym).toBe(false);
  });
});
