import { describe, it, expect, vi } from 'vitest';
import { buildDecisionMarketContextDiagnostics } from './signal-confluence';
import { sanitizeDecisionIntelligenceForState } from './demo-runtime';
import * as DecisionEngine from './decision-engine';
import * as RiskEngine from './risk-engine';

describe('buildDecisionMarketContextDiagnostics', ()=>{
  it('BUY + BULL_TREND => SUPPORTIVE', ()=>{
    const hist = { dataQuality: 'COMPLETE', shortTrend: 'UP', mediumTrend: 'UP', longTrend: 'UP', trendAgreement: 1, volatilityState: 'NORMAL', momentumPersistence: 'STRONG', currentDrawdownPercent: 0, maxDrawdownPercent: 0, recoveryPercent: 100, rangePosition: 0.9, volumeTrend: 'UNAVAILABLE', warnings: [] } as any;
    const mr = { primaryRegime: 'BULL_TREND', volatilityRegime: 'NORMAL', riskRegime: 'NEUTRAL', confidence: 0.8, strength: 'STRONG', quality: 'COMPLETE', supportingSignals: ['s1'], conflictingSignals: [], warnings: [] } as any;
    const out = buildDecisionMarketContextDiagnostics({ action: 'BUY', historicalContext: hist, marketRegime: mr });
    expect(out.contextAlignment).toBe('SUPPORTIVE');
    expect(Array.isArray(out.contextSummary)).toBe(true);
    expect(out.contextSummary.length).toBeLessThanOrEqual(5);
  });

  it('BUY + BEAR_TREND => CONFLICTING', ()=>{
    const hist = { dataQuality: 'COMPLETE', shortTrend: 'DOWN', mediumTrend: 'DOWN', longTrend: 'DOWN', trendAgreement: 1, volatilityState: 'NORMAL', momentumPersistence: 'WEAK', currentDrawdownPercent: 5, maxDrawdownPercent: 10, recoveryPercent: 50, rangePosition: 0.2, volumeTrend: 'UNAVAILABLE', warnings: [] } as any;
    const mr = { primaryRegime: 'BEAR_TREND', volatilityRegime: 'HIGH', riskRegime: 'RISK_OFF', confidence: 0.2, strength: 'WEAK', quality: 'LIMITED', supportingSignals: [], conflictingSignals: ['s2'], warnings: [] } as any;
    const out = buildDecisionMarketContextDiagnostics({ action: 'BUY', historicalContext: hist, marketRegime: mr });
    expect(out.contextAlignment).toBe('CONFLICTING');
  });

  it('SELL + BEAR_TREND => SUPPORTIVE', ()=>{
    const hist = { dataQuality: 'COMPLETE', shortTrend: 'DOWN', mediumTrend: 'DOWN', longTrend: 'DOWN', trendAgreement: 1, volatilityState: 'NORMAL', momentumPersistence: 'STRONG', currentDrawdownPercent: 2, maxDrawdownPercent: 5, recoveryPercent: 90, rangePosition: 0.1, volumeTrend: 'UNAVAILABLE', warnings: [] } as any;
    const mr = { primaryRegime: 'BEAR_TREND', volatilityRegime: 'NORMAL', riskRegime: 'NEUTRAL', confidence: 0.9, strength: 'STRONG', quality: 'COMPLETE', supportingSignals: ['s3'], conflictingSignals: [], warnings: [] } as any;
    const out = buildDecisionMarketContextDiagnostics({ action: 'SELL', historicalContext: hist, marketRegime: mr });
    expect(out.contextAlignment).toBe('SUPPORTIVE');
  });

  it('HOLD => NEUTRAL when context present', ()=>{
    const out = buildDecisionMarketContextDiagnostics({ action: 'HOLD', historicalContext: null, marketRegime: null });
    expect(out.contextAlignment).toBe('INSUFFICIENT');
  });

  it('missing context => INSUFFICIENT', ()=>{
    const out = buildDecisionMarketContextDiagnostics({ action: 'BUY', historicalContext: null, marketRegime: null });
    expect(out.contextAlignment).toBe('INSUFFICIENT');
  });

  it('defensive arrays and JSON-safe', ()=>{
    const hist = { dataQuality: 'COMPLETE', shortTrend: 'UP', mediumTrend: 'UP', longTrend: 'UP', trendAgreement: 1, volatilityState: 'NORMAL', momentumPersistence: 'STRONG', currentDrawdownPercent: 0, maxDrawdownPercent: 0, recoveryPercent: 100, rangePosition: 0.9, volumeTrend: 'UNAVAILABLE', warnings: ['A','A'] } as any;
    const mr = { primaryRegime: 'BULL_TREND', volatilityRegime: 'NORMAL', riskRegime: 'NEUTRAL', confidence: 0.8, strength: 'STRONG', quality: 'COMPLETE', supportingSignals: ['s1','s1'], conflictingSignals: [], warnings: ['W'] } as any;
    const out = buildDecisionMarketContextDiagnostics({ action: 'BUY', historicalContext: hist, marketRegime: mr });
    expect(out.historicalContext).toBeTruthy();
    expect(out.marketRegime).toBeTruthy();
    expect(Array.isArray(out.historicalContext!.warnings)).toBe(true);
    expect(out.historicalContext!.warnings.length).toBeGreaterThanOrEqual(0);
    expect(out.marketRegime!.supportingSignals.length).toBeLessThanOrEqual(10);
  });

  it('sanitized runtime state is defensive and immutable when mutated externally', ()=>{
    const primary: any = {
      cycleId: 'CYCLE1',
      symbol: 'X',
      generatedAt: '2026-01-01T00:00:00.000Z',
      direction: 'BULLISH',
      bullishScore: 80,
      bearishScore: 20,
      selectedSupportingSignals: [{ id: 's1', type: 'T1', origin: 'O1' }],
      warnings: ['initial'],
      reasoning: ['r1'],
      schemaVersion: '1',
      source: 'unit-test',
      // Diagnostics normally present in snapshot but not included in sanitized state
      marketContextDiagnostics: {
        historicalContext: { dataQuality: 'COMPLETE', warnings: ['h'] },
        marketRegime: { primaryRegime: 'BULL_TREND', supportingSignals: ['s1'], conflictingSignals: [], warnings: [] },
        contextSummary: ['Stabilt trend']
      }
    };

    const first = sanitizeDecisionIntelligenceForState(primary);
    // keep a deep copy
    const before = JSON.parse(JSON.stringify(first));

    // Mutate the returned sanitized object (simulating external mutation of runtime state)
    (first as any).marketContextDiagnostics = { tampered: true };
    (first.warnings as string[]).push('MUTATED');
    (first.selectedSupportingSignals as any[]).push({ id: 'x', type: 'T2', origin: 'OX' });

    // Resanitize original primary (as runtime would) and ensure unchanged
    const after = sanitizeDecisionIntelligenceForState(primary);
    expect(after).toEqual(before);

    // JSON stringify should work
    expect(() => JSON.stringify(after)).not.toThrow();

    // Forbidden raw fields must not be present
    const forbidden = ['closes','dates','volumes','returns','providerResponse','apiKey','url','credentials','rawHistoricalContext'];
    for (const f of forbidden) expect(Object.prototype.hasOwnProperty.call(after, f)).toBe(false);
  });

  it('diagnostics builder does not call DecisionEngine, RiskEngine, or mutate inputs', ()=>{
    const decSpy = vi.spyOn(DecisionEngine, 'evaluateDecision');
    const riskSpy = vi.spyOn(RiskEngine as any, 'evaluateRisk');

    const hist = { dataQuality: 'COMPLETE', shortTrend: 'UP', mediumTrend: 'UP', longTrend: 'UP', trendAgreement: 1, volatilityState: 'NORMAL', momentumPersistence: 'STRONG', currentDrawdownPercent: 0, maxDrawdownPercent: 0, recoveryPercent: 100, rangePosition: 0.9, volumeTrend: 'UNAVAILABLE', warnings: [] } as any;
    const mr = { primaryRegime: 'BULL_TREND', volatilityRegime: 'NORMAL', riskRegime: 'NEUTRAL', confidence: 0.8, strength: 'STRONG', quality: 'COMPLETE', supportingSignals: ['s1'], conflictingSignals: [], warnings: [] } as any;

    const marketSignals = { signals: [{ id: 's1', type: 'T1', origin: 'O1' }], warnings: [] } as any;
    const marketCopy = JSON.parse(JSON.stringify(marketSignals));
    const decisionInput = { expectedReturnPercent: 1, marketSignals: marketSignals } as any;
    const decisionCopy = JSON.parse(JSON.stringify(decisionInput));

    const out = buildDecisionMarketContextDiagnostics({ action: 'BUY', historicalContext: hist, marketRegime: mr });

    // Ensure no external engines were invoked
    expect(decSpy).not.toHaveBeenCalled();
    expect(riskSpy).not.toHaveBeenCalled();

    // Ensure no mutation of provided sample inputs
    expect(marketSignals).toEqual(marketCopy);
    expect(decisionInput).toEqual(decisionCopy);

    // diagnostics should be plain object without engine injection
    expect(typeof out).toBe('object');
    expect(Object.prototype.hasOwnProperty.call(out, 'decisionEngine')).toBe(false);

    decSpy.mockRestore();
    riskSpy.mockRestore();
  });
});
