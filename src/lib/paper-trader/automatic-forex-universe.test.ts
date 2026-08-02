import { describe, it, expect } from 'vitest';
import { buildAutomaticAnalysisSymbols } from './demo-runtime';
import { TRADABLE_INSTRUMENTS } from '../market-data/instruments';
import { getForexSessionDiagnostics } from '../forex-market';

describe('Automatic analysis universe includes eligible FOREX', ()=>{
  it('includes EUR/USD and USD/SEK when session open and market data available', ()=>{
    const now = new Date('2026-08-02T21:30:00Z'); // NY 17:30 Sun -> open
    const candidates = TRADABLE_INSTRUMENTS.filter(i => i.id === 'EUR_USD' || i.id === 'USD_SEK');
    const symbols = buildAutomaticAnalysisSymbols(candidates, now, []);
    // USD_SEK is data-only but should be included for analysis
    expect(symbols.includes('EUR/USD')).toBe(true);
    expect(symbols.includes('USD/SEK')).toBe(true);
  });

  it('filters out disabled or marketDataEnabled=false instruments', ()=>{
    const now = new Date('2026-08-02T21:30:00Z');
    const eur = Object.assign({}, TRADABLE_INSTRUMENTS.find(i=>i.id==='EUR_USD'), { marketDataEnabled: false });
    const usd = Object.assign({}, TRADABLE_INSTRUMENTS.find(i=>i.id==='USD_SEK'));
    const symbols = buildAutomaticAnalysisSymbols([eur, usd], now, []);
    expect(symbols.includes('EUR/USD')).toBe(false);
    expect(symbols.includes('USD/SEK')).toBe(true);
  });

  it('does not include FOREX when session closed', ()=>{
    const now = new Date('2026-08-01T12:00:00Z'); // Saturday -> closed
    const candidates = TRADABLE_INSTRUMENTS.filter(i => i.id === 'EUR_USD' || i.id === 'USD_SEK');
    const symbols = buildAutomaticAnalysisSymbols(candidates, now, []);
    expect(symbols.includes('EUR/USD')).toBe(false);
    expect(symbols.includes('USD/SEK')).toBe(false);
  });
});
