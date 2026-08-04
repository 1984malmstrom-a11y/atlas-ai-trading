import { describe, it, expect } from 'vitest';
import { isInstrumentBlockedByMacroEvent, buildMacroEventContext } from './macro-event-context';
import { createPerCycleDecisionIntelligenceResolver, buildSignalConfluenceSummary } from './signal-confluence';

function mkEvent(currency: string, importance: 'HIGH'|'MEDIUM'|'LOW', minutesFromNow: number, title = 'Macro Event'){
  const scheduled_at = new Date(Date.now() + minutesFromNow * 60000).toISOString();
  return { id: `${currency}_${Date.now()}`, event: title, currency, importance, scheduled_at, hoursUntil: minutesFromNow/60 } as any;
}

describe('Macro gate helper', () => {
  it('EUR HIGH-event 60 minutes away blocks EUR/USD', ()=>{
    const ev = mkEvent('EUR','HIGH',60,'EUR CPI');
    const ctx = buildMacroEventContext({ events: [ev], now: new Date() });
    const inst = { id: 'EUR_USD', providerSymbol: 'EUR/USD', baseAsset: 'EUR', quoteCurrency: 'USD', assetType: 'FOREX', symbol: 'EUR_USD' };
    const res = isInstrumentBlockedByMacroEvent({ macroContext: ctx, instrument: inst, now: new Date(), beforeMinutes: 120, afterMinutes: 30 });
    expect(res.blocked).toBe(true);
    expect(res.evidence && res.evidence.eventCurrency).toBe('EUR');
  });

  it('EUR event does not block GBP/USD', ()=>{
    const ev = mkEvent('EUR','HIGH',60,'EUR CPI');
    const ctx = buildMacroEventContext({ events: [ev], now: new Date() });
    const inst = { id: 'GBP_USD', providerSymbol: 'GBP/USD', baseAsset: 'GBP', quoteCurrency: 'USD', assetType: 'FOREX', symbol: 'GBP_USD' };
    const res = isInstrumentBlockedByMacroEvent({ macroContext: ctx, instrument: inst, now: new Date(), beforeMinutes: 120, afterMinutes: 30 });
    expect(res.blocked).toBe(false);
  });

  it('USD HIGH-event blocks EUR/USD and a US stock', ()=>{
    const ev = mkEvent('USD','HIGH',45,'US NFP');
    const ctx = buildMacroEventContext({ events: [ev], now: new Date() });
    const eur = { id: 'EUR_USD', providerSymbol: 'EUR/USD', baseAsset: 'EUR', quoteCurrency: 'USD', assetType: 'FOREX', symbol: 'EUR_USD' };
    const stock = { id: 'AAPL', providerSymbol: 'AAPL', baseAsset: null, quoteCurrency: 'USD', assetType: 'STOCK', symbol: 'AAPL' };
    expect(isInstrumentBlockedByMacroEvent({ macroContext: ctx, instrument: eur, now: new Date(), beforeMinutes: 120, afterMinutes: 30 }).blocked).toBe(true);
    expect(isInstrumentBlockedByMacroEvent({ macroContext: ctx, instrument: stock, now: new Date(), beforeMinutes: 120, afterMinutes: 30 }).blocked).toBe(true);
  });

  it('event 3 hours away does not block', ()=>{
    const ev = mkEvent('EUR','HIGH',180,'EUR Event');
    const ctx = buildMacroEventContext({ events: [ev], now: new Date() });
    const inst = { id: 'EUR_USD', providerSymbol: 'EUR/USD', baseAsset: 'EUR', quoteCurrency: 'USD', assetType: 'FOREX', symbol: 'EUR_USD' };
    expect(isInstrumentBlockedByMacroEvent({ macroContext: ctx, instrument: inst, now: new Date(), beforeMinutes: 120, afterMinutes: 30 }).blocked).toBe(false);
  });

  it('event 15 minutes after publication still blocks', ()=>{
    const ev = mkEvent('EUR','HIGH', -15, 'EUR Release');
    const ctx = buildMacroEventContext({ events: [ev], now: new Date() });
    const inst = { id: 'EUR_USD', providerSymbol: 'EUR/USD', baseAsset: 'EUR', quoteCurrency: 'USD', assetType: 'FOREX', symbol: 'EUR_USD' };
    expect(isInstrumentBlockedByMacroEvent({ macroContext: ctx, instrument: inst, now: new Date(), beforeMinutes: 120, afterMinutes: 30 }).blocked).toBe(true);
  });

  it('event 45 minutes after publication does not block', ()=>{
    const ev = mkEvent('EUR','HIGH', -45, 'EUR Release');
    const ctx = buildMacroEventContext({ events: [ev], now: new Date() });
    const inst = { id: 'EUR_USD', providerSymbol: 'EUR/USD', baseAsset: 'EUR', quoteCurrency: 'USD', assetType: 'FOREX', symbol: 'EUR_USD' };
    expect(isInstrumentBlockedByMacroEvent({ macroContext: ctx, instrument: inst, now: new Date(), beforeMinutes: 120, afterMinutes: 30 }).blocked).toBe(false);
  });

  it('MEDIUM event does not block', ()=>{
    const ev = mkEvent('EUR','MEDIUM',30,'EUR Medium');
    const ctx = buildMacroEventContext({ events: [ev], now: new Date() });
    const inst = { id: 'EUR_USD', providerSymbol: 'EUR/USD', baseAsset: 'EUR', quoteCurrency: 'USD', assetType: 'FOREX', symbol: 'EUR_USD' };
    expect(isInstrumentBlockedByMacroEvent({ macroContext: ctx, instrument: inst, now: new Date(), beforeMinutes: 120, afterMinutes: 30 }).blocked).toBe(false);
  });

  it('Decision Intelligence is still built (usableSignalCount preserved) when gate blocks', async ()=>{
    // create two simple mock signals to build a meaningful confluence
    const mockSignals = { generatedAt: new Date().toISOString(), signals: [ { id: 's1', type: 'TECHNICAL_SIGNAL', origin: 'TECH', direction: 'BULLISH' }, { id: 's2', type: 'TREND_QUALITY', origin: 'TECH', direction: 'BULLISH' } ] } as any;
    const buildSummary = async (sym:string, ms?: any) => { return buildSignalConfluenceSummary(sym, mockSignals, new Date().toISOString()); };
    const resolver = createPerCycleDecisionIntelligenceResolver({ cycleId: 'c1', buildSummary: buildSummary as any });
    const snap = await resolver.resolveAnalysis({ symbol: 'EUR_USD', marketSignals: mockSignals });
    expect(snap && snap.analysisQuality && typeof snap.analysisQuality.usableSignalCount === 'number' && snap.analysisQuality.usableSignalCount > 0).toBe(true);
    const originalCount = snap && snap.analysisQuality ? snap.analysisQuality.usableSignalCount : null;
    // Now simulate gate blocking: should not change the usableSignalCount value built above
    const ev = mkEvent('EUR','HIGH',60,'EUR CPI');
    const ctx = buildMacroEventContext({ events: [ev], now: new Date() });
    const inst = { id: 'EUR_USD', providerSymbol: 'EUR/USD', baseAsset: 'EUR', quoteCurrency: 'USD', assetType: 'FOREX', symbol: 'EUR_USD' };
    const gate = isInstrumentBlockedByMacroEvent({ macroContext: ctx, instrument: inst, now: new Date(), beforeMinutes: 120, afterMinutes: 30 });
    expect(gate.blocked).toBe(true);
    const snap2 = await resolver.resolveAnalysis({ symbol: 'EUR_USD', marketSignals: mockSignals });
    expect(snap2 && snap2.analysisQuality && originalCount !== null && snap2.analysisQuality.usableSignalCount === originalCount).toBe(true);
  });
});
