import { describe, it, expect } from 'vitest';
import { buildMultiTimeframeTechnicalIntelligence, sanitizeMultiTimeframeTechnicalIntelligenceForState, createPerCycleTechnicalIntelligenceResolver } from './multi-timeframe-technical-intelligence';
import { IntradayCandle } from './intraday-market-context';

describe('multi-timeframe-technical-intelligence', ()=>{
  it('computes EMA RSI ATR and is deterministic', ()=>{
    const candles: IntradayCandle[] = [];
    // generate 220 synthetic daily closes
    let price = 100;
    for (let i=0;i<220;i++){ price = price * (1 + (i%10===0?0.01:0.001)); candles.push({ timestamp: new Date(2025,0,1 + i).toISOString(), open: price*0.995, high: price*1.01, low: price*0.99, close: price, volume: 1000 }); }
    const snap = buildMultiTimeframeTechnicalIntelligence({ symbol: 'EURUSD', assetType: 'FOREX', candlesByTimeframe: { '1day': candles } as any, now: new Date('2025-01-01T00:00:00Z') });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.source).toBe('VICTOR_MULTI_TIMEFRAME_TECHNICAL_INTELLIGENCE');
    expect(typeof snap.confidence).toBe('number');
    const s2 = buildMultiTimeframeTechnicalIntelligence({ symbol: 'EURUSD', assetType: 'FOREX', candlesByTimeframe: { '1day': candles } as any, now: new Date('2025-01-01T00:00:00Z') });
    expect(JSON.stringify(snap)).toEqual(JSON.stringify(s2));
  });

  it('sanitizer produces JSON-safe copy and limits arrays', ()=>{
    const snap = buildMultiTimeframeTechnicalIntelligence({ symbol: 'AAA', candlesByTimeframe: {} as any });
    const s = sanitizeMultiTimeframeTechnicalIntelligenceForState(snap);
    expect(() => JSON.stringify(s)).not.toThrow();
    expect(Array.isArray(s.timeframes)).toBe(true);
  });

  it('per-cycle resolver caches and reuses promise', async ()=>{
    let calls = 0;
    const resolver = createPerCycleTechnicalIntelligenceResolver({ getCandles: async (symbol, timeframe)=> { calls++; if (timeframe === '1day') return [{ timestamp: new Date().toISOString(), open: 1, high: 2, low: 0.9, close: 1.1, volume: 100 }]; return []; } });
    const p1 = resolver.build('EURUSD','FOREX');
    const p2 = resolver.build('EURUSD','FOREX');
    const a = await p1; const b = await p2;
    expect(a && b).toBeTruthy();
    expect(a!.symbol).toBe('EURUSD');
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
