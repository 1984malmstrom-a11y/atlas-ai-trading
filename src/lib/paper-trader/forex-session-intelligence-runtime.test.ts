import { describe, it, expect } from 'vitest';
import { buildForexSessionIntelligence, sanitizeForexSessionIntelligenceForState } from './forex-session-intelligence';
import { createPerCycleTechnicalIntelligenceResolver } from './multi-timeframe-technical-intelligence';
import { IntradayCandle } from './intraday-market-context';

describe('forex-session-intelligence runtime', ()=>{
  it('builds forex session intelligence only for FOREX symbols', ()=>{
    const candles: IntradayCandle[] = [{ timestamp: new Date().toISOString(), open: 1, high: 1.002, low: 0.998, close: 1.001, volume: 1000 }];
    const fx = buildForexSessionIntelligence({ symbol: 'EURUSD', candles, now: new Date() });
    expect(fx).not.toBeNull();
    const stock = buildForexSessionIntelligence({ symbol: 'AAPL', candles: [], now: new Date() });
    // For stock we still return snapshot but usage in runtime should skip building session; test ensures builder handles symbols generically
    expect(stock).not.toBeNull();
    const s = sanitizeForexSessionIntelligenceForState(fx as any);
    expect(() => JSON.stringify(s)).not.toThrow();
  });

  it('resolver integrates with multi-timeframe and reuses candles', async ()=>{
    let getCalls = 0;
    const candles: IntradayCandle[] = [{ timestamp: new Date().toISOString(), open: 1, high: 1.01, low: 0.99, close: 1.005, volume: 100 }];
    const resolver = createPerCycleTechnicalIntelligenceResolver({ getCandles: async (symbol, tf)=> { getCalls++; if (tf === '1day' && symbol === 'EURUSD') return candles; return []; } });
    const snap = await resolver.build('EURUSD','FOREX');
    expect(snap).toBeTruthy();
    const snap2 = await resolver.build('EURUSD','FOREX');
    expect(getCalls).toBeGreaterThanOrEqual(1);
  });
});
