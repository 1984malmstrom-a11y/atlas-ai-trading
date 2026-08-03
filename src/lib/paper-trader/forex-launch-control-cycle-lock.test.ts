import { describe, it, expect } from 'vitest';
import { buildForexLaunchControlState } from './forex-launch-control';

describe('Forex Launch Control cycleLocked semantics', () => {
  it('reports CYCLE_LOCKED when cycleLocked=true and cycleRunning=false', () => {
    const lc = buildForexLaunchControlState({
      now: new Date(),
      forexReadiness: { sessionStatus: 'OPEN', marketDataPairCount:0, tradingEnabledPairCount:0, quoteReadyCount:0, stalePairCount:0, unavailablePairCount:0, conversionReadyCount:0, conversionBlockedCount:0, executionReadyCount:0, blockedPairCount:0, checkedAt: new Date().toISOString(), notionalModel: 'UNAVAILABLE', blockingReasons: {} },
      autonomousEnabled: false,
      schedulerEnabled: false,
      cycleLocked: true,
      tradesToday: 0,
      maxTradesPerDay: 10,
      dailyLossSek: 0,
      dailyLossLimitSek: 1000,
      isArmed: false,
      cycleRunning: false,
    } as any);
    expect(Array.isArray(lc.blockingReasons)).toBe(true);
    expect(lc.blockingReasons.includes('CYCLE_LOCKED')).toBe(true);
  });

  it('does not report CYCLE_LOCKED when cycleLocked=false', () => {
    const lc = buildForexLaunchControlState({
      now: new Date(),
      forexReadiness: { sessionStatus: 'OPEN', marketDataPairCount:0, tradingEnabledPairCount:0, quoteReadyCount:0, stalePairCount:0, unavailablePairCount:0, conversionReadyCount:0, conversionBlockedCount:0, executionReadyCount:0, blockedPairCount:0, checkedAt: new Date().toISOString(), notionalModel: 'UNAVAILABLE', blockingReasons: {} },
      autonomousEnabled: false,
      schedulerEnabled: false,
      cycleLocked: false,
      tradesToday: 0,
      maxTradesPerDay: 10,
      dailyLossSek: 0,
      dailyLossLimitSek: 1000,
      isArmed: false,
      cycleRunning: false,
    } as any);
    expect(Array.isArray(lc.blockingReasons)).toBe(true);
    expect(lc.blockingReasons.includes('CYCLE_LOCKED')).toBe(false);
  });
});
