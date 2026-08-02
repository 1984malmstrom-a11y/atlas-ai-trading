import { describe, it, expect } from 'vitest';
import { resolveBenchmarkSymbol, buildBenchmarkMarketContext, sanitizeBenchmarkMarketContextForState, buildBenchmarkDataReadiness } from './benchmark-market-context';
import type { IntradayMarketContext } from './intraday-market-context';

function makeIntraday(symbol: string, changePercent: number | null, isFresh = true): IntradayMarketContext {
  return {
    schemaVersion: 1, source: 'TWELVE_DATA_INTRADAY', symbol: symbol.toUpperCase(), interval: '15min',
    observedAt: new Date().toISOString(), generatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), expiresAt: null, isFresh,
    coverage: 'COMPLETE', pointCount: 64,
    latest: { open: 100, high: 110, low: 90, close: 101, volume: 1000 },
    session: { openPrice: 100, highPrice: 110, lowPrice: 90, changePercent: changePercent, rangePercent: 0, cumulativeVolume: 10000 },
    momentum: { shortReturnPercent: null, volumeVsAverage: null, direction: 'UNKNOWN' },
    warnings: []
  } as any;
}

describe('resolveBenchmarkSymbol', ()=>{
  it('maps known tech tickers to QQQ', ()=>{
    expect(resolveBenchmarkSymbol({ providerSymbol: 'AAPL', assetType: 'STOCK' })).toBe('QQQ');
    expect(resolveBenchmarkSymbol('MSFT')).toBe('QQQ');
  });
  it('maps generic stock to SPY', ()=>{
    expect(resolveBenchmarkSymbol({ providerSymbol: 'TELIA', assetType: 'STOCK' })).toBe('SPY');
  });
  it('returns null for forex', ()=>{
    expect(resolveBenchmarkSymbol({ providerSymbol: 'EUR/USD', assetType: 'FOREX' })).toBeNull();
  });
});

describe('buildBenchmarkMarketContext', ()=>{
  it('computes relative strength and alignment OUTPERFORMING', ()=>{
    const sym = makeIntraday('AAPL', 1.0);
    const bm = makeIntraday('SPY', 0.2);
    const ctx = buildBenchmarkMarketContext({ symbolContext: sym, benchmarkContext: bm, benchmarkSymbol: 'SPY', now: new Date() });
    expect(ctx.relativeStrengthPercent).toBeCloseTo(0.8, 3);
    expect(ctx.alignment).toBe('OUTPERFORMING');
  });

  it('marks DIVERGING when directions opposite', ()=>{
    const sym = makeIntraday('X', 1.0);
    const bm = makeIntraday('SPY', -1.0);
    const ctx = buildBenchmarkMarketContext({ symbolContext: sym, benchmarkContext: bm, benchmarkSymbol: 'SPY', now: new Date() });
    expect(ctx.alignment).toBe('DIVERGING');
  });

  it('sanitizer returns JSON-safe copy and immutable', ()=>{
    const sym = makeIntraday('AAPL', 0.5);
    const bm = makeIntraday('SPY', 0.1);
    const ctx = buildBenchmarkMarketContext({ symbolContext: sym, benchmarkContext: bm, benchmarkSymbol: 'SPY', now: new Date() });
    const s = sanitizeBenchmarkMarketContextForState(ctx as any)!;
    expect(typeof s).toBe('object');
    expect(s.warnings).toBeInstanceOf(Array);
    // original not mutated after sanitize
    expect((ctx as any).warnings).toEqual(ctx.warnings);
  });
});

describe('benchmark builder edge cases', ()=>{
  it('FOREX or unknown instrument returns UNKNOWN mapping', ()=>{
    const unknown = buildBenchmarkMarketContext({ symbolContext: null, benchmarkContext: null, benchmarkSymbol: null, now: new Date() });
    expect(unknown.alignment).toBe('UNKNOWN');
  });

  it('UNDERPERFORMING and rounding to 4 decimals', ()=>{
    const sym = makeIntraday('X', -1.0);
    const bm = makeIntraday('SPY', -0.2);
    const ctx = buildBenchmarkMarketContext({ symbolContext: sym, benchmarkContext: bm, benchmarkSymbol: 'SPY', now: new Date() });
    expect(ctx.relativeStrengthPercent).toBeCloseTo(-0.8, 4);
    expect(ctx.alignment).toBe('UNDERPERFORMING');
  });

  it('ALIGNED when within threshold ±0.30', ()=>{
    const sym = makeIntraday('A', 0.25);
    const bm = makeIntraday('SPY', 0.0);
    const ctx = buildBenchmarkMarketContext({ symbolContext: sym, benchmarkContext: bm, benchmarkSymbol: 'SPY', now: new Date() });
    expect(ctx.relativeStrengthPercent).toBeCloseTo(0.25, 4);
    expect(ctx.alignment).toBe('ALIGNED');
  });

  it('UNKNOWN when symbol or benchmark context missing or stale', ()=>{
    const staleSym = makeIntraday('S', 0.5, false);
    const freshBm = makeIntraday('SPY', 0.2, true);
    const ctx1 = buildBenchmarkMarketContext({ symbolContext: staleSym, benchmarkContext: freshBm, benchmarkSymbol: 'SPY', now: new Date() });
    expect(ctx1.alignment).toBe('UNKNOWN');

    const ctx2 = buildBenchmarkMarketContext({ symbolContext: null, benchmarkContext: freshBm, benchmarkSymbol: 'SPY', now: new Date() });
    expect(ctx2.alignment).toBe('UNKNOWN');
  });

  it('sanitizer produces new top-level object and has defensive warnings', ()=>{
    const sym = makeIntraday('AAPL', 0.5);
    const bm = makeIntraday('SPY', 0.1);
    const ctx = buildBenchmarkMarketContext({ symbolContext: sym, benchmarkContext: bm, benchmarkSymbol: 'SPY', now: new Date() });
    const s1 = sanitizeBenchmarkMarketContextForState(ctx as any)!;
    const s2 = sanitizeBenchmarkMarketContextForState(s1 as any)!;
    expect(s1).not.toBe(ctx);
    expect(s2).not.toBe(s1);
    expect(Array.isArray(s1.warnings)).toBe(true);
  });

  it('readiness handles empty input and counts', ()=>{
    const rEmpty = buildBenchmarkDataReadiness([], new Date());
    expect(rEmpty.symbolCount).toBe(0);
    expect(Array.isArray(rEmpty.topBlockingReasons)).toBe(true);
  });
});
