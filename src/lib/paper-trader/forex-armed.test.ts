import { describe, it, expect } from 'vitest';
import { buildForexReadinessState } from './forex-readiness';
import { getPaperTradingState, setForexAutonomyArmed, getForexAutonomyArmed } from './demo-runtime';

describe('forex armed state', ()=>{
  it('defaults to false and is not set by readiness', ()=>{
    const now = new Date('2026-08-01T12:00:00.000Z');
    const fr = buildForexReadinessState({ now, instruments: [], quotes: [] });
    // default getter should be false
    expect(getForexAutonomyArmed()).toBe(false);
  });

  it('setter updates only armed flag and is exposed in state defensively', async ()=>{
    // ensure default false
    expect(getForexAutonomyArmed()).toBe(false);
    setForexAutonomyArmed(true);
    expect(getForexAutonomyArmed()).toBe(true);
    const st = await getPaperTradingState();
    expect(st.forexAutonomyArmed).toBe(true);
    // reset back
    setForexAutonomyArmed(false);
    expect(getForexAutonomyArmed()).toBe(false);
  });
});
