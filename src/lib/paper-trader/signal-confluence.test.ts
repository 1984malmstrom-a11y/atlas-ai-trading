import { describe, it, expect } from 'vitest';
import { normalizeSignalForConfluence, buildSignalConfluenceSummary, buildConfluenceReasoning, buildConfluenceAuditPayload } from './signal-confluence';

function sig(obj: Record<string, unknown>){
  return obj as unknown;
}

describe('Signal Confluence - normalization and scoring', ()=>{
  it('accepts a valid bullish signal', ()=>{
    const s = normalizeSignalForConfluence(sig({ id: 's1', type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', direction: 'BULLISH', strength: 0.8 }));
    expect(s).not.toBeNull();
    expect(s!.direction).toBe('BULLISH');
    expect(s!.strength).toBeCloseTo(0.8);
  });

  it('clamps strength >1 to 1', ()=>{
    const s = normalizeSignalForConfluence(sig({ id: 's2', type: 'X', origin: 'O', direction: 'BULLISH', strength: 2 }));
    expect(s).not.toBeNull();
    expect(s!.strength).toBe(1);
  });

  it('clamps strength <0 to 0', ()=>{
    const s = normalizeSignalForConfluence(sig({ id: 's3', type: 'X', origin: 'O', direction: 'BEARISH', strength: -1 }));
    expect(s).not.toBeNull();
    expect(s!.strength).toBe(0);
  });

  it('missing strength defaults to 0.5', ()=>{
    const s = normalizeSignalForConfluence(sig({ id: 's4', type: 'X', origin: 'O', direction: 'BULLISH' }));
    expect(s).not.toBeNull();
    expect(s!.strength).toBe(0.5);
  });

  it('placeholder macro marked and does not contribute', ()=>{
    const s = normalizeSignalForConfluence(sig({ id: 's5', type: 'MACRO_PLACEHOLDER', origin: 'MACRO_FEED', direction: 'BULLISH' }));
    expect(s).not.toBeNull();
    expect(s!.isPlaceholder).toBe(true);
  });

  it('neutral does not contribute to score', ()=>{
    const pkg = { signals: [ { id:'n1', type:'T', origin:'O', direction:'NEUTRAL', strength:1 }, { id:'b1', type:'T', origin:'O', direction:'BULLISH', strength:0.6 } ] };
    const summary = buildSignalConfluenceSummary('FOO', pkg as any);
    expect(summary.bullishScore).toBeCloseTo(0.6);
    expect(summary.bearishScore).toBe(0);
  });

  it('ignores signals missing id/type/origin', ()=>{
    const pkg = { signals: [ { type:'T', origin:'O', direction:'BULLISH', strength:1 }, { id:'ok', type:'T', origin:'O', direction:'BULLISH', strength:0.2 } ] };
    const summary = buildSignalConfluenceSummary('FOO', pkg as any);
    expect(summary.bullishSignalCount).toBe(1);
  });

  it('original objects are not mutated', ()=>{
    const sObj = { id:'smut', type:'T', origin:'O', direction:'BULLISH', strength:0.7 };
    const copy = JSON.parse(JSON.stringify(sObj));
    normalizeSignalForConfluence(sObj as unknown);
    expect(sObj).toEqual(copy);
  });

  it('includes global signals and symbol-specific signals only', ()=>{
    const pkg = { signals: [ { id:'g', type:'T', origin:'O', direction:'BULLISH', strength:0.2 }, { id:'a', symbols:['AAA'], type:'T', origin:'O', direction:'BULLISH', strength:0.3 } ] };
    const s1 = buildSignalConfluenceSummary('AAA', pkg as any);
    expect(s1.bullishSignalCount).toBe(2);
    const s2 = buildSignalConfluenceSummary('BBB', pkg as any);
    expect(s2.bullishSignalCount).toBe(1);
  });

  it('sums bullish and bearish scores', ()=>{
    const pkg = { signals: [ { id:'b1', type:'T', origin:'O', direction:'BULLISH', strength:0.4 }, { id:'b2', type:'U', origin:'P', direction:'BULLISH', strength:0.6 }, { id:'r1', type:'R', origin:'Q', direction:'BEARISH', strength:0.25 } ] };
    const summary = buildSignalConfluenceSummary('SYM', pkg as any);
    expect(summary.bullishScore).toBeCloseTo(1.0);
    expect(summary.bearishScore).toBeCloseTo(0.25);
  });

});

describe('Independent support and conflict rules', ()=>{
  it('two distinct types and origins => independent bullish support true', ()=>{
    const pkg = { signals: [ { id:'s1', type:'TECHNICAL_MOMENTUM', origin:'SYMBOL_PRICE_SERIES', direction:'BULLISH', strength:0.6 }, { id:'s2', type:'SECTOR_STRENGTH', origin:'SECTOR_QUOTES_AGGREGATE', direction:'BULLISH', strength:0.7 } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    expect(summary.hasIndependentBullishSupport).toBe(true);
  });

  it('same origin different type does NOT count as independent support (per spec C)', ()=>{
    const pkg = { signals: [ { id:'s1', type:'A', origin:'O1', direction:'BULLISH', strength:0.6 }, { id:'s2', type:'A', origin:'O2', direction:'BULLISH', strength:0.7 } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    // same type different origins -> should be false (require two distinct types)
    expect(summary.hasIndependentBullishSupport).toBe(false);
  });

  it('two types but same origin => independent false', ()=>{
    const pkg = { signals: [ { id:'s1', type:'A', origin:'O', direction:'BULLISH', strength:0.6 }, { id:'s2', type:'B', origin:'O', direction:'BULLISH', strength:0.7 } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    expect(summary.hasIndependentBullishSupport).toBe(false);
  });

  it('single strong signal does not count as independent support', ()=>{
    const pkg = { signals: [ { id:'s1', type:'A', origin:'O', direction:'BULLISH', strength:1 } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    expect(summary.hasIndependentBullishSupport).toBe(false);
  });

  it('conflict when weaker side >= 40% of stronger side (exact 40%)', ()=>{
    const pkg = { signals: [ { id:'b', type:'B', origin:'O', direction:'BULLISH', strength:1 }, { id:'s', type:'S', origin:'O2', direction:'BEARISH', strength:0.4 } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    expect(summary.hasConflict).toBe(true);
    expect(summary.direction).toBe('CONFLICTED');
  });

  it('no conflict when weaker <40% of stronger', ()=>{
    const pkg = { signals: [ { id:'b', type:'B', origin:'O', direction:'BULLISH', strength:1 }, { id:'s', type:'S', origin:'O2', direction:'BEARISH', strength:0.399 } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    expect(summary.hasConflict).toBe(false);
  });

  it('equal scores => CONFLICTED', ()=>{
    const pkg = { signals: [ { id:'a', type:'A', origin:'O', direction:'BULLISH', strength:0.5 }, { id:'b', type:'B', origin:'P', direction:'BEARISH', strength:0.5 } ] };
    const summary = buildSignalConfluenceSummary('S', pkg as any);
    expect(summary.direction).toBe('CONFLICTED');
  });

  it('no usable scores => NEUTRAL', ()=>{
    const pkg = { signals: [ { id:'p', type:'MACRO_PLACEHOLDER', origin:'MACRO', direction:'NEUTRAL' } ] };
    const summary = buildSignalConfluenceSummary('S', pkg as any);
    expect(summary.direction).toBe('NEUTRAL');
  });
});

describe('strongest selection and warnings/reasoning', ()=>{
  it('selects strongest bullish by strength then type then id', ()=>{
    const pkg = { signals: [ { id:'b2', type:'T', origin:'O', direction:'BULLISH', strength:0.9 }, { id:'b1', type:'S', origin:'O', direction:'BULLISH', strength:0.9 }, { id:'b0', type:'S', origin:'O', direction:'BULLISH', strength:0.8 } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    expect(summary.strongestBullish).toBeDefined();
    // highest strength tie: types S vs T -> S < T alphabetically, so S chosen, then id tie-break b1 vs b2 -> b1
    expect(summary.strongestBullish!.id).toBe('b1');
  });

  it('placeholder cannot be strongest', ()=>{
    const pkg = { signals: [ { id:'p', type:'MACRO_PLACEHOLDER', origin:'MACRO', direction:'BULLISH' }, { id:'r', type:'T', origin:'O', direction:'BULLISH', strength:0.6 } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    expect(summary.strongestBullish!.id).toBe('r');
  });

  it('warnings stable, deduplicated and include expected items', ()=>{
    const pkg = { signals: [ { id:'p', type:'MACRO_PLACEHOLDER', origin:'MACRO', direction:'NEUTRAL' } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    expect(summary.warnings).toContain('NO_USABLE_SIGNALS');
    expect(summary.warnings).toContain('ONLY_PLACEHOLDERS');
    const reasoning = buildConfluenceReasoning(summary);
    expect(reasoning.length).toBeLessThanOrEqual(5);
    // reasoning stable
    const r2 = buildConfluenceReasoning(summary);
    expect(r2).toEqual(reasoning);
  });

  it('missing volume and missing technical warnings appear', ()=>{
    const pkg = { signals: [ { id:'s', type:'MACRO_PLACEHOLDER', origin:'MACRO', direction:'NEUTRAL' } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any);
    expect(summary.warnings).toContain('MISSING_VOLUME_HISTORY');
    expect(summary.warnings).toContain('MISSING_TECHNICAL_HISTORY');
  });

});

describe('audit payload helper', ()=>{
  it('produces sanitized payload with allowed fields only', ()=>{
    const pkg = { signals: [ { id:'b', type:'T', origin:'O', direction:'BULLISH', strength:0.5 } ] };
    const summary = buildSignalConfluenceSummary('X', pkg as any, '2020-01-01T00:00:00Z');
    const audit = buildConfluenceAuditPayload('cycle-1', summary);
    expect(audit['cycleId']).toBe('cycle-1');
    expect(audit['symbol']).toBe(summary.symbol);
    expect(audit['generatedAt']).toBe(summary.generatedAt);
    expect(audit['bullishSignals']).toBeUndefined();
    expect(audit['bullishScore']).toBeDefined();
    expect(audit['strongestBullish']).toBeDefined();
    // no raw arrays
    expect(audit['warnings']).toBeDefined();
  });
});

describe('symbol normalization matches various formats', ()=>{
  it('matches signals with symbols ["EUR/USD"] when confluence symbol is EUR_USD or EURUSD', ()=>{
    const pkg = { signals: [ { id:'t1', type:'TECHNICAL_MOMENTUM', origin:'SYMBOL_PRICE_SERIES', direction:'BULLISH', symbols: ['EUR/USD'], strength: 0.8 } ] } as any;
    const s1 = buildSignalConfluenceSummary('EUR_USD', pkg as any);
    expect(s1.usableSignalCount).toBeGreaterThanOrEqual(1);
    const s2 = buildSignalConfluenceSummary('EURUSD', pkg as any);
    expect(s2.usableSignalCount).toBeGreaterThanOrEqual(1);
    const s3 = buildSignalConfluenceSummary('EUR/USD', pkg as any);
    expect(s3.usableSignalCount).toBeGreaterThanOrEqual(1);
  });
});
