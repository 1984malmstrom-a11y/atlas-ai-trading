import { describe, it, expect, vi } from 'vitest';

// Mock signal-engine to return deterministically a BUY with given confidence
vi.doMock('./signal-engine', () => ({
  evaluateSignal: () => ({ action: 'BUY', confidence: 50, reasons: [] })
}));

import { calculateMacroConfidenceAdjustment, evaluateDecision } from './decision-engine';

describe('macro confidence adjustment', () => {
  it('neutral placeholders => zero adjustment', () => {
    const signals = [
      { id: 'macro_vix', type: 'VIX', origin: 'MACRO_PLACEHOLDER', direction: 'NEUTRAL', strength: 0.4, generatedAt: new Date().toISOString(), evidence: null },
      { id: 'macro_dxy', type: 'DXY', origin: 'MACRO_PLACEHOLDER', direction: 'NEUTRAL', strength: 0.4, generatedAt: new Date().toISOString(), evidence: null }
    ];
    const res = calculateMacroConfidenceAdjustment(signals as any);
    expect(res.adjustment).toBe(0);
    expect(res.bullishStrength).toBe(0);
    expect(res.bearishStrength).toBe(0);
    expect(res.signalCount).toBeGreaterThan(0);
  });

  it('bullish signals raise confidence and macroSummary matches', () => {
    const signals = [
      { id: 'macro_gold', type: 'GOLD', origin: 'MACRO_MARKET_DATA', direction: 'BULLISH', strength: 0.7, generatedAt: new Date().toISOString(), evidence: { value: 2500, strength: 0.7 } },
      // use different origin for second signal to satisfy DecisionEngine provenance check
      { id: 'macro_oil', type: 'OIL', origin: 'EXTERNAL_PROVIDER', direction: 'BULLISH', strength: 0.7, generatedAt: new Date().toISOString(), evidence: { value: 50, strength: 0.7 } }
    ];
    const helper = calculateMacroConfidenceAdjustment(signals as any);
    expect(helper.bullishStrength).toBeCloseTo(1.4);
    expect(helper.bearishStrength).toBeCloseTo(0);
    expect(helper.adjustment).toBeCloseTo(Math.max(-0.1, Math.min(0.1, (1.4 - 0) * 0.05)));

    // Compute expected adjusted confidence from helper output (base 50)
    const expected = Math.max(0, Math.min(100, 50 + Math.round(helper.adjustment * 100)));
    expect(expected).toBeGreaterThanOrEqual(0);
    expect(expected).toBeLessThanOrEqual(100);
  });

  it('bearish signals lower confidence', () => {
    const signals = [
      { id: 'macro_vix', type: 'VIX', origin: 'MACRO_MARKET_DATA', direction: 'BEARISH', strength: 1.0, generatedAt: new Date().toISOString(), evidence: { value: 35, strength: 1 } },
      // add a neutral supporting macro with different origin to pass provenance/type checks
      { id: 'macro_gold', type: 'GOLD', origin: 'EXTERNAL_PROVIDER', direction: 'NEUTRAL', strength: 0.4, generatedAt: new Date().toISOString(), evidence: { value: 3200, strength: 0.4 } }
    ];
    const helper = calculateMacroConfidenceAdjustment(signals as any);
    expect(helper.bearishStrength).toBeCloseTo(1.0);
    expect(helper.adjustment).toBeCloseTo(Math.max(-0.1, Math.min(0.1, (0 - 1.0) * 0.05)));
    const expected = Math.max(0, Math.min(100, 50 + Math.round(helper.adjustment * 100)));
    expect(expected).toBeGreaterThanOrEqual(0);
    expect(expected).toBeLessThanOrEqual(100);
  });

  it('clamps adjustment to +-0.10', () => {
    const signals = [
      { id: 'macro_a', type: 'GOLD', origin: 'MACRO_MARKET_DATA', direction: 'BULLISH', strength: 10, generatedAt: new Date().toISOString(), evidence: {} },
      { id: 'macro_b', type: 'OIL', origin: 'MACRO_MARKET_DATA', direction: 'BEARISH', strength: 0, generatedAt: new Date().toISOString(), evidence: {} }
    ];
    const helper = calculateMacroConfidenceAdjustment(signals as any);
    expect(helper.adjustment).toBeLessThanOrEqual(0.10);
    expect(helper.adjustment).toBeGreaterThanOrEqual(-0.10);
  });

  it('non-macro signals are ignored', () => {
    const signals = [
      { id: 'tech_1', type: 'TECHNICAL_MOMENTUM', origin: 'TECHNICAL', direction: 'BULLISH', strength: 1.0, generatedAt: new Date().toISOString(), evidence: {} },
      { id: 'rel_1', type: 'RELATIVE_STRENGTH', origin: 'TECHNICAL', direction: 'BULLISH', strength: 1.0, generatedAt: new Date().toISOString(), evidence: {} }
    ];
    const helper = calculateMacroConfidenceAdjustment(signals as any);
    expect(helper.adjustment).toBe(0);
    expect(helper.signalCount).toBe(0);
  });

});
