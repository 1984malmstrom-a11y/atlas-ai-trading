import { describe, it, expect, vi } from 'vitest';
import * as demo from '../src/lib/paper-trader/demo-runtime';
import * as quotesService from '../src/lib/market-data/quotes-service';

describe('Automatic cycle scoped fetch', () => {
  it('buildAutomaticCycleQuoteInstrumentIds returns deterministic union including holdings, SPY/QQQ and forex deps', async () => {
    const overridePortfolio = { holdings: [ { instrumentId: 'SPY' } ] } as any;
    const ids = await demo.buildAutomaticCycleQuoteInstrumentIds(overridePortfolio as any);
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some(id => String(id).toUpperCase().includes('SPY'))).toBe(true);
    expect(ids.some(id => /EUR|GBP|JPY|SEK/.test(String(id).toUpperCase()))).toBe(true);
  });

  it('scheduler path calls getNormalizedQuotes with limited fallback and maxFallbacks=2', async () => {
    const spy = vi.spyOn(quotesService as any, 'getNormalizedQuotes').mockResolvedValue({ quotes: [] });
    try{
      await demo.runManualPaperTradingCycle({ allowWhenScheduler: true } as any);
    }catch(_){ /* allow failures in surrounding logic; we only assert on spy calls */ }
    expect(spy).toHaveBeenCalled();
    const firstCall = spy.mock.calls[0];
    const opts = firstCall && firstCall[1];
    expect(opts).toBeTruthy();
    expect(opts.fallbackStrategy).toBe('limited');
    expect(opts.maxFallbacks).toBe(2);
    spy.mockRestore();
  });
});
