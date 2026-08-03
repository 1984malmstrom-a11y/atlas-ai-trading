import { describe, it, expect } from 'vitest';
import { buildMultiTimeframeTechnicalIntelligence, sanitizeMultiTimeframeTechnicalIntelligenceForState, createPerCycleTechnicalIntelligenceResolver } from './multi-timeframe-technical-intelligence';
import { adaptHistoricalClosesToCandles } from './demo-runtime';
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

  describe('adaptHistoricalClosesToCandles adapter', ()=>{
    it('returns 3 items with timestamp and close only for valid input', ()=>{
      const dates = ['2026-07-30','2026-07-31','2026-08-01'];
      const closes = [100, 101.5, 102.25];
      const hist = { symbol: 'EUR/USD', dates, closes };
      const out = adaptHistoricalClosesToCandles(hist);
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBe(3);
      for (let i=0;i<3;i++){
        expect(typeof out[i].timestamp).toBe('string');
        expect(isFinite(Date.parse(out[i].timestamp))).toBeTruthy();
        expect(typeof out[i].close).toBe('number');
        expect(out[i].close).toBe(closes[i]);
        // ensure extraneous fields are not present
        expect((out[i] as any).open).toBeUndefined();
        expect((out[i] as any).high).toBeUndefined();
        expect((out[i] as any).low).toBeUndefined();
        expect((out[i] as any).volume).toBeUndefined();
      }
    });

    it('filters out entries with invalid date or non-finite close', ()=>{
      const dates = ['2026-07-30','not-a-date','2026-08-01'];
      const closes = [100, NaN, 102];
      const hist = { symbol: 'EUR/USD', dates, closes };
      const out = adaptHistoricalClosesToCandles(hist);
      // only two valid entries (indexes 0 and 2)
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBe(2);
      expect(out[0].close).toBe(100);
      expect(out[1].close).toBe(102);
    });

    it('returns empty array for mismatched or empty arrays', ()=>{
      expect(adaptHistoricalClosesToCandles({} as any)).toEqual([]);
      expect(adaptHistoricalClosesToCandles({ dates: [], closes: [] })).toEqual([]);
      expect(adaptHistoricalClosesToCandles({ dates: ['2026-08-01'], closes: [] })).toEqual([]);
    });
  });
});
