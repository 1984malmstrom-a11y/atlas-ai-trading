import { test, expect } from 'vitest';
import { createPerCycleMacroEventResolver, buildMacroEventContext } from './macro-event-context';
import { buildMarketEventRiskContext } from './market-event-risk-context';

test('per-cycle macro resolver: one fetch per cycle and new cycle new fetch', async ()=>{
  let calls = 0;
  const fakeFetcher = async ()=>{
    calls++;
    // return a single HIGH event within 3 hours
    const now = new Date();
    const in3 = new Date(now.getTime() + 3*60*60*1000).toISOString();
    return [{ id: 'f1', name: 'FOMC', category: 'INTEREST_RATE', importance: 'HIGH', scheduled_at: in3 }];
  };

  const resolver1 = createPerCycleMacroEventResolver({ fetchMacroCalendar: fakeFetcher, timeoutMs: 2000 });
  const a = await resolver1.resolve();
  const b = await resolver1.resolve();
  expect(a).toEqual(b);
  expect(calls).toBe(1);

  // new cycle -> new resolver -> new fetch
  const resolver2 = createPerCycleMacroEventResolver({ fetchMacroCalendar: fakeFetcher, timeoutMs: 2000 });
  const c = await resolver2.resolve();
  expect(calls).toBe(2);

  // combine into MarketEventRisk when earnings absent -> macro HIGH should produce HIGH
  const mer = buildMarketEventRiskContext({ symbol: 'AAA', earnings: null, macro: a, now: new Date() } as any);
  expect(mer.overallRisk).toBe('HIGH');
});
