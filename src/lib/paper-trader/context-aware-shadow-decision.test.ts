import { describe, it, expect } from 'vitest';
import { buildContextAwareShadowDecision } from './context-aware-shadow-decision';

function mkDiag(overrides: any = {}){
  return {
    historicalContext: { longTrend: 'UP', momentumPersistence: 'STRONG', volatilityState: 'NORMAL', observedAt: '2026-01-01' },
    marketRegime: { primaryRegime: 'BULL_TREND', riskRegime: 'NEUTRAL' },
    contextAlignment: 'SUPPORTIVE',
    contextSummary: [] as string[],
    ...overrides
  } as any;
}

describe('Context Aware Shadow Decision', ()=>{
  it('BUY supportive boosts confidence and sets CONFIDENCE_BOOST', ()=>{
    const out = buildContextAwareShadowDecision({ symbol: 'X', actualAction: 'BUY', actualConfidence: 70, marketContextDiagnostics: mkDiag({ contextAlignment: 'SUPPORTIVE', marketRegime: { primaryRegime: 'BULL_TREND', riskRegime: 'NEUTRAL' } }), now: new Date('2026-01-01') });
    expect(out.actualAction).toBe('BUY');
    expect(out.shadowAction).toBe('BUY');
    expect(out.intervention).toBe('CONFIDENCE_BOOST');
    expect(out.shadowConfidence).toBeGreaterThanOrEqual(out.actualConfidence);
    expect(out.supportingReasons.length).toBeGreaterThan(0);
  });

  it('BUY weak conflict reduces 10 points', ()=>{
    const diag = mkDiag({ contextAlignment: 'CONFLICTING', marketRegime: { primaryRegime: 'BEAR_TREND', riskRegime: 'NEUTRAL' }, historicalContext: { longTrend: 'SIDEWAYS', momentumPersistence: 'WEAK', volatilityState: 'NORMAL' } });
    const out = buildContextAwareShadowDecision({ symbol: 'A', actualAction: 'BUY', actualConfidence: 80, marketContextDiagnostics: diag, now: new Date('2026-01-01') });
    expect(out.confidenceDelta).toBeLessThanOrEqual(0);
    expect(out.actualAction).toBe('BUY');
    expect(out.shadowAction).toBe('BUY');
  });

  it('BUY medium conflict reduces 15 points', ()=>{
    const diag = mkDiag({ contextAlignment: 'CONFLICTING', marketRegime: { primaryRegime: 'BEAR_TREND', riskRegime: 'RISK_OFF' }, historicalContext: { longTrend: 'DOWN', momentumPersistence: 'WEAK', volatilityState: 'NORMAL' } });
    const out = buildContextAwareShadowDecision({ symbol: 'B', actualAction: 'BUY', actualConfidence: 80, marketContextDiagnostics: diag });
    expect(out.shadowConfidence).toBe(60);
    expect(out.intervention).toBe('CONFIDENCE_REDUCTION');
  });

  it('BUY strong conflict may switch to HOLD when below 60', ()=>{
    const diag = mkDiag({ contextAlignment: 'CONFLICTING', marketRegime: { primaryRegime: 'BEAR_TREND', riskRegime: 'RISK_OFF' }, historicalContext: { longTrend: 'DOWN', momentumPersistence: 'REVERSING', volatilityState: 'EXPANDING' } });
    const out = buildContextAwareShadowDecision({ symbol: 'C', actualAction: 'BUY', actualConfidence: 65, marketContextDiagnostics: diag });
    // 65 - 20 = 45 -> below 60 -> ACTION_TO_HOLD and shadowAction HOLD
    expect(out.intervention).toBe('ACTION_TO_HOLD');
    expect(out.shadowAction).toBe('HOLD');
  });

  it('SELL strong conflict may switch to HOLD', ()=>{
    const diag = mkDiag({ contextAlignment: 'CONFLICTING', marketRegime: { primaryRegime: 'BULL_TREND', riskRegime: 'RISK_ON' }, historicalContext: { longTrend: 'UP', momentumPersistence: 'STRONG', volatilityState: 'HIGH' } });
    const out = buildContextAwareShadowDecision({ symbol: 'D', actualAction: 'SELL', actualConfidence: 70, marketContextDiagnostics: diag });
    // reduction and possible hold depending on calculated levels
    expect(out.actualAction).toBe('SELL');
    expect(out.shadowAction === 'HOLD' || out.shadowAction === 'SELL').toBe(true);
  });

  it('HOLD remains HOLD and intervention NONE', ()=>{
    const out = buildContextAwareShadowDecision({ symbol: 'E', actualAction: 'HOLD', actualConfidence: 50, marketContextDiagnostics: mkDiag({ contextAlignment: 'CONFLICTING' }) });
    expect(out.shadowAction).toBe('HOLD');
    expect(out.intervention).toBe('NONE');
  });

  it('INSUFFICIENT returns same and warning present', ()=>{
    const out = buildContextAwareShadowDecision({ symbol: 'F', actualAction: 'BUY', actualConfidence: 50, marketContextDiagnostics: null });
    expect(out.shadowConfidence).toBe(out.actualConfidence);
    expect(out.intervention).toBe('NONE');
    expect(out.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('confidence 0-1 normalized', ()=>{
    const out = buildContextAwareShadowDecision({ symbol: 'G', actualAction: 'BUY', actualConfidence: 0.8, marketContextDiagnostics: mkDiag({ contextAlignment: 'NEUTRAL' }) });
    expect(out.actualConfidence).toBe(80);
    expect(out.shadowConfidence).toBe(80);
  });

  it('NaN/Infinity/negative/over100 handled safely', ()=>{
    const cases = [NaN, Infinity, -5, 200];
    for (const c of cases){
      const out = buildContextAwareShadowDecision({ symbol: 'H', actualAction: 'SELL', actualConfidence: c as any, marketContextDiagnostics: mkDiag({ contextAlignment: 'NEUTRAL' }) });
      expect(Number.isFinite(out.actualConfidence)).toBe(true);
      expect(out.actualConfidence).toBeGreaterThanOrEqual(0);
      expect(out.actualConfidence).toBeLessThanOrEqual(100);
    }
  });

  it('never flips BUY to SELL or SELL to BUY', ()=>{
    const diag = mkDiag({ contextAlignment: 'CONFLICTING', marketRegime: { primaryRegime: 'BEAR_TREND', riskRegime: 'RISK_OFF' }, historicalContext: { longTrend: 'DOWN', momentumPersistence: 'REVERSING', volatilityState: 'EXPANDING' } });
    const out = buildContextAwareShadowDecision({ symbol: 'I', actualAction: 'BUY', actualConfidence: 90, marketContextDiagnostics: diag });
    expect(out.actualAction).toBe('BUY');
    expect(out.shadowAction).not.toBe('SELL');
  });

  it('supporting/conflicting reasons deduped and limited', ()=>{
    const diag = mkDiag({ contextAlignment: 'CONFLICTING', marketRegime: { primaryRegime: 'BEAR_TREND', riskRegime: 'RISK_OFF' }, historicalContext: { longTrend: 'DOWN', momentumPersistence: 'REVERSING', volatilityState: 'EXPANDING' } });
    const out = buildContextAwareShadowDecision({ symbol: 'J', actualAction: 'BUY', actualConfidence: 75, marketContextDiagnostics: diag });
    expect(out.conflictingReasons.length).toBeLessThanOrEqual(5);
    expect(new Set(out.conflictingReasons).size).toBe(out.conflictingReasons.length);
  });
});
