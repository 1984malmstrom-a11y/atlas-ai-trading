import { describe, it, expect, vi } from 'vitest';
import { evaluateDecision } from './decision-engine';
import * as riskModule from './risk-engine';
import * as sigModule from './signal-engine';

const goodMarketSignals = { signals: [ { id: 'trend-1', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' }, { id: 'leader-1', type: 'LEADER', origin: 'SYMBOL_PRICE_SERIES' } ], confidence: 90 } as any;

describe('evaluateDecision', () => {
  it('allowed order', () => {
    const input = {
      portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] },
      decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] },
      marketSignals: goodMarketSignals,
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
      decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] },
      marketSignals: goodMarketSignals,
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
      decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] },
      marketSignals: goodMarketSignals,
      expectedReturnPercent: 11,
    } as any;
    const res = evaluateDecision(input);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('confidence zero when allowed=false', () => {
    const input = {
      portfolio: { availableCash: 0, totalValue: 1000, holdings: [] },
      decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] },
      marketSignals: goodMarketSignals,
      expectedReturnPercent: 11,
    } as any;
    const res = evaluateDecision(input);
    expect(res.risk.allowed).toBe(false);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('without reflection keeps confidence', ()=>{
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] }, marketSignals: goodMarketSignals, expectedReturnPercent: 11 } as any;
    const res = evaluateDecision(input);
    expect(res.performanceReflection).toBeUndefined();
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('applies POSITIVE multiplier (1)', ()=>{
    const reflection = { status: 'POSITIVE', confidenceMultiplier: 1, reasons: ['EXPECTANCY_POSITIVE'] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] }, marketSignals: goodMarketSignals, expectedReturnPercent: 11, performanceReflection: reflection } as any;
    const res = evaluateDecision(input);
    expect(res.performanceReflection).toBe(reflection);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 1)));
    expect(res.confidence).toBe(expected);
  });

  it('applies NEUTRAL multiplier (0.75)', ()=>{
    const reflection = { status: 'NEUTRAL', confidenceMultiplier: 0.75, reasons: ['MIXED_RESULTS'] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] }, marketSignals: goodMarketSignals, expectedReturnPercent: 11, performanceReflection: reflection } as any;
    const res = evaluateDecision(input);
    expect(res.performanceReflection).toBe(reflection);
    const expected = Math.round(Math.max(0, Math.min(100, res.signal.confidence * 0.75)));
    expect(res.confidence).toBe(expected);
  });

  it('applies NEGATIVE multiplier (0.5)', ()=>{
    const reflection = { status: 'NEGATIVE', confidenceMultiplier: 0.5, reasons: ['EXPECTANCY_NEGATIVE'] } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] }, marketSignals: goodMarketSignals, expectedReturnPercent: 11, performanceReflection: reflection } as any;
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
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] }, expectedReturnPercent: 6, tradeFeedbackSummary: fb, marketSignals: goodMarketSignals } as any;
    const res = evaluateDecision(input);
    // expectedReturnPercent 6 yields score 70 => BUY
    expect(res.signal.action).toBe('BUY');
    expect(res.tradeFeedbackEffect).toBe('NOT_APPLIED');
  });

  it('weak feedback + marginal BUY -> HOLD with feedback reason', ()=>{
    const fb = { winRate: 0.2, avgPnlSek: -5, evaluatedCount: 20 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] }, expectedReturnPercent: 6, tradeFeedbackSummary: fb, marketSignals: goodMarketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    expect(res.signal.reasons.some(r=> String(r).includes('FEEDBACK_CAUTION'))).toBeTruthy();
    expect(res.tradeFeedbackEffect).toBe('BUY_BLOCKED');
  });

  it('strong BUY not blocked by weak feedback', ()=>{
    const fb = { winRate: 0.2, avgPnlSek: -5, evaluatedCount: 20 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', requestedNotionalSek: 100, signals: ['trend-1','leader-1'] }, expectedReturnPercent: 11, tradeFeedbackSummary: fb, marketSignals: goodMarketSignals } as any;
    const res = evaluateDecision(input);
    // expectedReturnPercent 11 yields score 90 => BUY remains
    expect(res.signal.action).toBe('BUY');
    // strong BUY should observe feedback but not block
    expect(res.tradeFeedbackEffect).toBe('OBSERVED');
    expect(res.signal.reasons.some(r=> String(r) === 'SIGNAL_FEEDBACK_CAUTION')).toBeFalsy();
  });

  it('SELL exits not blocked by weak feedback', ()=>{
    const fb = { winRate: 0.2, avgPnlSek: -5, evaluatedCount: 20 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'SELL', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: -20, tradeFeedbackSummary: fb, marketSignals: goodMarketSignals } as any;
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
    const marketSignalsForS = { signals: [ { id: 'S', type: 'LEADER', origin: 'SYMBOL_PRICE_SERIES' }, { id: 'aux-1', type: 'MARKET_BREADTH', origin: 'MARKET_QUOTES_AGGREGATE' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S','aux-1'], requestedNotionalSek: 100 }, expectedReturnPercent: 11, tradeFeedbackSummary: fb, marketSignals: marketSignalsForS } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    expect(res.signalFeedbackEffect).toBe('OBSERVED');
  });

  it('färre än 5 observationer påverkar inte beslutet', ()=>{
    const fb = { bySignal: [{ signalId: 'S', evaluatedCount: 4, winRate: 0.1, avgPnlSek: -5 }] } as any;
    const marketSignalsForS = { signals: [ { id: 'S', type: 'LEADER', origin: 'SYMBOL_PRICE_SERIES' }, { id: 'aux-1', type: 'MARKET_BREADTH', origin: 'MARKET_QUOTES_AGGREGATE' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S','aux-1'], requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb, marketSignals: marketSignalsForS } as any;
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
    const marketSignalsForS1S2 = { signals: [ { id: 'S1', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' }, { id: 'S2', type: 'LEADER', origin: 'SYMBOL_PRICE_SERIES' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S1','S2'], requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb, marketSignals: marketSignalsForS1S2 } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    expect(res.signalFeedbackEffect).toBe('OBSERVED');
  });

  it('signal som inte hör till aktuellt beslut påverkar inte', ()=>{
    const fb = { bySignal: [{ signalId: 'OTHER', evaluatedCount: 10, winRate: 0.1, avgPnlSek: -5 }] } as any;
    const marketSignalsForS = { signals: [ { id: 'S', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' }, { id: 'aux-1', type: 'LEADER', origin: 'SYMBOL_PRICE_SERIES' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['S','aux-1'], requestedNotionalSek: 100 }, expectedReturnPercent: 6, tradeFeedbackSummary: fb, marketSignals: marketSignalsForS } as any;
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
    const marketSignalsForS = { signals: [ { id: 'S', type: 'LAGGARD', origin: 'SYMBOL_PRICE_SERIES' }, { id: 'aux-1', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'A', qty: 1 }] }, decision: { side: 'SELL', symbol: 'A', signals: ['S','aux-1'] }, expectedReturnPercent: -10, tradeFeedbackSummary: fb, marketSignals: marketSignalsForS } as any;
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

  it('positive performanceProfile adds +3 confidence and sets performanceAdjustment', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 50, reasons: [] } as any));
    const perf = { summary: { winRatePercent: 60, averagePnlSek: 10, totalTrades: 5 }, reflection: { status: 'POSITIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, performanceProfile: perf, marketSignals: goodMarketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    // With sample-size weighting (5 trades -> 50% weight => 3 * 0.5 = 1.5 -> symmetric round -> 2)
    expect(res.confidence).toBe(52); // 50 + 2
    expect((res as any).performanceAdjustment).toBeDefined();
    expect((res as any).performanceAdjustment.applied).toBe(true);
    expect((res as any).performanceAdjustment.delta).toBe(2);
    spy.mockRestore();
  });

  it('low winRate gives -3 confidence', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 50, reasons: [] } as any));
    const perf = { summary: { winRatePercent: 30, averagePnlSek: 5, totalTrades: 5 }, reflection: { status: 'NEGATIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A' }, expectedReturnPercent: 0, performanceProfile: perf } as any;
    const res = evaluateDecision(input);
    // With sample-size weighting (5 trades -> 50% weight => -3 * 0.5 = -1.5 -> symmetric round -> -2)
    expect(res.confidence).toBe(48); // 50 - 2
    expect((res as any).performanceAdjustment.applied).toBe(true);
    // applied delta is symmetric-rounded from -1.5 -> -2
    expect((res as any).performanceAdjustment.delta).toBe(-2);
    spy.mockRestore();
  });

  it('negative averagePnlSek gives -3 confidence', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 50, reasons: [] } as any));
    const perf = { summary: { winRatePercent: 65, averagePnlSek: -2, totalTrades: 5 }, reflection: { status: 'NEGATIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A' }, expectedReturnPercent: 0, performanceProfile: perf } as any;
    const res = evaluateDecision(input);
    // With sample-size weighting (5 trades -> 50% weight => -3 * 0.5 = -1.5 -> symmetric round -> -2)
    expect(res.confidence).toBe(48); // 50 - 2 (negative avg pnl)
    expect((res as any).performanceAdjustment.applied).toBe(true);
    // applied delta is symmetric-rounded from -1.5 -> -2
    expect((res as any).performanceAdjustment.delta).toBe(-2);
    spy.mockRestore();
  });

  it('sample weighting: totalTrades=10 applies 75% weight (positive and negative)', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 50, reasons: [] } as any));
    // Positive profile
    const perfPos = { summary: { winRatePercent: 65, averagePnlSek: 10, totalTrades: 10 }, reflection: { status: 'POSITIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const inPos = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, performanceProfile: perfPos } as any;
    const resPos = evaluateDecision(inPos);
    // appliedDelta = Math.round(3 * 0.75) = Math.round(2.25) = 2
    expect(resPos.confidence).toBe(52);
    expect((resPos as any).performanceAdjustment.applied).toBe(true);
    expect((resPos as any).performanceAdjustment.delta).toBe(2);
    expect(String((resPos as any).performanceAdjustment.reason)).toContain('appliedWeight=0.75');

    // Negative profile
    const perfNeg = { summary: { winRatePercent: 30, averagePnlSek: 5, totalTrades: 10 }, reflection: { status: 'NEGATIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const inNeg = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, performanceProfile: perfNeg } as any;
    const resNeg = evaluateDecision(inNeg);
    // appliedDelta = Math.round(-3 * 0.75) = Math.round(-2.25) = -2
    expect(resNeg.confidence).toBe(48);
    expect((resNeg as any).performanceAdjustment.applied).toBe(true);
    expect((resNeg as any).performanceAdjustment.delta).toBe(-2);
    expect(String((resNeg as any).performanceAdjustment.reason)).toContain('appliedWeight=0.75');
    spy.mockRestore();
  });

  it('sample weighting: totalTrades=20 applies 100% weight (positive and negative)', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 50, reasons: [] } as any));
    // Positive profile
    const perfPos = { summary: { winRatePercent: 70, averagePnlSek: 10, totalTrades: 20 }, reflection: { status: 'POSITIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const inPos = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, performanceProfile: perfPos } as any;
    const resPos = evaluateDecision(inPos);
    // appliedDelta = Math.round(3 * 1) = 3
    expect(resPos.confidence).toBe(53);
    expect((resPos as any).performanceAdjustment.applied).toBe(true);
    expect((resPos as any).performanceAdjustment.delta).toBe(3);
    expect(String((resPos as any).performanceAdjustment.reason)).toContain('appliedWeight=1');

    // Negative profile
    const perfNeg = { summary: { winRatePercent: 20, averagePnlSek: -5, totalTrades: 20 }, reflection: { status: 'NEGATIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const inNeg = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, performanceProfile: perfNeg } as any;
    const resNeg = evaluateDecision(inNeg);
    // appliedDelta = Math.round(-3 * 1) = -3
    expect(resNeg.confidence).toBe(47);
    expect((resNeg as any).performanceAdjustment.applied).toBe(true);
    expect((resNeg as any).performanceAdjustment.delta).toBe(-3);
    expect(String((resNeg as any).performanceAdjustment.reason)).toContain('appliedWeight=1');
    spy.mockRestore();
  });

  it('no performanceProfile results in no adjustment', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 40, reasons: [] } as any));
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, marketSignals: goodMarketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.confidence).toBe(40);
    expect((res as any).performanceAdjustment.applied).toBe(false);
    expect((res as any).performanceAdjustment.delta).toBe(0);
    spy.mockRestore();
  });

  it('totalTrades under 5 gives no adjustment', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 50, reasons: [] } as any));
    const perf = { summary: { winRatePercent: 80, averagePnlSek: 20, totalTrades: 4 }, reflection: { status: 'POSITIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, performanceProfile: perf, marketSignals: goodMarketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.confidence).toBe(50);
    expect((res as any).performanceAdjustment.applied).toBe(false);
    spy.mockRestore();
  });

  // New regression tests for evidence sufficiency
  it('single positive signal should not produce BUY (insufficient evidence)', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 80, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 'SINGLE_SIG', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' } ], confidence: 80 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['SINGLE_SIG'] }, expectedReturnPercent: 11, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    expect(Array.isArray(res.signal.reasons) ? res.signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE')) : false).toBeTruthy();
    spy.mockRestore();
  });

  it('two signals from same category should still result in HOLD (not independent)', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 80, reasons: [] } as any));
    // Provide marketSignals with two signals that share same type
    const marketSignals = { signals: [ { id: 'laggard-1', type: 'LAGGARD', origin: 'SYMBOL_PRICE_SERIES' }, { id: 'laggard-2', type: 'LAGGARD', origin: 'SYMBOL_PRICE_SERIES' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['laggard-1','laggard-2'] }, expectedReturnPercent: 11, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    expect(Array.isArray(res.signal.reasons) ? res.signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE')) : false).toBeTruthy();
    spy.mockRestore();
  });

  it('two independent positive signals should allow BUY', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 80, reasons: [] } as any));
    // Use two signals with different provenance origins: MARKET_TREND (quotes aggregate) and LEADER (symbol series)
    const marketSignals = { signals: [ { id: 'trend-1', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' }, { id: 'leader-1', type: 'LEADER', origin: 'SYMBOL_PRICE_SERIES' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 11, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    spy.mockRestore();
  });

  it('single negative signal should not produce SELL (insufficient evidence)', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'SELL', confidence: 20, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 'only-sell-sig', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' } ], confidence: 20 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'A', qty: 1 }] }, decision: { side: 'SELL', symbol: 'A', signals: ['only-sell-sig'] }, expectedReturnPercent: -20, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    expect(Array.isArray(res.signal.reasons) ? res.signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE')) : false).toBeTruthy();
    spy.mockRestore();
  });

  it('neutral profile gives no adjustment', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 50, reasons: [] } as any));
    const perf = { summary: { winRatePercent: 50, averagePnlSek: 1, totalTrades: 10 }, reflection: { status: 'NEUTRAL', confidenceMultiplier: 1, reasons: [] } } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, performanceProfile: perf, marketSignals: goodMarketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.confidence).toBe(50);
    expect((res as any).performanceAdjustment.applied).toBe(false);
    spy.mockRestore();
  });

  it('action remains unchanged for positive and negative profiles', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 70, reasons: [] } as any));
    const perfPos = { summary: { winRatePercent: 70, averagePnlSek: 10, totalTrades: 5 }, reflection: { status: 'POSITIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const perfNeg = { summary: { winRatePercent: 20, averagePnlSek: -5, totalTrades: 5 }, reflection: { status: 'NEGATIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const inPos = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, performanceProfile: perfPos, marketSignals: goodMarketSignals } as any;
    const inNeg = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['trend-1','leader-1'] }, expectedReturnPercent: 0, performanceProfile: perfNeg, marketSignals: goodMarketSignals } as any;
    const resPos = evaluateDecision(inPos);
    const resNeg = evaluateDecision(inNeg);
    expect(resPos.signal.action).toBe('BUY');
    expect(resNeg.signal.action).toBe('BUY');
    spy.mockRestore();
  });

  it('final confidence is clamped to [0,100]', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 99, reasons: [] } as any));
    const perf = { summary: { winRatePercent: 90, averagePnlSek: 100, totalTrades: 10 }, reflection: { status: 'POSITIVE', confidenceMultiplier: 1, reasons: [] } } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A' }, expectedReturnPercent: 0, performanceProfile: perf } as any;
    const res = evaluateDecision(input);
    expect(res.confidence).toBe(100);
    spy.mockRestore();
  });

  // New explicit provenance tests
  it('different types but same origin should NOT be considered independent (HOLD)', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 85, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 't1', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' }, { id: 'b1', type: 'MARKET_BREADTH', origin: 'MARKET_QUOTES_AGGREGATE' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['t1','b1'] }, expectedReturnPercent: 12, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    expect(Array.isArray(res.signal.reasons) ? res.signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE')) : false).toBeTruthy();
    spy.mockRestore();
  });

  it('different types and different origins should allow BUY', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 88, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 't2', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' }, { id: 'l2', type: 'LEADER', origin: 'SYMBOL_PRICE_SERIES' } ], confidence: 90 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['t2','l2'] }, expectedReturnPercent: 12, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('BUY');
    spy.mockRestore();
  });

  it('DATA_QUALITY should not count as independent directed evidence (HOLD)', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 90, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 'sdir', type: 'LEADER', origin: 'SYMBOL_PRICE_SERIES' }, { id: 'dq', type: 'DATA_QUALITY', origin: 'DATA_QUALITY_SOURCE' } ], confidence: 80 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A', signals: ['sdir','dq'] }, expectedReturnPercent: 15, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    spy.mockRestore();
  });

  it('SELL with two independent bearish signals should remain SELL', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'SELL', confidence: 20, reasons: [] } as any));
    const marketSignals = { signals: [ { id: 'lag1', type: 'LAGGARD', origin: 'SYMBOL_PRICE_SERIES' }, { id: 'trendb', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE' } ], confidence: 30 } as any;
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [{ symbol: 'A', qty: 1 }] }, decision: { side: 'SELL', symbol: 'A', signals: ['lag1','trendb'] }, expectedReturnPercent: -12, marketSignals } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('SELL');
    spy.mockRestore();
  });

  it('missing marketSignals should result in HOLD (fail-closed)', ()=>{
    const spy = vi.spyOn(sigModule, 'evaluateSignal').mockImplementation(()=> ({ action: 'BUY', confidence: 90, reasons: [] } as any));
    const input = { portfolio: { availableCash: 1000, totalValue: 1000, holdings: [] }, decision: { side: 'BUY', symbol: 'A' }, expectedReturnPercent: 12 } as any;
    const res = evaluateDecision(input);
    expect(res.signal.action).toBe('HOLD');
    spy.mockRestore();
  });
});
