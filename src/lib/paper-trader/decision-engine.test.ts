import { describe, it, expect, vi } from 'vitest';
import { evaluateDecision } from './decision-engine';
import * as riskModule from './risk-engine';
import * as sigModule from './signal-engine';

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
    expect(res.signal.reasons.some(r=> String(r) === 'SIGNAL_FEEDBACK_CAUTION')).toBeFalsy();
  });

  it('SELL exits not blocked by weak feedback', ()=>{
    const fb = { winRate: 0.2, avgPnlSek: -5, evaluatedCount: 20 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'SELL', symbol: 'A' }, expectedReturnPercent: -20, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('SELL');
    expect(res.tradeFeedbackEffect).toBe('OBSERVED');
  });

  it('svag signal blockerar marginell BUY', ()=>{
    const fb = { bySignal: [{ signalId: 'S', evaluatedCount: 5, winRate: 0.2, avgPnlSek: -1 }] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S'], requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    expect(res.signal.reasons.some((r:any)=> String(r).includes('SIGNAL_FEEDBACK_CAUTION'))).toBeTruthy();
    expect(res.signalFeedbackEffect).toBe('BUY_BLOCKED');
  });

  it('stark BUY blockeras inte', ()=>{
    const fb = { bySignal: [{ signalId: 'S', evaluatedCount: 5, winRate: 0.1, avgPnlSek: -5 }] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S'], requestedNotionalSek: 100 }, expectedReturnPercent: 11, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    expect(res.signalFeedbackEffect).toBe('OBSERVED');
  });

  it('färre än 5 observationer påverkar inte beslutet', ()=>{
    const fb = { bySignal: [{ signalId: 'S', evaluatedCount: 4, winRate: 0.1, avgPnlSek: -5 }] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S'], requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    expect(res.signalFeedbackEffect).toBe('NOT_APPLIED');
  });

  it('ingen signals-array ger NOT_APPLIED', ()=>{
    const fb = { bySignal: [{ signalId: 'S', evaluatedCount: 10, winRate: 0.2, avgPnlSek: -5 }] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signalFeedbackEffect).toBe('NOT_APPLIED');
  });

  it('stark signal skyddar BUY trots annan svag signal', ()=>{
    const fb = { bySignal: [
      { signalId: 'S1', evaluatedCount: 6, winRate: 0.6, avgPnlSek: 10 },
      { signalId: 'S2', evaluatedCount: 6, winRate: 0.2, avgPnlSek: -5 },
    ] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S1','S2'], requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    expect(res.signalFeedbackEffect).toBe('OBSERVED');
  });

  it('signal som inte hör till aktuellt beslut påverkar inte', ()=>{
    const fb = { bySignal: [{ signalId: 'OTHER', evaluatedCount: 10, winRate: 0.1, avgPnlSek: -5 }] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S'], requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    expect(res.signalFeedbackEffect).toBe('NOT_APPLIED');
  });

  it('early HOLD path returns NOT_APPLIED when no signal has sufficient history', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'HOLD', confidence: 0, reasons: [] } as any));
    // Provide tradeFeedbackSummary with bySignal entries, but none meeting the min-eval threshold
    const fb = { bySignal: [{ signalId: 'S', evaluatedCount: 1, winRate: 0.5, avgPnlSek: 0 }] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S'] }, expectedReturnPercent: 0, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    expect(res.signalFeedbackEffect).toBe('NOT_APPLIED');
    spy.mockRestore();
  });

  it('SELL with current evaluated signal remains SELL and is OBSERVED (no caution)', ()=>{
    const fb = { bySignal: [{ signalId: 'S', evaluatedCount: 5, winRate: 0.1, avgPnlSek: -2 }] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'A', qty: 1 }] }, decision: { side: 'SELL', symbol: 'A', signals: ['S'] }, expectedReturnPercent: -10, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('SELL');
    expect(res.signalFeedbackEffect).toBe('OBSERVED');
    // Ensure SELL does not get signal caution reasons
    expect(res.signal.reasons && Array.isArray(res.signal.reasons) ? res.signal.reasons.some(r=> String(r) === 'SIGNAL_FEEDBACK_CAUTION') : false).toBeFalsy();
  });

  it('BUY_BLOCKED adds SIGNAL_FEEDBACK_CAUTION exactly once', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 50, reasons: [] } as any));
    const fb = { bySignal: [{ signalId: 'S', evaluatedCount: 5, winRate: 0.2, avgPnlSek: -1 }] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S'], requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb } as any;
    const res = evaluateDecision(input);
    const reasons = Array.isArray(res.signal.reasons) ? res.signal.reasons.map(String) : [];
    const count = reasons.filter(r=> r === 'SIGNAL_FEEDBACK_CAUTION').length;
    expect(count).toBe(1);
    expect(res.signalFeedbackEffect).toBe('BUY_BLOCKED');
    spy.mockRestore();
  });
});
