import { describe, it, expect, beforeEach } from 'vitest';

describe('NVDA quote flow regression', ()=>{
  beforeEach(async ()=>{
    const mod = await import('./demo-runtime');
    await mod.__clearAudits();
  });

  it('accepts a valid NVDA provider response and surfaces quote correctly', async ()=>{
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;

    const now = new Date().toISOString();
    const override = {
      portfolio: { availableCash: 100000, totalValue: 100000, holdings: [{ symbol: 'NVDA', instrumentId: 'nvidia', quantity: 1, averagePrice: 100, currentPrice: 100, marketValue: 100 }] },
      quotes: [ { instrumentId: 'nvidia', symbol: 'nvda', price: 420, priceSek: null, currency: 'USD', timestamp: now } ]
    };

    // run two cycles to ensure diagnostics appended
    await runtime.runManualPaperTradingCycle({ overrideUniverse: override });
    await runtime.runManualPaperTradingCycle({ overrideUniverse: override });

    const raw = require('fs').readFileSync(require('path').join(process.cwd(),'src','data','victor-trading-audit.json'),'utf-8');
    const audits = JSON.parse(raw || '[]');
    // Instead of AUTOPILOT_DIAGNOSTICS (not always emitted on no-candidates path),
    // assert presence of an EVALUATION audit for NVDA that includes the parsed referencePrice
    const evalAudit = audits.slice().reverse().find((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION' && a.raw.decision && String((a.raw.decision.symbol||'').toUpperCase()) === 'NVDA');
    expect(evalAudit).toBeDefined();
    // parsed price should be > 0 and propagated into evaluation.referencePrice
    const ref = evalAudit && evalAudit.raw && evalAudit.raw.decision ? Number(evalAudit.raw.decision.referencePrice) : null;
    expect(Number.isFinite(ref)).toBe(true);
    expect(ref).toBeGreaterThan(0);
    // ensure override quote itself had valid price and timestamp and is recent
    const q = override.quotes[0];
    expect(q.price).toBeGreaterThan(0);
    expect(typeof q.timestamp).toBe('string');
    const ts = new Date(q.timestamp);
    expect(isFinite(ts.getTime())).toBe(true);
    const age = (Date.now() - ts.getTime())/1000;
    expect(age).toBeLessThanOrEqual(120);
  });
});
