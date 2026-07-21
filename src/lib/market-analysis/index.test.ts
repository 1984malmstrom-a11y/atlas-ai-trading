import { describe, it, expect } from 'vitest';
import analyzeMarket from './index';

function baseContext(overrides:any={}){
  return {
    generatedAt: new Date().toISOString(),
    marketDataStatus: 'READY',
    summary: { instrumentCount: 5, advancing: 2, declining: 2, unchanged: 1, unavailable: 0, averageChangePercent: 0 },
    instruments: [],
    warnings: [],
    ...overrides,
  } as any;
}

describe('analyzeMarket', ()=>{
  it('Bullish when more advancing and positive average', ()=>{
    const ctx = baseContext({ summary: { instrumentCount:5, advancing:3, declining:1, unchanged:1, unavailable:0, averageChangePercent: 1.2 }, instruments: [
      { symbol: 'A', changePercent: 2 }, { symbol: 'B', changePercent: 1 }, { symbol: 'C', changePercent: -0.5 }
    ] });
    const out = analyzeMarket(ctx);
    expect(out.marketSentiment).toBe('BULLISH');
    expect(out.marketStrength).toBeGreaterThan(50);
  });

  it('Bearish when more declining and negative average', ()=>{
    const ctx = baseContext({ summary: { instrumentCount:5, advancing:1, declining:3, unchanged:1, unavailable:0, averageChangePercent: -1.5 }, instruments: [
      { symbol: 'A', changePercent: -2 }, { symbol: 'B', changePercent: -1 }, { symbol: 'C', changePercent: 0.5 }
    ] });
    const out = analyzeMarket(ctx);
    expect(out.marketSentiment).toBe('BEARISH');
    expect(out.marketStrength).toBeLessThan(50);
  });

  it('Neutral when balanced', ()=>{
    const ctx = baseContext({ summary: { instrumentCount:4, advancing:1, declining:1, unchanged:2, unavailable:0, averageChangePercent: 0 }, instruments: [
      { symbol: 'A', changePercent: 0 }, { symbol: 'B', changePercent: 0 }
    ] });
    const out = analyzeMarket(ctx);
    expect(out.marketSentiment).toBe('NEUTRAL');
  });

  it('High volatility when large spread', ()=>{
    const ctx = baseContext({ instruments: [ { symbol: 'X', changePercent: 5 }, { symbol: 'Y', changePercent: -4 } ] });
    const out = analyzeMarket(ctx);
    expect(out.volatility).toBe('HIGH');
  });

  it('Low volatility when small spread', ()=>{
    const ctx = baseContext({ instruments: [ { symbol: 'X', changePercent: 0.5 }, { symbol: 'Y', changePercent: 0.6 } ] });
    const out = analyzeMarket(ctx);
    expect(out.volatility).toBe('LOW');
  });

  it('Unavailable instruments affect strength and add partial warning', ()=>{
    const ctx = baseContext({ summary: { instrumentCount:4, advancing:2, declining:1, unchanged:0, unavailable:1, averageChangePercent: 0.5 }, instruments: [ { symbol: 'A', changePercent:1 }, { symbol: 'B', changePercent:-0.5 } ] });
    const out = analyzeMarket(ctx);
    expect(out.warnings).toContain('Partial market coverage.');
    expect(out.marketStrength).toBeLessThan(100);
  });

  it('Delayed data produces a warning but analysis proceeds', ()=>{
    const ctx = baseContext({ warnings: ['Marknadsdata är fördröjd.'], instruments: [ { symbol: 'A', changePercent: 1 } ] });
    const out = analyzeMarket(ctx);
    expect(out.warnings).toContain('Market data delayed.');
    expect(out.insights.length).toBeGreaterThanOrEqual(0);
  });

  it('Stale data triggers stale warning', ()=>{
    const ctx = baseContext({ instruments: [ { symbol: 'A', changePercent: 1, dataStatus: 'STALE' } ] });
    const out = analyzeMarket(ctx);
    expect(out.warnings).toContain('Market data stale.');
  });

  it('Strongest and weakest are correct', ()=>{
    const ctx = baseContext({ instruments: [ { instrumentId: '1', symbol: 'S', name:'S', changePercent: 3 }, { instrumentId: '2', symbol: 'W', name:'W', changePercent: -2 } ] });
    const out = analyzeMarket(ctx);
    expect(out.strongest?.symbol).toBe('S');
    expect(out.weakest?.symbol).toBe('W');
  });

  it('Handles no valid quotes gracefully', ()=>{
    const ctx = baseContext({ instruments: [], summary: { instrumentCount:0, advancing:0, declining:0, unchanged:0, unavailable:0, averageChangePercent: 0 } });
    const out = analyzeMarket(ctx);
    expect(out.marketStrength).toBeGreaterThanOrEqual(0);
    expect(out.insights).toBeInstanceOf(Array);
  });
});
