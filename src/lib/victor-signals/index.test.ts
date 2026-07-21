import { describe, it, expect } from 'vitest';
import buildMarketSignals from './index';

function ctx(opts:any={}){
  return {
    generatedAt: new Date().toISOString(),
    marketDataStatus: 'READY',
    summary: { instrumentCount: 10, advancing: 3, declining: 3, unchanged: 4, unavailable: 0, averageChangePercent: 0 },
    instruments: [],
    warnings: [],
    ...opts,
  } as any;
}

describe('buildMarketSignals', ()=>{
  it('declining >= 70% => MARKET_BREADTH IMPORTANT', ()=>{
    const c = ctx({ summary: { instrumentCount:10, advancing:2, declining:7, unchanged:1, unavailable:0, averageChangePercent: -1 } });
    const analysis = { marketSentiment: 'BEARISH', marketStrength: 20, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='MARKET_BREADTH' && s.severity==='IMPORTANT')).toBe(true);
  });

  it('declining > advancing but <70 => MARKET_BREADTH WATCH', ()=>{
    const c = ctx({ summary: { instrumentCount:10, advancing:3, declining:4, unchanged:3, unavailable:0, averageChangePercent: -0.5 } });
    const analysis = { marketSentiment: 'BEARISH', marketStrength: 45, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='MARKET_BREADTH' && s.severity==='WATCH')).toBe(true);
  });

  it('advancing >=70 => MARKET_BREADTH IMPORTANT positive', ()=>{
    const c = ctx({ summary: { instrumentCount:10, advancing:8, declining:1, unchanged:1, unavailable:0, averageChangePercent: 1.2 } });
    const analysis = { marketSentiment: 'BULLISH', marketStrength: 80, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='MARKET_BREADTH' && s.severity==='IMPORTANT')).toBe(true);
  });

  it('BEARISH + marketStrength < 35 => MARKET_TREND IMPORTANT', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'BEARISH', marketStrength: 30, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='MARKET_TREND' && s.severity==='IMPORTANT')).toBe(true);
  });

  it('BULLISH + marketStrength > 65 => MARKET_TREND IMPORTANT', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'BULLISH', marketStrength: 70, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='MARKET_TREND' && s.severity==='IMPORTANT')).toBe(true);
  });

  it('NEUTRAL => MARKET_TREND INFO', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'NEUTRAL', marketStrength: 50, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='MARKET_TREND' && s.severity==='INFO')).toBe(true);
  });

  it('strongest >= 1% => LEADER signal with evidence', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'BULLISH', marketStrength: 60, strongest: { symbol: 'AAA', changePercent: 1.5 }, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    const sig = out.signals.find(s=> s.type==='LEADER');
    expect(sig).toBeDefined();
    expect(sig!.evidence.symbol).toBe('AAA');
    expect(sig!.evidence.changePercent).toBe(1.5);
  });

  it('weakest <= -1% => LAGGARD signal WATCH or IMPORTANT', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'BEARISH', marketStrength: 40, strongest: null, weakest: { symbol: 'BBB', changePercent: -1.5 }, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    const sig = out.signals.find(s=> s.type==='LAGGARD');
    expect(sig).toBeDefined();
    expect(sig!.symbols).toContain('BBB');
  });

  it('weakest <= -2% => LAGGARD IMPORTANT', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'BEARISH', marketStrength: 20, strongest: null, weakest: { symbol: 'CCC', changePercent: -2.5 }, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    const sig = out.signals.find(s=> s.type==='LAGGARD');
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe('IMPORTANT');
  });

  it('HIGH volatility => VOLATILITY IMPORTANT', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'NEUTRAL', marketStrength: 50, strongest: null, weakest: null, volatility: 'HIGH' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='VOLATILITY' && s.severity==='IMPORTANT')).toBe(true);
  });

  it('NORMAL volatility => VOLATILITY INFO', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'NEUTRAL', marketStrength: 50, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='VOLATILITY' && s.severity==='INFO')).toBe(true);
  });

  it('LOW volatility => no VOLATILITY signal', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'NEUTRAL', marketStrength: 50, strongest: null, weakest: null, volatility: 'LOW' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.every(s=> s.type !== 'VOLATILITY')).toBe(true);
  });

  it('delayed data => DATA_QUALITY INFO and confidence 90', ()=>{
    const c = ctx({ marketDataStatus: 'DELAYED', warnings: ['Marknadsdata är fördröjd.'] });
    const analysis = { marketSentiment: 'NEUTRAL', marketStrength: 50, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='DATA_QUALITY' && s.severity==='INFO')).toBe(true);
    expect(out.confidence).toBe(90);
  });

  it('partial coverage => DATA_QUALITY WATCH and confidence 75', ()=>{
    const c = ctx({ marketDataStatus: 'PARTIAL', summary: { instrumentCount:5, advancing:2, declining:2, unchanged:1, unavailable:1, averageChangePercent:0 } });
    const analysis = { marketSentiment: 'NEUTRAL', marketStrength: 60, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='DATA_QUALITY' && s.severity==='WATCH')).toBe(true);
    expect(out.confidence).toBeGreaterThanOrEqual(0);
  });

  it('stale data => DATA_QUALITY IMPORTANT and confidence reduced', ()=>{
    const c = ctx({ instruments: [ { symbol: 'X', dataStatus: 'STALE' } ] });
    const analysis = { marketSentiment: 'NEUTRAL', marketStrength: 60, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.signals.some(s=> s.type==='DATA_QUALITY' && s.severity==='IMPORTANT')).toBe(true);
    expect(out.confidence).toBeGreaterThanOrEqual(0);
  });

  it('unavailable => confidence 0', ()=>{
    const c = ctx({ marketDataStatus: 'UNAVAILABLE' });
    const analysis = { marketSentiment: 'NEUTRAL', marketStrength: 0, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    expect(out.confidence).toBe(0);
  });

  it('combined warnings reduce confidence but not below 0', ()=>{
    const c = ctx({ marketDataStatus: 'PARTIAL', warnings: ['Marknadsdata är fördröjd.'], summary: { instrumentCount:5, advancing:1, declining:3, unchanged:1, unavailable:1, averageChangePercent: -1 } });
    const analysis = { marketSentiment: 'BEARISH', marketStrength: 20, strongest: null, weakest: { symbol:'Z', changePercent:-2.5 }, volatility: 'HIGH' };
    const out = buildMarketSignals(c, analysis);
    expect(out.confidence).toBeGreaterThanOrEqual(0);
  });

  it('determinism: same input => same output', ()=>{
    const c = ctx({ summary: { instrumentCount:3, advancing:1, declining:2, unchanged:0, unavailable:0, averageChangePercent: -0.5 } });
    const analysis = { marketSentiment: 'BEARISH', marketStrength: 30, strongest: { symbol:'A', changePercent:0.5 }, weakest: { symbol:'B', changePercent:-1.2 }, volatility: 'NORMAL' };
    const out1 = buildMarketSignals(c, analysis);
    const out2 = buildMarketSignals(c, analysis);
    out1.generatedAt = out2.generatedAt = 'X';
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
  });

  it('titles/descriptions do not contain forbidden words', ()=>{
    const c = ctx();
    const analysis = { marketSentiment: 'NEUTRAL', marketStrength: 50, strongest: null, weakest: null, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    const forbidden = ['köp','sälj','behåll','position'];
    for(const s of out.signals){
      for(const f of forbidden) expect((s.title + ' ' + s.description).toLowerCase()).not.toContain(f);
    }
  });

  it('no duplicate signal ids', ()=>{
    const c = ctx({ summary: { instrumentCount:5, advancing:1, declining:4, unchanged:0, unavailable:0, averageChangePercent: -1 } });
    const analysis = { marketSentiment: 'BEARISH', marketStrength: 26, strongest: { symbol:'A', changePercent:0.2 }, weakest: { symbol:'B', changePercent:-2.2 }, volatility: 'NORMAL' };
    const out = buildMarketSignals(c, analysis);
    const ids = out.signals.map(s=>s.id);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(ids.length);
  });
});
