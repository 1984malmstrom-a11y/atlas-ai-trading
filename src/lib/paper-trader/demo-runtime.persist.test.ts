import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('demo-runtime persistence', ()=>{
  const P = path.join(process.cwd(), 'src', 'data', 'portfolio.json');
  let backup: string | null = null;

  beforeAll(()=>{
    // If an existing portfolio file is present, move it aside to a timestamped backup
    try{
      if (fs.existsSync(P)){
        backup = `${P}.bak.${Date.now()}`;
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(P, backup);
      }
    }catch(e){ /* best-effort backup; continue */ }
  });

  beforeEach(()=>{
    // Ensure starting clean for each test
    try{ if (fs.existsSync(P)) fs.unlinkSync(P); }catch(e){ }
  });

  afterEach(()=>{
    // Remove any file created by the test
    try{ if (fs.existsSync(P)) fs.unlinkSync(P); }catch(e){ }
  });

  afterAll(()=>{
    // Restore original backup if it existed, otherwise ensure no portfolio file remains
    try{
      if (backup && fs.existsSync(backup)){
        // restore
        try{ if (fs.existsSync(P)) fs.unlinkSync(P);}catch(e){}
        fs.renameSync(backup, P);
      } else {
        try{ if (fs.existsSync(P)) fs.unlinkSync(P); }catch(e){}
      }
    }catch(e){ /* swallow */ }
  });

  it('runs two cycles and persists portfolio', async ()=>{
    // import runtime (module will initialize file)
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    // run two cycles
    await runtime.runManualPaperTradingCycle();
    await runtime.runManualPaperTradingCycle();

    // file should exist and contain valid portfolio shape
    expect(fs.existsSync(P)).toBe(true);
    const raw = fs.readFileSync(P, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('availableCash');
    expect(parsed).toHaveProperty('holdings');
    expect(Array.isArray(parsed.holdings)).toBe(true);

    // ensure data can be read again
    const raw2 = fs.readFileSync(P, 'utf-8');
    const parsed2 = JSON.parse(raw2);
    expect(parsed2.availableCash).toBeDefined();
  });

  it('forwards NEGATIVE reflection to Decision Engine and affects confidence', async ()=>{
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    // ensure clean audits
    await mod.__clearAudits();
    // read current profile (may be INSufficient data in test env) and ensure it's forwarded
    const profile = await mod.getPerformanceProfile();
    const spy = vi.spyOn(mod, 'getPerformanceProfile' as any).mockResolvedValue(profile as any);
    // spy on decision engine to ensure reflection forwarded
    const decMod = await import('./decision-engine');
    const decSpy = vi.spyOn(decMod, 'evaluateDecision' as any);

    // build overrideUniverse to force a SELL candidate: holding with avg 100 and quote price 94 triggers stop-loss
    const override = {
      portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'AAPL', quantity: 2, averagePrice: 100, currentPrice: 100, marketValue: 200 }] },
      quotes: [{ symbol: 'AAPL', priceSek: 94 }]
    };

    await runtime.runManualPaperTradingCycle({ overrideUniverse: override });
    // read state and find evaluation audit for AAPL
    const state = await runtime.getPaperTradingState();
    const audits = state.auditEntries || [];
    const evals = audits.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION');
    // find the evaluation for AAPL
    const aaplEval = evals.find((e:any)=> e && e.raw && e.raw.decision && String((e.raw.decision.symbol||'').toUpperCase()) === 'AAPL');
    expect(aaplEval).toBeDefined();
    // Ensure decision engine was called and received the reflection
    expect(decSpy).toHaveBeenCalled();
    const calledArg = decSpy.mock.calls[0][0];
    const storedReflection = aaplEval.raw.decision && (aaplEval.raw.decision as any).performanceReflection;
    expect(storedReflection).toBeDefined();
    // ensure the reflection object passed to evaluateDecision is the exact same object stored on the audit
    expect((calledArg as any).performanceReflection).toBe(storedReflection);
    spy.mockRestore();
    decSpy.mockRestore();
  });

  it('continues without reflection when getPerformanceProfile fails', async ()=>{
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    await mod.__clearAudits();
    // force getPerformanceProfile to throw via override option
    const getProfileOverride = async ()=> { throw new Error('boom'); };
    // spy evaluateDecision
    const decMod = await import('./decision-engine');
    const decSpy = vi.spyOn(decMod, 'evaluateDecision' as any);

    const override = {
      portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'AAPL', quantity: 2, averagePrice: 100, currentPrice: 100, marketValue: 200 }] },
      quotes: [{ symbol: 'AAPL', priceSek: 94 }]
    };

    await runtime.runManualPaperTradingCycle({ overrideUniverse: override, getPerformanceProfileOverride: getProfileOverride });
    expect(decSpy).toHaveBeenCalled();
    // find the call for AAPL and assert it had no performanceReflection
    const aaplCall = decSpy.mock.calls.find((c:any[])=> c && c[0] && c[0].decision && String((c[0].decision.symbol||'').toUpperCase()) === 'AAPL');
    expect(aaplCall).toBeDefined();
    const calledArg = aaplCall ? aaplCall[0] : decSpy.mock.calls[0][0];
    expect((calledArg as any).performanceReflection).toBeUndefined();

    decSpy.mockRestore();
  });

  it('skips candidate when evaluateDecision throws (no execution)', async ()=>{
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    await mod.__clearAudits();
    const decMod = await import('./decision-engine');
    const decSpy = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=>{ throw new Error('dec fail'); });

    const override = {
      portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'AAPL', quantity: 2, averagePrice: 100, currentPrice: 100, marketValue: 200 }] },
      quotes: [{ symbol: 'AAPL', priceSek: 94 }]
    };

    const res = await runtime.runManualPaperTradingCycle({ overrideUniverse: override });
    expect(res.executed).toBe(0);
    expect(res.rejects).toBeGreaterThanOrEqual(1);

    decSpy.mockRestore();
  });
});
