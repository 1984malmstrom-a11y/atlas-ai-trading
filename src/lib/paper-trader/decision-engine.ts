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
};

export type DecisionEngineInput = RiskEngineInput & { performanceReflection?: PerformanceReflection };

export function evaluateDecision(input: DecisionEngineInput): DecisionResult {
  // Call Signal Engine first
  const signal = evaluateSignal({ expectedReturnPercent: input.expectedReturnPercent ?? 0 });

  if (signal.action === 'HOLD'){
    const holdRisk: RiskReport = { allowed: false, score: 0, level: 'HIGH', reasons: ['SIGNAL_HOLD'] };
    return { allowed: false, confidence: 0, risk: holdRisk, signal };
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
  const result: DecisionResult = { allowed: risk.allowed, confidence: adjustedConfidence, risk, signal } as any;
  if (input.performanceReflection) (result as any).performanceReflection = input.performanceReflection;
  return result;
}

export default {} as any;
