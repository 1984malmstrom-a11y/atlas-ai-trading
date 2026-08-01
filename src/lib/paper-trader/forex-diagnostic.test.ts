import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __clearAudits, __listAudits, __setTestTrader, __setTestPortfolio, runManualPaperTradingCycle, setForexAutonomyArmed } from './demo-runtime';

describe('Forex DIAGNOSTIC_ONLY enforcement', ()=>{
  beforeEach(async ()=>{
    await __clearAudits();
    setForexAutonomyArmed(false);
    // inject a trader that would throw if called (should not be invoked)
    __setTestTrader({ handleDecision: async ()=> { throw new Error('handleDecision should not be called in DIAGNOSTIC_ONLY'); } });
    // inject a portfolio adapter that would throw on applyExecution
    __setTestPortfolio({ getPortfolio: async ()=> ({ id: 'p', baseCurrency: 'SEK', availableCash: 100000, totalValue: 100000, holdings: [{ symbol: 'EUR/USD', quantity: 1, averagePrice: 100, currentPrice: 100 }] }), applyExecution: async ()=> { throw new Error('applyExecution must not be called in DIAGNOSTIC_ONLY'); } });
  });

  afterEach(()=>{
    try{ vi.useRealTimers(); }catch(_){ }
  });

  it('blocks forex broker and portfolio mutation when not armed', async ()=>{
    // Use deterministic fake system time during this test so session/eligibility is stable
    const fixed = new Date('2026-08-03T10:00:00.000Z');
    vi.useFakeTimers(); vi.setSystemTime(fixed);
    const quotes = [{ symbol: 'EUR/USD', providerSymbol: 'EUR/USD', price: 95, currency: 'USD', timestamp: fixed.toISOString() }];
    const portfolio = { id: 'p', baseCurrency: 'SEK', availableCash: 100000, totalValue: 100000, holdings: [{ symbol: 'EUR/USD', quantity: 1, averagePrice: 100, currentPrice: 100 }] };
    const res = await runManualPaperTradingCycle({ overrideUniverse: { quotes, portfolio }, allowWhenScheduler: false });
    // Ensure no execution audits present and a REJECT with FOREX_DIAGNOSTIC_ONLY exists
    const audits = await __listAudits();
    const exec = audits.find(a=> a && ((a.raw && a.raw.kind === 'EXECUTION') || a.kind === 'EXECUTION'));
    expect(exec).toBeUndefined();
    const blocked = audits.find(a=> a && (((a.raw && a.raw.kind === 'REJECT') && a.raw.reason && a.raw.reason.code === 'FOREX_DIAGNOSTIC_ONLY') || (a.kind === 'REJECT' && a.reason && a.reason.code === 'FOREX_DIAGNOSTIC_ONLY')));
    expect(blocked).toBeTruthy();
  });
});
