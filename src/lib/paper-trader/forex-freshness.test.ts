import { it, describe, expect } from 'vitest';
import { buildForexReadinessState } from './forex-readiness';

describe('forex readiness freshness alignment', () => {
  it('treats normalized quote with isStale=false as fresh even if age > maxAge', () => {
    const now = new Date('2026-08-03T06:00:00.000Z');
    // marketTimestamp 3 minutes earlier -> age 180000 > default maxAge 120000
    const oldTs = new Date(now.getTime() - 180_000).toISOString();
    const quotes = [ {
      instrumentId: 'EUR_USD', symbol: 'EUR/USD', marketTimestamp: oldTs, fetchedAt: new Date(now.getTime()-170000).toISOString(), price: 1.15, dataStatus: 'DELAYED', isStale: false
    }, {
      instrumentId: 'USD_SEK', symbol: 'USD/SEK', marketTimestamp: oldTs, fetchedAt: new Date(now.getTime()-170000).toISOString(), price: 10, dataStatus: 'DELAYED', isStale: false
    } ];
    const state = buildForexReadinessState({ now, instruments: [ { id: 'EUR_USD', assetType: 'FOREX', providerSymbol: 'EUR/USD', marketDataEnabled: true, enabled: true, tradingEnabled: true, quoteCurrency: 'USD' }, { id: 'USD_SEK', assetType: 'FOREX', providerSymbol: 'USD/SEK', marketDataEnabled: true, enabled: true, tradingEnabled: false, quoteCurrency: 'SEK' } ], quotes, maxAgeMs: 120_000 });
    // Both quotes should be considered quoteReady (isStale=false wins over age)
    expect(state.quoteReadyCount).toBeGreaterThanOrEqual(2);
  });
});
