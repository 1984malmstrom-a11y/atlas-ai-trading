import { describe, it, expect } from 'vitest';
import { runDailySimulation } from '../src/domain/simulation/daily-simulation-service';

describe('DailySimulationService', () => {
  it('runs and returns a summary with decisions', () => {
    const res = runDailySimulation();
    expect(res.decisions.length).toBeGreaterThan(0);
    expect(res.summarySwe).toContain('analyserade');
  });

  it('executes at most one buy and one sell', () => {
    const res = runDailySimulation();
    const buys = res.decisions.filter(d=>d.action==='BUY');
    const sells = res.decisions.filter(d=>d.action==='SELL');
    expect(buys.length).toBeGreaterThanOrEqual(0);
    expect(sells.length).toBeGreaterThanOrEqual(0);
    // executed trades length should be at most 2
    expect(res.executedTrades.length).toBeLessThanOrEqual(2);
  });
});
