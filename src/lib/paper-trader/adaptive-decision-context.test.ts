import { expect, it } from 'vitest';
import runtimeModule, { __clearAudits } from './demo-runtime';

it('builds and attaches AdaptiveDecisionContext after a manual cycle', async ()=>{
  // clear any existing audits
  try{ await __clearAudits(); }catch(_){ }
  const rt: any = runtimeModule;
  // run one manual cycle with deterministic override universe
  const override = { quotes: [ { symbol: 'MSFT', price: 100 } ], portfolio: { availableCash: 100000, totalValue: 100000, holdings: [] } };
  const res = await rt.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override });
  // runtime.latestCycle should include adaptiveDecisionContext (use getter)
  const state = await rt.getPaperTradingState();
  const latest = state && state.latestCycle ? state.latestCycle : null;
  // debug: show audit kinds present
  console.log('AUDITS', state && state.auditEntries && state.auditEntries.map((a:any)=> a && a.raw ? (a.raw.kind || a.kind) : (a.kind || null)));
  expect(latest).toBeTruthy();
  expect(latest.adaptiveDecisionContext).toBeTruthy();
  const ctx = latest.adaptiveDecisionContext;
  expect(typeof ctx.confidenceBias).toBe('number');
  expect(typeof ctx.riskBias).toBe('number');
  expect(Array.isArray(ctx.preferredLessonCategories)).toBe(true);
});
