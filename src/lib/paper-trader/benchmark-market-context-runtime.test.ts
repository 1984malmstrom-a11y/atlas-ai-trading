import { describe, it, expect } from 'vitest';
import { createPerCycleIntradayResolver } from './demo-runtime';
import { createPerCycleBenchmarkResolver } from './demo-runtime';

describe('benchmark runtime resolver', ()=>{
  it('reuses SPY intraday fetch when multiple symbols share benchmark', async ()=>{
    const calls: string[] = [];
    // mock intraday resolver that records calls and returns simple contexts
    const mockIntraday = {
      resolve: async ({ symbol }:{ symbol: string })=>{
        calls.push(String(symbol).toUpperCase());
        // return a minimal intraday context-like object used by benchmark builder
        return { symbol: String(symbol).toUpperCase(), isFresh: true, coverage: 'COMPLETE', observedAt: new Date().toISOString(), generatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), source: 'TWELVE_DATA_INTRADAY', schemaVersion: 1, interval: '15min', pointCount: 64, latest: { open: 100, high: 101, low: 99, close: 100, volume: null }, session: { openPrice: 100, highPrice: 101, lowPrice: 99, changePercent: 0.2, rangePercent: 0, cumulativeVolume: null }, momentum: { shortReturnPercent: null, volumeVsAverage: null, direction: 'UNKNOWN' }, warnings: [] } as any;
      }
    };

    const benchResolver = createPerCycleBenchmarkResolver({ intradayResolver: mockIntraday, updateState: ()=>{} });

    // Two different symbols that both map to SPY by default
    const p1 = benchResolver.resolve({ symbol: 'TELIA', instrument: { providerSymbol: 'TELIA', assetType: 'STOCK' }, analyzed: true });
    const p2 = benchResolver.resolve({ symbol: 'MSFT', instrument: { providerSymbol: 'MSFT', assetType: 'STOCK' }, analyzed: true });
    const [r1, r2] = await Promise.all([p1, p2]);
    // ensure SPY was requested once (benchmark) and individual symbols requested once each
    const upper = calls.map(c=> c.toUpperCase());
    const spyCount = upper.filter(c=> c === 'SPY').length;
    expect(spyCount).toBe(1);
    // symbols resolved also present
    expect(upper).toContain('TELIA');
    expect(upper).toContain('MSFT');
    // contexts returned
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
  });

  it('reuses QQQ for tech tickers and ensures one request per cycle, new cycle creates new request, FOREX skipped, failure isolation', async ()=>{
    const calls: string[] = [];
    // mock intraday resolver that records calls and sometimes fails
    const mockIntraday = {
      resolve: async ({ symbol }:{ symbol: string })=>{
        const s = String(symbol).toUpperCase();
        calls.push(s);
        // simulate provider failure for BADSYM
        if (s === 'BADSYM') throw new Error('PROVIDER_FAIL');
        // simulate benchmark failure for BADBM
        if (s === 'BADBM') return null;
        return { symbol: s, isFresh: true, coverage: 'COMPLETE', observedAt: new Date().toISOString(), generatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), source: 'TWELVE_DATA_INTRADAY', schemaVersion: 1, interval: '15min', pointCount: 64, latest: { open: 100, high: 101, low: 99, close: 100, volume: null }, session: { openPrice: 100, highPrice: 101, lowPrice: 99, changePercent: 0.2, rangePercent: 0, cumulativeVolume: null }, momentum: { shortReturnPercent: null, volumeVsAverage: null, direction: 'UNKNOWN' }, warnings: [] } as any;
      }
    };

    const benchResolver = createPerCycleBenchmarkResolver({ intradayResolver: mockIntraday, updateState: ()=>{} });

    // two tech tickers map to QQQ
    const p1 = benchResolver.resolve({ symbol: 'AAPL', instrument: { providerSymbol: 'AAPL', assetType: 'STOCK' }, analyzed: true });
    const p2 = benchResolver.resolve({ symbol: 'MSFT', instrument: { providerSymbol: 'MSFT', assetType: 'STOCK' }, analyzed: true });
    const [r1, r2] = await Promise.all([p1, p2]);
    const upper = calls.map(c=> c.toUpperCase());
    const qCount = upper.filter(c=> c === 'QQQ').length;
    expect(qCount).toBe(1);

    // new cycle: create new resolver and expect new QQQ request
    const calls2: string[] = [];
    const mockIntraday2 = { resolve: async ({ symbol }:{ symbol: string })=>{ calls2.push(String(symbol).toUpperCase()); return { symbol: String(symbol).toUpperCase(), isFresh: true, coverage: 'COMPLETE', observedAt: new Date().toISOString(), generatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), source: 'TWELVE_DATA_INTRADAY', schemaVersion: 1, interval: '15min', pointCount: 64, latest: { open: 100, high: 101, low: 99, close: 100, volume: null }, session: { openPrice: 100, highPrice: 101, lowPrice: 99, changePercent: 0.2, rangePercent: 0, cumulativeVolume: null }, momentum: { shortReturnPercent: null, volumeVsAverage: null, direction: 'UNKNOWN' }, warnings: [] } as any } };
    const benchResolver2 = createPerCycleBenchmarkResolver({ intradayResolver: mockIntraday2, updateState: ()=>{} });
    await benchResolver2.resolve({ symbol: 'AAPL', instrument: { providerSymbol: 'AAPL', assetType: 'STOCK' }, analyzed: true });
    const upper2 = calls2.map(c=> c.toUpperCase());
    const qCount2 = upper2.filter(c=> c === 'QQQ').length;
    expect(qCount2).toBe(1);

    // FOREX should not trigger benchmark
    const benchResolver3 = createPerCycleBenchmarkResolver({ intradayResolver: mockIntraday, updateState: ()=>{} });
    const forex = await benchResolver3.resolve({ symbol: 'EUR/USD', instrument: { providerSymbol: 'EUR/USD', assetType: 'FOREX' }, analyzed: true });
    expect(forex).toBeNull();

    // provider failure for a symbol should not block another
    const benchResolver4 = createPerCycleBenchmarkResolver({ intradayResolver: mockIntraday, updateState: ()=>{} });
    const pBad = benchResolver4.resolve({ symbol: 'BADSYM', instrument: { providerSymbol: 'BADSYM', assetType: 'STOCK' }, analyzed: true });
    const pOk = benchResolver4.resolve({ symbol: 'TELIA', instrument: { providerSymbol: 'TELIA', assetType: 'STOCK' }, analyzed: true });
    const [badRes, okRes] = await Promise.all([pBad, pOk]);
    expect(okRes).not.toBeNull();

    // benchmark failure (null benchmark intraday) yields UNKNOWN-context (sanitized)
    const benchResolver5 = createPerCycleBenchmarkResolver({ intradayResolver: mockIntraday, updateState: ()=>{} });
    const resBadBm = await benchResolver5.resolve({ symbol: 'X', instrument: { providerSymbol: 'X', assetType: 'STOCK' }, analyzed: true });
    expect(resBadBm).not.toBeNull();
  });
});
