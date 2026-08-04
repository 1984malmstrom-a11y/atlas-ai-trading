import { describe, it, expect } from 'vitest';
import { buildForexReadinessState } from './forex-readiness';

describe('Forex execution readiness - timestamp and freshness handling', () => {
  const baseNow = new Date('2026-08-04T00:00:00.000Z');
  const instruments = [
    { id: 'USD_SEK', providerSymbol: 'USD/SEK', assetType: 'FOREX', tradingEnabled: false, marketDataEnabled: true, enabled: true, quoteCurrency: 'SEK' },
    { id: 'EUR_USD', providerSymbol: 'EUR/USD', assetType: 'FOREX', tradingEnabled: true, marketDataEnabled: true, enabled: true, quoteCurrency: 'USD' },
  ];

  function makeQuotes(usdSekTs: any, eurUsdTs: any, overrides?: any){
    return [
      { instrumentId: 'usd-sek', symbol: 'USD/SEK', marketTimestamp: usdSekTs, fetchedAt: baseNow.toISOString(), price: 10, dataStatus: 'LIVE', isStale: false, ...(overrides?.usdSek||{}) },
      { instrumentId: 'EUR_USD', symbol: 'EUR/USD', marketTimestamp: eurUsdTs, fetchedAt: baseNow.toISOString(), price: 1.15, dataStatus: 'LIVE', isStale: false, ...(overrides?.eurUsd||{}) },
    ];
  }

  it('accepts numeric epoch seconds and ISO timestamp together', () => {
    const epochSec = Math.floor(baseNow.getTime()/1000) - 10; // seconds
    const iso = new Date(baseNow.getTime() - 60_000).toISOString();
    const fr = buildForexReadinessState({ now: baseNow, instruments, quotes: makeQuotes(epochSec, iso) });
    expect(fr.conversionReadyCount).toBeGreaterThanOrEqual(1);
    expect(fr.quoteReadyCount).toBeGreaterThanOrEqual(1);
  });

  it('accepts numeric epoch milliseconds', () => {
    const epochMs = (Math.floor(baseNow.getTime()/1000) - 20) * 1000;
    const iso = new Date(baseNow.getTime() - 60_000).toISOString();
    const fr = buildForexReadinessState({ now: baseNow, instruments, quotes: makeQuotes(epochMs, iso) });
    expect(fr.conversionReadyCount).toBeGreaterThanOrEqual(1);
    expect(fr.quoteReadyCount).toBeGreaterThanOrEqual(1);
  });

  it('accepts digit-string epoch seconds and digit-string epoch milliseconds', () => {
    const epochSec = String(Math.floor(baseNow.getTime()/1000) - 30);
    const epochMs = String((Math.floor(baseNow.getTime()/1000) - 40) * 1000);
    const fr1 = buildForexReadinessState({ now: baseNow, instruments, quotes: makeQuotes(epochSec, new Date(baseNow.getTime()-60_000).toISOString()) });
    const fr2 = buildForexReadinessState({ now: baseNow, instruments, quotes: makeQuotes(epochMs, new Date(baseNow.getTime()-60_000).toISOString()) });
    expect(fr1.conversionReadyCount).toBeGreaterThanOrEqual(1);
    expect(fr2.conversionReadyCount).toBeGreaterThanOrEqual(1);
  });

  it('accepts ISO timestamp', () => {
    const iso = new Date(baseNow.getTime() - 45_000).toISOString();
    const fr = buildForexReadinessState({ now: baseNow, instruments, quotes: makeQuotes(iso, iso) });
    expect(fr.quoteReadyCount).toBeGreaterThanOrEqual(1);
  });

  it('respects provider isStale = false (fresh accepted)', () => {
    const ts = new Date(baseNow.getTime() - 10_000).toISOString();
    const quotes = makeQuotes(ts, ts, { usdSek: { isStale: false }, eurUsd: { isStale: false } });
    const fr = buildForexReadinessState({ now: baseNow, instruments, quotes });
    expect(fr.stalePairCount).toBe(0);
    expect(fr.quoteReadyCount).toBeGreaterThanOrEqual(1);
  });

  it('respects provider isStale = true (quote marked stale even if age ok)', () => {
    const ts = new Date(baseNow.getTime() - 10_000).toISOString();
    const quotes = makeQuotes(ts, ts, { eurUsd: { isStale: true } });
    const fr = buildForexReadinessState({ now: baseNow, instruments, quotes });
    expect(fr.stalePairCount).toBeGreaterThanOrEqual(1);
    expect(fr.quoteReadyCount).toBeLessThanOrEqual(1);
  });

  it('handles missing or invalid timestamp safely', () => {
    const quotesInvalid = [
      { instrumentId: 'usd-sek', symbol: 'USD/SEK', marketTimestamp: null, fetchedAt: baseNow.toISOString(), price: 10, dataStatus: 'LIVE', isStale: false },
      { instrumentId: 'EUR_USD', symbol: 'EUR/USD', marketTimestamp: 'not-a-date', fetchedAt: baseNow.toISOString(), price: 1.15, dataStatus: 'LIVE', isStale: false },
    ];
    const fr = buildForexReadinessState({ now: baseNow, instruments, quotes: quotesInvalid });
    expect(fr.unavailablePairCount).toBeGreaterThanOrEqual(1);
  });

  it('does not misclassify a fresh quote as stale', () => {
    const ts = new Date(baseNow.getTime() - 30_000).toISOString(); // 30s old
    const fr = buildForexReadinessState({ now: baseNow, instruments, quotes: makeQuotes(ts, ts) });
    expect(fr.stalePairCount).toBe(0);
    expect(fr.quoteReadyCount).toBeGreaterThanOrEqual(1);
  });
});
