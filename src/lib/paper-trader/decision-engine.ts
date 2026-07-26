import type { RiskReport, PerformanceReflection } from './types';
import type { RiskEngineInput } from './risk-engine';
import { evaluateRisk } from './risk-engine';
import { evaluateSignal, type SignalResult } from './signal-engine';
import type { TradeFeedback } from './trade-feedback';

export type DecisionResult = {
  allowed: boolean;
  confidence: number; // 0-100
  risk: RiskReport;
  signal: SignalResult;
  performanceReflection?: PerformanceReflection;
  tradeFeedbackEffect?: 'NOT_APPLIED' | 'OBSERVED' | 'BUY_BLOCKED';
  signalFeedbackEffect: 'NOT_APPLIED' | 'OBSERVED' | 'BUY_BLOCKED';
};

type BySignalItem = NonNullable<TradeFeedback['bySignal']>[number];
export type TradeFeedbackSummary = { winRate: number; avgPnlSek: number; evaluatedCount: number; lastVerdict?: string; bySignal?: NonNullable<TradeFeedback['bySignal']> };

export type DecisionEngineInput = RiskEngineInput & { performanceReflection?: PerformanceReflection; tradeFeedbackSummary?: TradeFeedbackSummary };

export function evaluateDecision(input: DecisionEngineInput): DecisionResult {
  // Call Signal Engine first
  const signal = evaluateSignal({ expectedReturnPercent: input.expectedReturnPercent ?? 0 });

  // Respect trade feedback summary cautiously (existing global logic)
  const fb = input.tradeFeedbackSummary;
  let feedbackEffect: DecisionResult['tradeFeedbackEffect'] = 'NOT_APPLIED';
  if (fb && typeof fb.evaluatedCount === 'number' && fb.evaluatedCount >= 10){
    const weak = (typeof fb.winRate === 'number' && fb.winRate < 0.35) || (typeof fb.avgPnlSek === 'number' && fb.avgPnlSek < 0);
    if (weak){
      const MARGINAL_BUY_CONF = 70;
      if (signal.action === 'BUY' && typeof signal.confidence === 'number' && signal.confidence <= MARGINAL_BUY_CONF){
        // convert marginal BUY to HOLD and annotate rationale
        signal.action = 'HOLD';
        signal.reasons = Array.isArray(signal.reasons) ? signal.reasons.concat([`FEEDBACK_CAUTION: historical trade feedback lowered buy appetite`]) : [`FEEDBACK_CAUTION: historical trade feedback lowered buy appetite`];
        feedbackEffect = 'BUY_BLOCKED';
      } else {
        feedbackEffect = 'OBSERVED';
      }
    } else {
      feedbackEffect = 'OBSERVED';
    }
  } else {
    feedbackEffect = 'NOT_APPLIED';
  }

  // Per-signal feedback evaluation (new)
  let signalFeedbackEffect: DecisionResult['signalFeedbackEffect'] = 'NOT_APPLIED';
  try{
    const decisionSignals = (input as any).decision && Array.isArray((input as any).decision.signals) ? (input as any).decision.signals as string[] : undefined;
    const bySignal = fb && Array.isArray((fb as any).bySignal) ? (fb as any).bySignal as BySignalItem[] : undefined;
    if (decisionSignals && decisionSignals.length > 0 && Array.isArray(bySignal)){
      const matched = decisionSignals.map(s=> bySignal.find(b=> b && b.signalId === s)).filter(Boolean) as BySignalItem[];
      const evaluable = matched.filter(m=> typeof m.evaluatedCount === 'number' && m.evaluatedCount >= 5);
      if (evaluable.length === 0){
        signalFeedbackEffect = 'NOT_APPLIED';
      } else {
        const hasStrong = evaluable.some(m=> typeof m.winRate === 'number' && m.winRate >= 0.55 && typeof m.avgPnlSek === 'number' && m.avgPnlSek > 0);
        const hasWeak = evaluable.some(m=> (typeof m.winRate === 'number' && m.winRate < 0.35) || (typeof m.avgPnlSek === 'number' && m.avgPnlSek < 0));
        if (hasWeak && !hasStrong && signal.action === 'BUY' && typeof signal.confidence === 'number'){
          const MARGINAL_BUY_CONF = 70;
          if (signal.confidence <= MARGINAL_BUY_CONF){
            signal.action = 'HOLD';
            signal.reasons = Array.isArray(signal.reasons) ? signal.reasons.concat(['SIGNAL_FEEDBACK_CAUTION']) : ['SIGNAL_FEEDBACK_CAUTION'];
            signalFeedbackEffect = 'BUY_BLOCKED';
          } else {
            signalFeedbackEffect = 'OBSERVED';
          }
        } else {
          signalFeedbackEffect = 'OBSERVED';
        }
      }
    } else {
      signalFeedbackEffect = 'NOT_APPLIED';
    }
  }catch(_){ signalFeedbackEffect = 'NOT_APPLIED'; }

  if (signal.action === 'HOLD'){
    const holdRisk: RiskReport = { allowed: false, score: 0, level: 'HIGH', reasons: ['SIGNAL_HOLD'] };
    return { allowed: false, confidence: 0, risk: holdRisk, signal, tradeFeedbackEffect: feedbackEffect, signalFeedbackEffect } as DecisionResult;
  }

  // Compute adjusted confidence using optional performanceReflection multiplier
  let adjustedConfidence = signal.confidence || 0;
  const multiplier = input.performanceReflection && typeof input.performanceReflection.confidenceMultiplier === 'number' ? input.performanceReflection.confidenceMultiplier : 1;
  adjustedConfidence = adjustedConfidence * multiplier;
  if (!Number.isFinite(adjustedConfidence)) adjustedConfidence = 0;
  adjustedConfidence = Math.max(0, Math.min(100, Math.round(adjustedConfidence)));

  // Build risk input but omit performanceReflection so Risk Engine remains unaware
  const { performanceReflection, ...riskBase } = input as any;
  const riskInput = { ...riskBase, expectedReturnPercent: input.expectedReturnPercent ?? 0, confidence: adjustedConfidence } as any;
  const risk = evaluateRisk(riskInput);

  // Decision confidence is the adjustedConfidence (independent from risk.score)
  const result: DecisionResult = { allowed: risk.allowed, confidence: adjustedConfidence, risk, signal, tradeFeedbackEffect: feedbackEffect, signalFeedbackEffect } as any;
  if (input.performanceReflection) (result as any).performanceReflection = input.performanceReflection;
  return result;
}

export default {} as any;
