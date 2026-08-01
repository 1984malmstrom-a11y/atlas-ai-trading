import { describe, it, expect, vi } from 'vitest';

// Mock TwelveData provider so demo-runtime.fetchAndAnalyze produces deterministic technical meta
vi.doMock('../market-data/twelve-data', ()=>({
  TwelveDataMarketDataProvider: class {
    async getHistoricalDailyCloses(_sym: string, _days: number){
      const now = new Date();
      return { closes: Array.from({length:30}, (_,i)=> 100 + i), dates: Array.from({length:30}, ()=> now.toISOString()), source: 'mock' };
    }
  }
}));

import runtimeModule, { __clearAudits, __setTestPortfolio, __listAudits, __appendTestAudits } from './demo-runtime';
import { createMarketNewsActivity } from './market-news-activity';
import * as DecisionEngine from './decision-engine';

describe('demo-runtime marketNewsIntelligenceSummary', ()=>{
  it('saves marketNewsIntelligenceSummary when provided', async ()=>{
    try{ await __clearAudits(); }catch(_){ }
    __setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
    const publishedAt = new Date(nowMs - 1000).toISOString();
    const marketNewsSnapshot = {
      symbol: ' MSFT ',
      items: [
        { id: 'n1', symbol: 'MSFT', headline: 'Fresh', source: 'S', publishedAt, fetchedAt: new Date(nowMs - 500).toISOString() }
      ],
      fetchedAt: new Date(nowMs - 100).toISOString()
    };
    const override = { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [] }, marketNewsSnapshot };
    const res = await runtimeModule.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override as any });
    const state = await runtimeModule.getPaperTradingState();
    const latest = state && state.latestCycle ? state.latestCycle : null;
    expect(latest).toBeTruthy();
    expect(latest.cycleIntelligenceSnapshot).toBeTruthy();
    const snap = latest.cycleIntelligenceSnapshot;
    expect(snap.marketNewsIntelligenceSummary).toBeTruthy();
    expect(snap.marketNewsIntelligenceSummary.symbol).toBe('MSFT');
    expect(snap.marketNewsIntelligenceSummary.freshCount).toBe(1);
    expect(snap.marketNewsIntelligenceSummary.staleCount).toBe(0);
    expect(snap.marketNewsIntelligenceSummary.invalidCount).toBe(0);
    expect(snap.marketNewsIntelligenceSummary.latestPublishedAt).toBe(publishedAt);
    // Verify the appended audit entry also contains the same summary instance/values and no duplicates
    const audits = Array.isArray(await __listAudits()) ? await __listAudits() : [];
    const cycleAudits = audits.filter((a:any)=> (a && a.raw && a.raw.kind === 'CYCLE_INTELLIGENCE_SNAPSHOT') || (a && a.kind === 'CYCLE_INTELLIGENCE_SNAPSHOT'));
    // Expect exactly one cycle-intel audit for this run
    expect(cycleAudits.length).toBe(1);
    const audit = cycleAudits[0] && (cycleAudits[0].raw ? cycleAudits[0].raw : cycleAudits[0]);
    expect(audit).toBeTruthy();
    // The audit payload should include the marketNewsIntelligenceSummary and it should equal the snapshot's value
    expect(audit.marketNewsIntelligenceSummary).toBeTruthy();
    expect(audit.marketNewsIntelligenceSummary).toEqual(snap.marketNewsIntelligenceSummary);
    expect(audit.marketNewsIntelligenceSummary.symbol).toBe('MSFT');
    expect(audit.marketNewsIntelligenceSummary.freshCount).toBe(1);
    expect(audit.marketNewsIntelligenceSummary.staleCount).toBe(0);
    expect(audit.marketNewsIntelligenceSummary.invalidCount).toBe(0);
    expect(audit.marketNewsIntelligenceSummary.latestPublishedAt).toBe(publishedAt);

    // Snapshot should not be mutated to include activity
    expect((snap as any).marketNewsActivity === undefined).toBeTruthy();

    // Audit should include a marketNewsActivity created from the same summary
    expect(audit.marketNewsActivity).toBeTruthy();
    const expectedActivity = createMarketNewsActivity(snap.marketNewsIntelligenceSummary);
    expect(audit.marketNewsActivity).toEqual(expectedActivity);
    expect(audit.marketNewsActivity.title).toBe(expectedActivity.title);
    expect(audit.marketNewsActivity.message).toBe(expectedActivity.message);

    // The runtime state should expose the latestMarketNewsActivity (reused from audit)
    expect(state.latestMarketNewsActivity).toBeTruthy();
    expect(state.latestMarketNewsActivity).toEqual(expectedActivity);
  });

  it('behaves as before when no marketNewsSnapshot provided', async ()=>{
    try{ await __clearAudits(); }catch(_){ }
    __setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    const override = { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [] } };
    const res = await runtimeModule.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override as any });
    const state = await runtimeModule.getPaperTradingState();
    const latest = state && state.latestCycle ? state.latestCycle : null;
    expect(latest).toBeTruthy();
    const snap = latest.cycleIntelligenceSnapshot;
    // marketNewsIntelligenceSummary should be absent or undefined
    expect(snap && (snap as any).marketNewsIntelligenceSummary === undefined).toBeTruthy();
    // runtime should not expose a market news activity when none exists
    expect((state as any).latestMarketNewsActivity === undefined).toBeTruthy();
  });

  it('picks latest marketNewsActivity from audits when multiple present', async ()=>{
    try{ await __clearAudits(); }catch(_){ }
    __setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
    const publishedAt = new Date(nowMs - 1000).toISOString();
    const marketNewsSnapshot = {
      symbol: ' MSFT ',
      items: [ { id: 'n1', symbol: 'MSFT', headline: 'Fresh', source: 'S', publishedAt, fetchedAt: new Date(nowMs - 500).toISOString() } ],
      fetchedAt: new Date(nowMs - 100).toISOString()
    };
    const override = { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [] }, marketNewsSnapshot };
    await runtimeModule.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override as any });
    const audits1 = Array.isArray(await __listAudits()) ? await __listAudits() : [];
    const cycleAudits1 = audits1.filter((a:any)=> (a && a.raw && a.raw.kind === 'CYCLE_INTELLIGENCE_SNAPSHOT') || (a && a.kind === 'CYCLE_INTELLIGENCE_SNAPSHOT'));
    expect(cycleAudits1.length).toBe(1);
    // Append a manual newer cycle-intel audit with a different activity
    const later = new Date(nowMs + 60000).toISOString();
    const manual = { kind: 'CYCLE_INTELLIGENCE_SNAPSHOT', id: 'manual_cycle_extra', timestamp: later, snapshot: {}, meta: { automatic: true }, marketNewsActivity: { title: 'Nyhetsanalys för MANUAL', message: 'Senaste aktivitet' } } as any;
    await __appendTestAudits([manual]);
    const state = await runtimeModule.getPaperTradingState();
    // Should pick the manual activity as latest
    expect(state.latestMarketNewsActivity).toBeTruthy();
    expect(state.latestMarketNewsActivity.title).toBe('Nyhetsanalys för MANUAL');
    expect(state.latestMarketNewsActivity.message).toBe('Senaste aktivitet');
    const audits2 = Array.isArray(await __listAudits()) ? await __listAudits() : [];
    const cycleAudits2 = audits2.filter((a:any)=> (a && a.raw && a.raw.kind === 'CYCLE_INTELLIGENCE_SNAPSHOT') || (a && a.kind === 'CYCLE_INTELLIGENCE_SNAPSHOT'));
    expect(cycleAudits2.length).toBe(2);
  });

  it('clears runtime latestMarketNewsActivity when audits are removed', async ()=>{
    try{ await __clearAudits(); }catch(_){ }
    __setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
    const publishedAt = new Date(nowMs - 1000).toISOString();
    const marketNewsSnapshot = {
      symbol: ' MSFT ',
      items: [ { id: 'n1', symbol: 'MSFT', headline: 'Fresh', source: 'S', publishedAt, fetchedAt: new Date(nowMs - 500).toISOString() } ],
      fetchedAt: new Date(nowMs - 100).toISOString()
    };
    const override = { quotes: [ { symbol: 'MSFT', priceSek: 100 } ], portfolio: { availableCash: 100000, holdings: [] }, marketNewsSnapshot };
    // Run one cycle that produces an activity
    await runtimeModule.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override as any });
    let state = await runtimeModule.getPaperTradingState();
    // Should have latestMarketNewsActivity now
    expect(state.latestMarketNewsActivity).toBeTruthy();
    const before = state.latestMarketNewsActivity;
    expect(before).toBeTruthy();

    // Clear audits and verify state no longer exposes the activity
    await __clearAudits();
    state = await runtimeModule.getPaperTradingState();
    expect(state.latestMarketNewsActivity === undefined).toBeTruthy();
    // Fetch state again to ensure no stale value persists
    state = await runtimeModule.getPaperTradingState();
    expect(state.latestMarketNewsActivity === undefined).toBeTruthy();
  });

  it('runtime forwards marketSignals to DecisionEngine and preserves action when sufficient evidence', async ()=>{
    try{ await __clearAudits(); }catch(_){ }
    __setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [{ id: 'h_AAA', symbol: 'AAA', quantity: 1, averagePrice: 100, currentPrice: 95 }] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    const quotes = [ { symbol: 'AAA', priceSek: 95, changePercent: -5, dataStatus: 'OK' }, { symbol: 'BBB', priceSek: 110, changePercent: 2, dataStatus: 'OK' }, { symbol: 'CCC', priceSek: 120, changePercent: 3, dataStatus: 'OK' } ];
    const override = { quotes, portfolio: { availableCash: 100000, holdings: [{ id: 'h_AAA', symbol: 'AAA', quantity: 1, averagePrice: 100, currentPrice: 95 }] } } as any;
    const spy = vi.spyOn(DecisionEngine, 'evaluateDecision');
    const res = await runtimeModule.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override });
    expect(spy).toHaveBeenCalled();
    // Find a call that included marketSignals and a decision object
    const callWithMs = spy.mock.calls.find((c:any)=> c && c[0] && c[0].marketSignals !== undefined && c[0].decision);
    expect(callWithMs).toBeTruthy();
    const callArg = (callWithMs as any)[0];
    const ms = callArg.marketSignals as any;
    expect(ms).toBeTruthy();
    expect(Array.isArray(ms.signals)).toBeTruthy();
    // decision.signals must be present and consist of ids that exist in marketSignals.signals
    const decSignals = Array.isArray(callArg.decision && callArg.decision.signals) ? callArg.decision.signals : [];
    expect(decSignals.length).toBeGreaterThanOrEqual(1);
    const msIds = new Set(ms.signals.map((s:any)=> String(s.id)));
    const matched = decSignals.filter((id:any)=> msIds.has(String(id)));
    // The matched ids may or may not represent two different types depending on real signals.
    const idToType = new Map(ms.signals.map((s:any)=> [String(s.id), String(s.type)]));
    const matchedTypes = new Set(matched.map((id:any)=> idToType.get(String(id))));
    // Find the first runtime call that included marketSignals and a decision
    const matchedCallIndex = spy.mock.calls.findIndex((c:any)=> c && c[0] && c[0].marketSignals !== undefined && c[0].decision);
    expect(matchedCallIndex).toBeGreaterThanOrEqual(0);
    const realResult = spy.mock.results[matchedCallIndex] && spy.mock.results[matchedCallIndex].value;
    expect(realResult).toBeTruthy();
    expect(realResult.signal).toBeTruthy();
    // If runtime provided a genuine expectedReturnPercent and there are >=2 supporting types, expect BUY/SELL.
    if (matched.length >= 2 && matchedTypes.size >= 2 && typeof (callArg.expectedReturnPercent) === 'number'){
      expect(['BUY','SELL']).toContain(realResult.signal.action);
    } else {
      // Otherwise DecisionEngine should fail-closed to HOLD
      expect(realResult.signal.action).toBe('HOLD');
      // Prefer explicit insufficient evidence reason when present
      if (realResult.signal.reason){ expect(String(realResult.signal.reason)).toMatch(/INSUFFICIENT_EVIDENCE/i); }
    }
    spy.mockRestore();
  });
  it('BUY path includes TECHNICAL_MOMENTUM and RELATIVE_STRENGTH when conditions met', async ()=>{
    try{ await __clearAudits(); }catch(_){ }
    // empty holdings to allow BUY candidates
    __setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    // TARGET has strong changePercent compared to others to trigger relative strength
    const quotes = [
      { symbol: 'TARG', priceSek: 100, changePercent: 3.0, dataStatus: 'OK', isStale: false },
      { symbol: 'A', priceSek: 100, changePercent: 0.5, dataStatus: 'OK', isStale: false },
      { symbol: 'B', priceSek: 100, changePercent: 0.4, dataStatus: 'OK', isStale: false },
      { symbol: 'C', priceSek: 100, changePercent: 0.6, dataStatus: 'OK', isStale: false },
      { symbol: 'D', priceSek: 100, changePercent: 0.3, dataStatus: 'OK', isStale: false },
      { symbol: 'E', priceSek: 100, changePercent: 0.2, dataStatus: 'OK', isStale: false }
    ];
    const override = { quotes, portfolio: { availableCash: 100000, holdings: [] } } as any;
    const spy = vi.spyOn(DecisionEngine, 'evaluateDecision');
    await runtimeModule.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override });
    // Find BUY call
    const buyCall = spy.mock.calls.find((c:any)=> c && c[0] && c[0].decision && String((c[0].decision as any).side).toUpperCase() === 'BUY');
    expect(buyCall).toBeTruthy();
    const arg = buyCall![0] as any;
    expect(arg.marketSignals).toBeTruthy();
    const ms = arg.marketSignals as any;
    const ids = new Set(ms.signals.map((s:any)=> s.id));
    // technical id and relative strength id
    const techId = `technical_${String('TARG').toUpperCase()}`;
    const relId = `relative_strength_${String('TARG').toUpperCase()}`;
    expect(ids.has(techId)).toBeTruthy();
    expect(ids.has(relId)).toBeTruthy();
    // types and origins distinct
    const idToType = new Map(ms.signals.map((s:any)=> [String(s.id), String(s.type)]));
    const idToOrigin = new Map(ms.signals.map((s:any)=> [String(s.id), String(s.origin)]));
    expect(idToType.get(techId)).not.toBe(idToType.get(relId));
    expect(idToOrigin.get(techId)).not.toBe(idToOrigin.get(relId));
    // no duplicate ids
    expect(ms.signals.map((s:any)=> s.id).length).toBe(new Set(ms.signals.map((s:any)=> s.id)).size);
    // technical still present
    expect(idToType.get(techId)).toBe('TECHNICAL_MOMENTUM');
    spy.mockRestore();
  });

  it('RELATIVE_STRENGTH not added when symbol near market average', async ()=>{
    try{ await __clearAudits(); }catch(_){ }
    __setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 }) });
    const quotes = [
      { symbol: 'TARG', priceSek: 100, changePercent: 0.6, dataStatus: 'OK', isStale: false },
      { symbol: 'A', priceSek: 100, changePercent: 0.5, dataStatus: 'OK', isStale: false },
      { symbol: 'B', priceSek: 100, changePercent: 0.55, dataStatus: 'OK', isStale: false },
      { symbol: 'C', priceSek: 100, changePercent: 0.65, dataStatus: 'OK', isStale: false },
      { symbol: 'D', priceSek: 100, changePercent: 0.6, dataStatus: 'OK', isStale: false },
      { symbol: 'E', priceSek: 100, changePercent: 0.5, dataStatus: 'OK', isStale: false }
    ];
    const override = { quotes, portfolio: { availableCash: 100000, holdings: [] } } as any;
    const spy = vi.spyOn(DecisionEngine, 'evaluateDecision');
    await runtimeModule.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override });
    const buyCall = spy.mock.calls.find((c:any)=> c && c[0] && c[0].decision && String((c[0].decision as any).side).toUpperCase() === 'BUY');
    if (buyCall){
      const arg = buyCall[0] as any;
      const ms = arg.marketSignals as any;
      const ids = new Set(ms.signals.map((s:any)=> s.id));
      const relId = `relative_strength_${String('TARG').toUpperCase()}`;
      expect(ids.has(relId)).toBe(false);
    }
    spy.mockRestore();
  });
});
