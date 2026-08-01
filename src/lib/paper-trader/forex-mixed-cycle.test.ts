import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __clearAudits, __listAudits, __appendTestAudits, __setTestTrader, __setTestPortfolio, runManualPaperTradingCycle, setForexAutonomyArmed } from './demo-runtime';

describe('Mixed cycle: Forex blocked, Stock executes', ()=>{
  beforeEach(async ()=>{
    await __clearAudits();
    setForexAutonomyArmed(false);
  });

  afterEach(()=>{ try{ vi.useRealTimers(); }catch(_){ } });

  it('blocks EUR/USD but allows MSFT execution in same cycle', async ()=>{
    const fixed = new Date('2026-08-03T10:00:00.000Z');
    vi.useFakeTimers(); vi.setSystemTime(fixed);

    // initial portfolio: holds 1 EUR/USD and 1 MSFT (MSFT avgPrice high to trigger SELL)
    const portfolioState: any = { id: 'p', baseCurrency: 'SEK', availableCash: 200000, totalValue: 200000, holdings: [
      { symbol: 'EUR/USD', quantity: 1, averagePrice: 100, currentPrice: 100 },
      { symbol: 'MSFT', quantity: 1, averagePrice: 200, currentPrice: 200 }
    ] };

    // provide a simple portfolio adapter that mutates local state when applyExecution called
    const portfolioAdapter = {
      getPortfolio: async () => JSON.parse(JSON.stringify(portfolioState)),
      applyExecution: async (exec: any) => {
        // simulate applying MSFT execution (likely SELL in this test)
        if ((exec as any).symbol === 'MSFT'){
          const side = String((exec as any).side || '').toUpperCase();
          if (side === 'SELL'){
            // remove MSFT holding
            portfolioState.holdings = portfolioState.holdings.filter((h:any)=> String(h.symbol||'').toUpperCase() !== 'MSFT');
            portfolioState.availableCash = Math.round((portfolioState.availableCash + ((exec as any).executedPrice || 0) * ((exec as any).quantity || 1)) * 100)/100;
          } else {
            // BUY
            portfolioState.availableCash = Math.round((portfolioState.availableCash - ((exec as any).executedPrice || 0) * ((exec as any).quantity || 1)) * 100)/100;
            portfolioState.holdings.push({ symbol: 'MSFT', quantity: exec.quantity || 1, averagePrice: exec.executedPrice || 0, currentPrice: exec.executedPrice || 0 });
          }
          return JSON.parse(JSON.stringify(portfolioState));
        }
        throw new Error('Unexpected execution apply');
      }
    };

    __setTestPortfolio(portfolioAdapter as any);

    // Inject trader: allow MSFT execution, ensure Forex handleDecision is not invoked
    __setTestTrader({ handleDecision: async (cand: any) => {
      const sym = String(cand.symbol || '').toUpperCase();
      if (sym === 'MSFT'){
        const side = String(cand.action || 'BUY').toUpperCase();
        const exec = { accepted: true, execution: { id: 'exec-msft', symbol: 'MSFT', side, executedPrice: cand.referencePrice || 100, quantity: 1, fee: 0 } };
        // call portfolio adapter to simulate persistence
        await portfolioAdapter.applyExecution(exec.execution);
        // append an EXECUTION audit to the global audit store so tests can assert on it
        try{ await __appendTestAudits([{ kind: 'EXECUTION', timestamp: fixed.toISOString(), execution: exec.execution, portfolioBefore: { id: 'p' }, portfolioAfter: await portfolioAdapter.getPortfolio() } as any]); }catch(_){ }
        return exec;
      }
      // Should not be called for Forex when DIAGNOSTIC_ONLY
      throw new Error('handleDecision should not be called for Forex in DIAGNOSTIC_ONLY');
    } });

    // quotes: fresh for both instruments
    const quotes = [
      { symbol: 'EUR/USD', providerSymbol: 'EUR/USD', price: 95, currency: 'USD', timestamp: fixed.toISOString() },
      { symbol: 'MSFT', providerSymbol: 'MSFT', price: 150, currency: 'USD', timestamp: fixed.toISOString() }
    ];

    const res = await runManualPaperTradingCycle({ overrideUniverse: { quotes, portfolio: portfolioState }, allowWhenScheduler: false });

    const audits = await __listAudits();
    const forexRejected = audits.find(a=> a && ((a.raw && a.raw.kind === 'REJECT' && a.raw.reason && a.raw.reason.code === 'FOREX_DIAGNOSTIC_ONLY') || (a.kind === 'REJECT' && a.reason && a.reason.code === 'FOREX_DIAGNOSTIC_ONLY')));
    expect(forexRejected).toBeTruthy();

    // Ensure MSFT was analyzed/evaluated (stock path not blocked by Forex DIAGNOSTIC_ONLY)
    const msftEval = audits.find(a=> a && ((a.raw && a.raw.kind === 'EVALUATION' && a.raw.decision && String(a.raw.decision.symbol||'').toUpperCase() === 'MSFT') || (a.kind === 'EVALUATION' && a.decision && String(a.decision.symbol||'').toUpperCase() === 'MSFT')));
    const msftReject = audits.find(a=> a && ((a.raw && a.raw.kind === 'REJECT' && a.raw.decision && String(a.raw.decision.symbol||'').toUpperCase() === 'MSFT') || (a.kind === 'REJECT' && a.decision && String(a.decision.symbol||'').toUpperCase() === 'MSFT')));
    expect(msftEval).toBeTruthy();
    expect(msftReject).toBeFalsy();
  });
});
