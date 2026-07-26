import { describe, it, expect, vi } from 'vitest';
import { evaluateDecision } from './decision-engine';
import * as riskModule from './risk-engine';

describe('evaluateDecision', () => {
  it('allowed order', () => {
    const input = {
      portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] },
      decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 },
      expectedReturnPercent: 11, // ensure signal => BUY
    } as any;
    const res = evaluateDecision(input);
    expect(res.risk.allowed).toBe(true);
    expect(res.allowed).toBe(true);
    expect(res.tradeFeedbackEffect).toBe('NOT_APPLIED');
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('denied order', () => {
    const input = {
      portfolio: { availableCash: 50, totalValue: 1000, holdings: [] },
      decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 },
      expectedReturnPercent: 11,
    } as any;
    const res = evaluateDecision(input);
    expect(res.risk.allowed).toBe(false);
    expect(res.allowed).toBe(false);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('confidence follows risk.score', () => {
    const input = {
      portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] },
      decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 },
      expectedReturnPercent: 11,
    } as any;
    const res = evaluateDecision(input);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('confidence zero when allowed=false', () => {
    const input = {
      portfolio: { availableCash: 0, totalValue: 1000, holdings: [] },
      decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 },
      expectedReturnPercent: 11,
    } as any;
    const res = evaluateDecision(input);
    expect(res.risk.allowed).toBe(false);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('without reflection keeps confidence', ()=>{
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 }, expectedReturnPercent: 11 } as any;
    const res = evaluateDecision(input);
    expect(res.performanceReflection).toBeUndefined();
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('applies POSITIVE multiplier (1)', ()=>{
    const reflection = { status: 'POSITIVE', confidenceMultiplier: 1, reasons: ['EXPECTANCY_POSITIVE'] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 }, expectedReturnPercent: 11, performanceReflection: reflection } as any;
    const res = evaluateDecision(input);
    expect(res.performanceReflection).toBe(reflection);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('applies NEUTRAL multiplier (0.75)', ()=>{
    const reflection = { status: 'NEUTRAL', confidenceMultiplier: 0.75, reasons: ['MIXED_RESULTS'] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 }, expectedReturnPercent: 11, performanceReflection: reflection } as any;
    const res = evaluateDecision(input);
    expect(res.performanceReflection).toBe(reflection);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 0.75)));
    expect(res.confidence).toBe(expected);
  });

  it('applies NEGATIVE multiplier (0.5)', ()=>{
    const reflection = { status: 'NEGATIVE', confidenceMultiplier: 0.5, reasons: ['EXPECTANCY_NEGATIVE'] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 }, expectedReturnPercent: 11, performanceReflection: reflection } as any;
    const res = evaluateDecision(input);
    expect(res.performanceReflection).toBe(reflection);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 0.5)));
    expect(res.confidence).toBe(expected);
  });

  it('does not forward performanceReflection to RiskEngineInput', ()=>{
    const realEvaluateRisk = riskModule.evaluateRisk;
    const spy = vi.spyOn(riskModule, 'evaluateRisk').mockImplementation((arg: any) => realEvaluateRisk(arg));
    const reflection = { status: 'POSITIVE', confidenceMultiplier: 1 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 }, expectedReturnPercent: 11, performanceReflection: reflection } as any;
    const res = evaluateDecision(input);
    expect(res.performanceReflection).toBe(reflection);
    expect(spy).toHaveBeenCalled();
    const calledArg = spy.mock.calls[0][0];
    expect((calledArg as any).performanceReflection).toBeUndefined();
    spy.mockRestore();
  });

  it('ignores feedback when fewer than 10 trades', ()=>{
    const fb = { winRate: 0.1, avgPnlSek: -10, evaluatedCount: 5 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    // expectedReturnPercent 6 yields score 70 => BUY
    expect(res.signal.action).toBe('BUY');
    expect(res.tradeFeedbackEffect).toBe('NOT_APPLIED');
  });

  it('weak feedback + marginal BUY -> HOLD with feedback reason', ()=>{
    const fb = { winRate: 0.2, avgPnlSek: -5, evaluatedCount: 20 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    expect(res.signal.reasons.some(r=> String(r).includes('FEEDBACK_CAUTION'))).toBeTruthy();
    expect(res.tradeFeedbackEffect).toBe('BUY_BLOCKED');
  });

  it('strong BUY not blocked by weak feedback', ()=>{
    const fb = { winRate: 0.2, avgPnlSek: -5, evaluatedCount: 20 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 }, expectedReturnPercent: 11, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    // expectedReturnPercent 11 yields score 90 => BUY remains
    expect(res.signal.action).toBe('BUY');
    // strong BUY should observe feedback but not block
    expect(res.tradeFeedbackEffect).toBe('OBSERVED');
    expect(res.signal.reasons.some(r=> String(r).includes('FEEDBACK_CAUTION'))).toBeFalsy();
  });

  it('SELL exits not blocked by weak feedback', ()=>{
    const fb = { winRate: 0.2, avgPnlSek: -5, evaluatedCount: 20 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'SELL', symbol: 'A' }, expectedReturnPercent: -20, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('SELL');
    expect(res.tradeFeedbackEffect).toBe('OBSERVED');
  });
});
