import { describe, it, expect, vi } from 'vitest';

describe('focused cycle diagnostics', () => {
  it('captures eligible instruments and run result', async () => {
    vi.resetModules();
    vi.stubEnv('PAPER_TRADER_SCHEDULER_MODE', 'in_memory');
    vi.stubEnv('NODE_ENV', 'test');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-03T12:00:00Z'));

    // Force market open to avoid market-hours gating
    vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: () => ({ open: true }) }));

    const mod = await import('./demo-runtime');
    const { runManualPaperTradingCycle, isInstrumentTradableNow } = mod as any;

    const runResult = await runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: { quotes: [], portfolio: { id: 'demo', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, holdings: [] } } });

    // Gather state + audits for per-symbol diagnostics
    const state = await (mod as any).getPaperTradingState();
    const ds = state && state.latestCycle && state.latestCycle.decisionSummary ? state.latestCycle.decisionSummary : null;
    const cycleId = ds && ds.cycleId ? ds.cycleId : null;
    const allAudits = Array.isArray(await (mod as any).__listAudits()) ? await (mod as any).__listAudits() : [];
    const cycleAudits = allAudits.filter((a:any)=>{ try{ const raw = a && a.raw ? a.raw : a; return raw && (raw.cycleId === cycleId || (raw.summary && raw.summary.cycleId === cycleId)); }catch(_){ return false; } });
    const instrumentsMod = await import('../market-data/instruments');
    const analyzed = Array.isArray(ds && ds.analyzedSymbols) ? ds.analyzedSymbols : (instrumentsMod.TRADABLE_INSTRUMENTS||[]).slice(0,10).map((i:any)=> (i.providerSymbol||i.id).toUpperCase());

    const per = [] as any[];
    for (const s of analyzed){
      const sym = String(s).toUpperCase();
      const quotesSnap = cycleAudits.find((a:any)=> (a && a.raw && a.raw.kind === 'RUNTIME_QUOTES_SNAPSHOT' && Array.isArray(a.raw.quotes) && a.raw.quotes.some((q:any)=> String(q.symbol||q.providerSymbol||q.instrumentId||'').toUpperCase()===sym)));
      let quote=null, quoteAge=null;
      try{ if (quotesSnap){ const q = (quotesSnap.raw && Array.isArray(quotesSnap.raw.quotes)) ? quotesSnap.raw.quotes.find((q:any)=> String(q.symbol||q.providerSymbol||q.instrumentId||'').toUpperCase()===sym) : null; quote = q || null; if (q && q.timestamp) quoteAge = Math.round((Date.now() - Date.parse(String(q.timestamp)))/1000); } }catch(_){ }
      const evals = cycleAudits.filter((a:any)=> { const r = a && a.raw ? a.raw : a; try{ return r && (r.kind === 'EVALUATION') && r.decision && String(r.decision.symbol||'').toUpperCase()===sym; }catch(_){ return false; } });
      const lastEval = evals.length ? (evals[0].raw||evals[0]) : null;
      const decisionAction = lastEval && lastEval.decision && lastEval.decision.action ? String(lastEval.decision.action).toUpperCase() : null;
      const confidence = lastEval && lastEval.decision && typeof lastEval.decision.confidence==='number' ? lastEval.decision.confidence : (lastEval && lastEval.evaluation && typeof lastEval.evaluation.confidence==='number' ? lastEval.evaluation.confidence : null);
      const expectedReturn = (lastEval && (lastEval.decision && (lastEval.decision.expectedReturnPercent||lastEval.decision.expectedReturnPercent===0) ? lastEval.decision.expectedReturnPercent : (lastEval.evaluation && lastEval.evaluation.returnPercent ? lastEval.evaluation.returnPercent : null))) ?? null;
      const expectedSource = lastEval && lastEval.decision && lastEval.decision.expectedReturnPercent ? 'decision' : (lastEval && lastEval.evaluation && lastEval.evaluation.returnPercent ? 'evaluation' : null);
      const histOk = lastEval && lastEval.meta && lastEval.meta.technicalAnalysis && lastEval.meta.technicalAnalysis.technicalAnalysisStatus === 'success';
      const supportCats = (lastEval && lastEval.meta && lastEval.meta.combinedAnalysis && lastEval.meta.combinedAnalysis.signalTypes) ? lastEval.meta.combinedAnalysis.signalTypes : (lastEval && lastEval.meta && lastEval.meta.technicalAnalysis ? ['TECHNICAL'] : []);
      const rejects = cycleAudits.filter((a:any)=>{ const r=a&&a.raw?a.raw:a; try{ return r && r.kind==='REJECT' && r.decision && String(r.decision.symbol||'').toUpperCase()===sym; }catch(_){return false;} });
      const rejReason = rejects.length ? (rejects[0].raw && rejects[0].raw.reason && rejects[0].raw.reason.code ? rejects[0].raw.reason.code : (rejects[0].raw && rejects[0].raw.reason && rejects[0].raw.reason.message ? String(rejects[0].raw.reason.message) : 'REJECT')) : null;
      const reachedEngine = Boolean(lastEval && (lastEval.decision && (String(lastEval.decision.action||'')==='BUY' || String(lastEval.decision.action||'')==='SELL')));
      const finalDecision = (cycleAudits.find((a:any)=>{ const r=a&&a.raw?a.raw:a; try{ return r && r.kind==='EXECUTION' && r.execution && String(r.execution.symbol||'').toUpperCase()===sym; }catch(_){return false;} }) ? 'EXECUTED' : (rejects.length ? 'REJECTED' : (decisionAction || 'HOLD')));

      per.push({ symbol: sym, quoteAvailable: !!quote, quoteAgeSeconds: quoteAge, marketSignalAction: decisionAction, confidence, expectedReturn, expectedReturnSource: expectedSource, historicalDataAvailable: !!histOk, supportingSignalCategories: Array.isArray(supportCats)?supportCats:[], eligibilityRejectionReason: rejReason, reachedDecisionEngine: reachedEngine, finalDecision });
    }

    // Summaries
    const missingExpectedReturn = per.filter(p=> p.expectedReturn===null).length;
    const missingBuySignal = per.filter(p=> String(p.marketSignalAction||'').toUpperCase()!=='BUY').length;
    const stoppedByConfidence = per.filter(p=> p.eligibilityRejectionReason && String(p.eligibilityRejectionReason).toUpperCase().includes('LOW_CONFIDENCE')).length;
    const stoppedBySignalDiversity = cycleAudits.filter((a:any)=> { const r=a&&a.raw?a.raw:a; return r && r.kind==='REJECT' && r.reason && (String(r.reason.code||'').toUpperCase().includes('EXPECTED_RETURN') || String(r.reason.message||'').toLowerCase().includes('support')); }).length;
    const blockerCounts: Record<string,number> = {};
    for (const p of per){ if (p.eligibilityRejectionReason){ blockerCounts[p.eligibilityRejectionReason] = (blockerCounts[p.eligibilityRejectionReason]||0) + 1; } }
    const firstCommonBlocker = Object.keys(blockerCounts).sort((a,b)=> blockerCounts[b]-blockerCounts[a])[0] || null;
    const nearestBuy = per.filter(p=> p.expectedReturn!==null).sort((a,b)=> (b.confidence||0)-(a.confidence||0))[0] || null;

    // Print compact human-readable lines (<=20 lines)
    // eslint-disable-next-line no-console
    console.log('--- PER-SYMBOL DIAGNOSTICS ---');
    for (const p of per) console.log(`${p.symbol} | q:${p.quoteAvailable ? 'yes':'no'} age:${p.quoteAgeSeconds??'-'}s | sig:${p.marketSignalAction||'-'} conf:${p.confidence??'-'} exp:${p.expectedReturn??'-'} src:${p.expectedReturnSource||'-'} hist:${p.historicalDataAvailable? 'yes':'no'} supports:${(p.supportingSignalCategories||[]).join(',')||'-'} rej:${p.eligibilityRejectionReason||'-'} reached:${p.reachedDecisionEngine? 'yes':'no'} final:${p.finalDecision}`);
    console.log('--- SUMMARY ---');
    console.log(`missingExpectedReturn=${missingExpectedReturn} missingBuySignal=${missingBuySignal} stoppedByConfidence=${stoppedByConfidence} stoppedBySignalDiversity=${stoppedBySignalDiversity}`);
    console.log(`firstCommonBlocker=${firstCommonBlocker||'NONE'} nearestBuy=${nearestBuy? `${nearestBuy.symbol}(conf=${nearestBuy.confidence||0})` : 'NONE'}`);

    expect(true).toBe(true);
  }, 20000);
});
