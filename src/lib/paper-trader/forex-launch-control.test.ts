import { describe, it, expect } from 'vitest';
import { buildForexLaunchControlState } from './forex-launch-control';
import { buildForexReadinessState } from './forex-readiness';

describe('Forex launch control builder', ()=>{
  it('blocks when session closed', ()=>{
    const sat = new Date('2026-08-01T12:00:00.000Z');
    const fr = buildForexReadinessState({ now: sat, instruments: [], quotes: [] });
    const lc = buildForexLaunchControlState({ now: sat, forexReadiness: fr, autonomousEnabled: true, schedulerEnabled: true, cycleLocked: false, isArmed: true });
    expect(lc.status).toBe('BLOCKED');
    expect(Array.isArray(lc.blockingReasons)).toBe(true);
    expect(lc.blockingReasons).toContain('FOREX_SESSION_CLOSED');
  });

  it('is ARMED when readiness passes and armed flag set', ()=>{
    const now = new Date('2026-07-30T12:00:00.000Z');
    const instruments = [ { id: 'EUR_USD', providerSymbol: 'EUR_USD', assetType: 'FOREX', tradingEnabled: true, marketDataEnabled: true, quoteCurrency: 'USD' }, { id: 'USD_SEK', providerSymbol: 'USD_SEK', assetType: 'FOREX', tradingEnabled: false, marketDataEnabled: true } ];
    const quotes = [ { instrumentId: 'EUR_USD', marketTimestamp: now.toISOString(), price: 1.1 }, { instrumentId: 'USD_SEK', marketTimestamp: now.toISOString(), price: 10 } ];
    const fr = buildForexReadinessState({ now, instruments, quotes });
    const lc = buildForexLaunchControlState({ now, forexReadiness: fr, autonomousEnabled: true, schedulerEnabled: true, cycleLocked: false, isArmed: true });
    // Status must be ARMED when readiness passes and armed flag set
    expect(lc.status).toBe('ARMED');
  });
});
