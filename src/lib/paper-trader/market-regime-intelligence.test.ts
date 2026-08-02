import { describe, it, expect } from 'vitest';
import { detectMarketRegime } from './market-regime-intelligence';

describe('market-regime-intelligence', () => {
  it('detects bull trend', () => {
    const res = detectMarketRegime({
      longTrend: 'UP', mediumTrend: 'UP', shortTrend: 'UP',
      momentumPersistence: 'STRONG', observationCount: 90, dataQuality: 'COMPLETE'
    });
    expect(res.regime).toBe('BULL_TREND');
    expect(res.confidence).toBeGreaterThan(0.7);
    expect(res.strength).toBeGreaterThan(0);
    expect(res.supportingSignals.some(s=> s.startsWith('long:UP'))).toBeTruthy();
    expect(res.reasoning.some(r=> r.includes('Strong'))).toBeTruthy();
  });

  it('detects bear trend', () => {
    const res = detectMarketRegime({
      longTrend: 'DOWN', mediumTrend: 'DOWN', shortTrend: 'DOWN',
      momentumPersistence: 'STRONG', observationCount: 80, dataQuality: 'COMPLETE'
    });
    expect(res.regime).toBe('BEAR_TREND');
    expect(res.confidence).toBeGreaterThan(0.6);
    expect(res.strength).toBeLessThan(0);
  });

  it('detects sideways', () => {
    const res = detectMarketRegime({
      longTrend: 'SIDEWAYS', mediumTrend: 'SIDEWAYS', shortTrend: 'SIDEWAYS',
      volatilityState: 'NORMAL', momentumPersistence: 'WEAK', observationCount: 50, dataQuality: 'LIMITED'
    });
    expect(res.regime).toBe('SIDEWAYS');
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('detects breakout when strong trend + rising volume + high range position', () => {
    const res = detectMarketRegime({
      longTrend: 'UP', mediumTrend: 'UP', shortTrend: 'UP',
      volumeTrend: 'RISING', rangePosition: 0.92, observationCount: 70, dataQuality: 'COMPLETE'
    });
    expect(res.regime).toBe('BREAKOUT');
  });

  it('detects mean reversion when low volatility and weak strength', () => {
    const res = detectMarketRegime({
      longTrend: 'SIDEWAYS', mediumTrend: 'SIDEWAYS', shortTrend: 'SIDEWAYS',
      volatilityState: 'LOW', momentumPersistence: 'WEAK', observationCount: 80, dataQuality: 'COMPLETE'
    });
    expect(res.regime).toBe('MEAN_REVERSION');
  });

  it('detects high volatility', () => {
    const res = detectMarketRegime({
      volatilityState: 'HIGH', observationCount: 60, dataQuality: 'COMPLETE'
    });
    expect(res.regime).toBe('HIGH_VOLATILITY');
    expect(res.reasoning.some(r=> r.includes('Elevated volatility'))).toBeTruthy();
  });

  it('detects low volatility', () => {
    const res = detectMarketRegime({
      volatilityState: 'LOW', observationCount: 60, dataQuality: 'COMPLETE'
    });
    expect(res.regime).toBe('LOW_VOLATILITY');
  });

  it('returns UNKNOWN on insufficient data', () => {
    const res = detectMarketRegime({ observationCount: 2, dataQuality: 'INSUFFICIENT' });
    expect(res.regime).toBe('UNKNOWN');
    expect(res.confidence).toBeLessThan(0.2);
  });

  it('is deterministic for same input', () => {
    const inp = { longTrend: 'UP', mediumTrend: 'UP', shortTrend: 'SIDEWAYS', observationCount: 80, dataQuality: 'COMPLETE' } as const;
    const a = detectMarketRegime(inp); const b = detectMarketRegime(inp);
    expect(a).toEqual(b);
  });

  it('confidence increases with more observations for same directional strength', () => {
    const base = { longTrend: 'UP', mediumTrend: 'UP', shortTrend: 'UP', dataQuality: 'COMPLETE' } as const;
    const low = detectMarketRegime({ ...base, observationCount: 25 });
    const high = detectMarketRegime({ ...base, observationCount: 120 });
    expect(high.confidence).toBeGreaterThanOrEqual(low.confidence);
  });
});
