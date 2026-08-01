import { describe, it, expect } from 'vitest';
import { buildForexReadinessState } from './forex-readiness';
import { TRADABLE_INSTRUMENTS } from '../market-data/instruments';

describe('Forex readiness builder', ()=>{
  it('closed session yields executionReadyCount=0 and stable counts', ()=>{
    // Pick a Saturday instant (UTC) that corresponds to NY Saturday
    const sat = new Date('2026-08-01T12:00:00.000Z');
    const instruments = TRADABLE_INSTRUMENTS;
    // empty quotes -> all unavailable
    const state = buildForexReadinessState({ now: sat, instruments, quotes: [] });
    expect(state.sessionStatus).toBe('CLOSED');
    expect(state.executionReadyCount).toBe(0);
    // tradingEnabled pairs should equal configured tradingEnabled in instruments
    const expectedTradingEnabled = TRADABLE_INSTRUMENTS.filter(i => String(i.assetType||'').toUpperCase() === 'FOREX' && i.tradingEnabled).length;
    expect(state.tradingEnabledPairCount).toBe(expectedTradingEnabled);
    // USD/SEK must be marketDataEnabled but not tradingEnabled
    const usdsek = TRADABLE_INSTRUMENTS.find(i => i.id === 'USD_SEK');
    expect(usdsek).toBeTruthy();
    expect(usdsek!.marketDataEnabled).toBeTruthy();
    expect(usdsek!.tradingEnabled).toBeFalsy();
    // JSON serializable
    expect(() => JSON.stringify(state)).not.toThrow();
  });
});
