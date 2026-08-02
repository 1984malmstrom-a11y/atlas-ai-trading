import { describe, it, expect } from 'vitest';
import { buildVictorAnalysisNarrative, VictorDecisionViewInput } from './victor-analysis-narrative';

function clone<T>(v:T):T{ return JSON.parse(JSON.stringify(v)); }

describe('buildVictorAnalysisNarrative', ()=>{
  const baseInput: VictorDecisionViewInput = {
    symbol: 'AAPL',
    action: 'BUY',
    confidence: 75,
    reasoning: ['Sammanfattning', 'Detalj'],
    signals: ['s1','s2'],
    risk: { level: 'LOW', reasons: ['Begränsad likviditet'] },
    marketContextDiagnostics: {
      historicalContext: { dataQuality: 'COMPLETE', shortTrend: 'UP', mediumTrend: 'UP', longTrend: 'UP', trendAgreement: 1, volatilityState: 'NORMAL', momentumPersistence: 'STRONG', currentDrawdownPercent: 5, maxDrawdownPercent: 10, recoveryPercent: 80, rangePosition: 0.7, volumeTrend: 'RISING', warnings: [], },
      marketRegime: { primaryRegime: 'BULL_TREND', volatilityRegime: 'NORMAL', riskRegime: 'NEUTRAL', confidence: 0.8, strength: 'STRONG', quality: 'COMPLETE', supportingSignals: ['s1'], conflictingSignals: [], warnings: [] },
      contextAlignment: 'SUPPORTIVE',
      contextSummary: ['Kort och lång trend pekar uppåt', 'Volatilitet normal']
    }
  } as any;

  it('BUY + SUPPORTIVE headline and verdict', ()=>{
    const inp = clone(baseInput);
    inp.action = 'BUY'; inp.marketContextDiagnostics!.contextAlignment = 'SUPPORTIVE';
    const out = buildVictorAnalysisNarrative(inp);
    expect(out.headline).toBe('Victor ser ett köpläge som stöds av marknadskontexten');
    expect(out.verdict).toBe('Marknadskontexten stödjer beslutet.');
  });

  it('BUY + CONFLICTING headline', ()=>{
    const inp = clone(baseInput);
    inp.action = 'BUY'; inp.marketContextDiagnostics!.contextAlignment = 'CONFLICTING';
    const out = buildVictorAnalysisNarrative(inp);
    expect(out.headline).toBe('Victor ser ett köpläge, men marknadskontexten varnar');
    expect(out.verdict).toBe('Marknadskontexten indikerar konflikt med beslutet.');
  });

  it('SELL + SUPPORTIVE headline', ()=>{
    const inp = clone(baseInput);
    inp.action = 'SELL'; inp.marketContextDiagnostics!.contextAlignment = 'SUPPORTIVE';
    const out = buildVictorAnalysisNarrative(inp);
    expect(out.headline).toBe('Victor ser ett säljläge som stöds av marknadskontexten');
  });

  it('SELL + CONFLICTING expresses conflict in verdict', ()=>{
    const inp = clone(baseInput);
    inp.action = 'SELL'; inp.marketContextDiagnostics!.contextAlignment = 'CONFLICTING';
    const out = buildVictorAnalysisNarrative(inp);
    expect(out.verdict).toBe('Marknadskontexten indikerar konflikt med beslutet.');
  });

  it('HOLD expresses wait', ()=>{
    const inp = clone(baseInput);
    inp.action = 'HOLD'; inp.marketContextDiagnostics = null;
    const out = buildVictorAnalysisNarrative(inp);
    expect(out.headline).toBe('Victor avvaktar medan signalerna är blandade');
  });

  it('INSUFFICIENT expresses limited data', ()=>{
    const inp = clone(baseInput);
    inp.action = 'BUY'; inp.marketContextDiagnostics = null;
    const out = buildVictorAnalysisNarrative(inp);
    expect(out.headline).toBe('Victor avvaktar eftersom beslutsunderlaget är begränsat');
    expect(out.dataQuality.status).toBe('INSUFFICIENT');
  });

  it('whyNow uses reasoning and de-duplicates and limits', ()=>{
    const inp = clone(baseInput);
    inp.reasoning = ['A','A','B','C','D','E','F'];
    inp.technicalSummary = { reason: 'TechReason' } as any;
    const out = buildVictorAnalysisNarrative(inp);
    expect(out.whyNow.length).toBeLessThanOrEqual(5);
    expect(out.whyNow[0]).toBe('A');
    // dedupe
    expect(out.whyNow.indexOf('A')).toBe(0);
  });

  it('supporting and conflicting factors and risk/watch', ()=>{
    const inp = clone(baseInput);
    inp.marketContextDiagnostics!.contextSummary = ['S1','S2','S3'];
    const mr = inp.marketContextDiagnostics!.marketRegime!;
    mr.supportingSignals = ['sigA','sigB'];
    mr.conflictingSignals = ['confA'];
    inp.marketContextDiagnostics!.historicalContext!.currentDrawdownPercent = 12;
    inp.marketContextDiagnostics!.historicalContext!.volatilityState = 'HIGH';
    inp.marketContextDiagnostics!.historicalContext!.momentumPersistence = 'REVERSING';
    const out = buildVictorAnalysisNarrative(inp);
    expect(out.supportingFactors.length).toBeGreaterThanOrEqual(1);
    expect(out.conflictingFactors.length).toBeGreaterThanOrEqual(1);
    expect(out.riskFactors.some(r=> r.includes('Aktuell drawdown'))).toBe(true);
    expect(out.watchNext.length).toBeGreaterThanOrEqual(1);
  });

  it('data quality mapping GOOD/LIMITED/INSUFFICIENT and missing caps', ()=>{
    const inp = clone(baseInput);
    // GOOD
    inp.marketContextDiagnostics!.historicalContext!.dataQuality = 'COMPLETE';
    const mr2 = inp.marketContextDiagnostics!.marketRegime!;
    mr2.quality = 'COMPLETE';
    (inp.marketContextDiagnostics!.historicalContext as any).missingCapabilities = ['LONG_TREND','VOLUME_TREND','DRAWDOWN_CONTEXT','LONG_TREND'];
    const outGood = buildVictorAnalysisNarrative(inp);
    expect(outGood.dataQuality.status).toBe('GOOD');
    expect(outGood.dataQuality.missing.length).toBeLessThanOrEqual(3);

    // LIMITED
    const inp2 = clone(inp);
    inp2.marketContextDiagnostics!.historicalContext!.dataQuality = 'LIMITED';
    const mr3 = inp2.marketContextDiagnostics!.marketRegime!;
    mr3.quality = 'LIMITED';
    const outLim = buildVictorAnalysisNarrative(inp2);
    expect(outLim.dataQuality.status).toBe('LIMITED');

    // INSUFFICIENT
    const inp3 = clone(inp);
    inp3.marketContextDiagnostics = null;
    const outIns = buildVictorAnalysisNarrative(inp3);
    expect(outIns.dataQuality.status).toBe('INSUFFICIENT');
  });

  it('input immutability and determinism and no raw fields', ()=>{
    const inp = clone(baseInput);
    (inp.marketContextDiagnostics!.historicalContext as any).missingCapabilities = ['A','B'];
    const before = clone(inp);
    const out1 = buildVictorAnalysisNarrative(inp);
    const out2 = buildVictorAnalysisNarrative(inp);
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    expect(JSON.stringify(inp)).toBe(JSON.stringify(before));
    // no raw fields
    const forbidden = ['closes','dates','volumes','returns','providerResponse','apiKey','credentials','rawHistoricalContext'];
    for (const f of forbidden) expect(Object.prototype.hasOwnProperty.call(out1, f)).toBe(false);
    // JSON stringify works
    expect(()=> JSON.stringify(out1)).not.toThrow();
  });

  it('accepts STOCK and FOREX symbols and legacy partial input', ()=>{
    const stock = clone(baseInput); stock.symbol = 'MSFT';
    expect(()=> buildVictorAnalysisNarrative(stock)).not.toThrow();
    const fx = clone(baseInput); fx.symbol = 'EUR/USD';
    expect(()=> buildVictorAnalysisNarrative(fx)).not.toThrow();
    const legacy = { symbol: 'X', action: 'BUY' } as any;
    expect(()=> buildVictorAnalysisNarrative(legacy)).not.toThrow();
  });
});
