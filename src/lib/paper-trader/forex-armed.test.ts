import { describe, it, expect, vi } from 'vitest';

describe('forex armed state', ()=>{
  it('defaults to false and is not set by readiness', async ()=>{
    // import runtime after ensuring env not set
    vi.resetModules();
    vi.unstubAllEnvs?.();
    const mod = await import('./demo-runtime');
    const { getForexAutonomyArmed, getPaperTradingState } = mod as any;
    expect(getForexAutonomyArmed()).toBe(false);
    const st = await getPaperTradingState();
    expect(st.forexAutonomyArmed).toBe(false);
  });

  it('setter updates only armed flag and is exposed in state defensively', async ()=>{
    vi.resetModules();
    const mod = await import('./demo-runtime');
    const { setForexAutonomyArmed, getForexAutonomyArmed, getPaperTradingState } = mod as any;
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

  it('respects PAPER_TRADER_FOREX_AUTONOMY_ARMED env=true/false/whitespace', async ()=>{
    // env=true
    vi.resetModules();
    vi.stubEnv('PAPER_TRADER_FOREX_AUTONOMY_ARMED', 'true');
    const m1 = await import('./demo-runtime');
    expect(m1.getForexAutonomyArmed()).toBe(true);
    // env=false
    vi.resetModules();
    vi.stubEnv('PAPER_TRADER_FOREX_AUTONOMY_ARMED', 'false');
    const m2 = await import('./demo-runtime');
    expect(m2.getForexAutonomyArmed()).toBe(false);
    // env whitespace/case
    vi.resetModules();
    vi.stubEnv('PAPER_TRADER_FOREX_AUTONOMY_ARMED', '  TrUe  ');
    const m3 = await import('./demo-runtime');
    expect(m3.getForexAutonomyArmed()).toBe(true);
    // env missing
    vi.resetModules();
    vi.unstubAllEnvs?.();
    const m4 = await import('./demo-runtime');
    expect(m4.getForexAutonomyArmed()).toBe(false);
  });
});
