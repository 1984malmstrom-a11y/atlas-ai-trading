import type { RiskReport, PerformanceReflection } from './types';
import type { RiskEngineInput } from './risk-engine';
import { evaluateRisk } from './risk-engine';
import { evaluateSignal, type SignalResult } from './signal-engine';

export type DecisionResult = {
  allowed: boolean;
  confidence: number; // 0-100
  risk: RiskReport;
  signal: SignalResult;
  performanceReflection?: PerformanceReflection;
  tradeFeedbackEffect?: 'NOT_APPLIED' | 'OBSERVED' | 'BUY_BLOCKED';
};

export type TradeFeedbackSummary = { winRate: number; avgPnlSek: number; evaluatedCount: number; lastVerdict?: string };

export type DecisionEngineInput = RiskEngineInput & { performanceReflection?: PerformanceReflection; tradeFeedbackSummary?: TradeFeedbackSummary };

export function evaluateDecision(input: DecisionEngineInput): DecisionResult {
  // Call Signal Engine first
  const signal = evaluateSignal({ expectedReturnPercent: input.expectedReturnPercent ?? 0 });

  // Respect trade feedback summary cautiously
  // Only use when we have at least 10 evaluated trades
  // Thresholds:
  // - evaluatedCountThreshold = 10
  // - winRateThreshold = 0.35
  // - marginalBuyConfidenceThreshold = 70 (signal confidence <= 70 considered marginal buy)
  // If historical winRate < 0.35 OR avgPnlSek < 0, then treat feedback as weak.
  // For weak feedback: do not block SELLs; for BUYs with marginal confidence (<=70), convert to HOLD and add rationale.
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

  if (signal.action === 'HOLD'){
    const holdRisk: RiskReport = { allowed: false, score: 0, level: 'HIGH', reasons: ['SIGNAL_HOLD'] };
    return { allowed: false, confidence: 0, risk: holdRisk, signal, tradeFeedbackEffect: feedbackEffect } as DecisionResult;
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
  const result: DecisionResult = { allowed: risk.allowed, confidence: adjustedConfidence, risk, signal, tradeFeedbackEffect: feedbackEffect } as any;
  if (input.performanceReflection) (result as any).performanceReflection = input.performanceReflection;
  return result;
}

export default {} as any;
