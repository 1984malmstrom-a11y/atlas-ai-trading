import type { RiskReport, PerformanceReflection, PerformanceProfile } from './types';
import type { RiskEngineInput } from './risk-engine';
import { evaluateRisk } from './risk-engine';
import { evaluateSignal, type SignalResult } from './signal-engine';
import type { MacroSignal } from './macro-signals';
import { SUPPORTED_MACRO_SIGNALS } from './macro-signals';
import type { TradeFeedback } from './trade-feedback';
import type { Signal as VictorSignal } from '../victor-signals';

export type MacroConfidenceSummary = {
  bullishStrength: number;
  bearishStrength: number;
  adjustment: number;
  signalCount: number;
};

export type DecisionResult = {
  allowed: boolean;
  confidence: number; // 0-100
  risk: RiskReport;
  signal: SignalResult;
  performanceReflection?: PerformanceReflection;
  tradeFeedbackEffect?: 'NOT_APPLIED' | 'OBSERVED' | 'BUY_BLOCKED';
  signalFeedbackEffect: 'NOT_APPLIED' | 'OBSERVED' | 'BUY_BLOCKED';
  macroSummary?: MacroConfidenceSummary;
};

type BySignalItem = NonNullable<TradeFeedback['bySignal']>[number];
export type TradeFeedbackSummary = { winRate: number; avgPnlSek: number; evaluatedCount: number; lastVerdict?: string; bySignal?: NonNullable<TradeFeedback['bySignal']> };

// Minimal typed wrapper for marketSignals used by DecisionEngine.
export type MarketSignals = {
  readonly generatedAt?: string;
  readonly confidence: number;
  readonly signals: readonly Pick<VictorSignal, 'id' | 'type' | 'origin'>[];
  readonly warnings?: readonly string[];
};

export type DecisionEngineInput = RiskEngineInput & { performanceReflection?: PerformanceReflection; tradeFeedbackSummary?: TradeFeedbackSummary; performanceProfile?: PerformanceProfile; marketSignals?: MarketSignals };

export function calculateMacroConfidenceAdjustment(signals: MacroSignal[] | undefined): MacroConfidenceSummary {
  if (!Array.isArray(signals) || signals.length === 0) return { adjustment: 0, bullishStrength: 0, bearishStrength: 0, signalCount: 0 };
  // Filter to supported macro types
  const macroSignals = signals.filter(s => s && typeof s.type === 'string' && (SUPPORTED_MACRO_SIGNALS as readonly string[]).includes(String(s.type)));
  if (macroSignals.length === 0) return { adjustment: 0, bullishStrength: 0, bearishStrength: 0, signalCount: 0 };
  let bullishStrength = 0;
  let bearishStrength = 0;
  for (const s of macroSignals){
    const dir = (s as any).direction as string | undefined;
    const strength = typeof (s as any).strength === 'number' && isFinite((s as any).strength) ? (s as any).strength as number : 0;
    if (dir === 'BULLISH') bullishStrength += strength;
    else if (dir === 'BEARISH') bearishStrength += strength;
  }
  if (bullishStrength === 0 && bearishStrength === 0) return { adjustment: 0, bullishStrength, bearishStrength, signalCount: macroSignals.length };
  const raw = (bullishStrength - bearishStrength) * 0.05;
  const clamped = Math.max(-0.10, Math.min(0.10, raw));
  return { adjustment: clamped, bullishStrength, bearishStrength, signalCount: macroSignals.length };
}

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

  // Evidence sufficiency / fail-closed rule:
  // - If DecisionEngine would otherwise produce BUY/SELL, require `marketSignals` to be present
  //   and non-empty. If missing or empty -> convert to HOLD with INSUFFICIENT_EVIDENCE.
  // - If `marketSignals.signals` exist, require at least two distinct `type` categories.
    try {
      const decisionSignals = input.decision && Array.isArray((input.decision as any).signals) ? (input.decision as any).signals as string[] : undefined;
      const marketSignalsArr = input.marketSignals && Array.isArray(input.marketSignals.signals) ? input.marketSignals.signals as Array<{ id: string; type: string; origin?: string }> : undefined;

      if (signal.action === 'BUY' || signal.action === 'SELL'){
        // Fail-closed when marketSignals missing or empty
        if (!marketSignalsArr || marketSignalsArr.length === 0){
          const reason = 'INSUFFICIENT_EVIDENCE: verifierbara marketSignals saknas eller tomma';
          if (!signal.reasons || !signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE'))){
            signal.reasons = Array.isArray(signal.reasons) ? signal.reasons.concat([reason]) : [reason];
          }
          signal.action = 'HOLD';
        } else {
          // Map ids to types and origins
          const idToType = new Map<string,string>();
          const idToOrigin = new Map<string,string|undefined>();
          for (const s of marketSignalsArr){ if (s && s.id && s.type){ idToType.set(String(s.id), String(s.type)); idToOrigin.set(String(s.id), (s as any).origin); } }

              // Require explicit supporting ids from runtime (strict fail-closed)
              let supportingIds: string[] = [];
              if (!Array.isArray(decisionSignals) || decisionSignals.length === 0){
                const reason = 'INSUFFICIENT_EVIDENCE: decision.signals missing';
                if (!signal.reasons || !signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE'))){
                  signal.reasons = Array.isArray(signal.reasons) ? signal.reasons.concat([reason]) : [reason];
                }
                signal.action = 'HOLD';
              } else {
                const marketIds = new Set(marketSignalsArr.map(s=> String(s.id)));
                // If any referenced id is not present in current marketSignals -> fail-closed
                const missing = (decisionSignals || []).filter(d => !marketIds.has(d));
                if (missing.length > 0){
                  const reason = 'INSUFFICIENT_EVIDENCE: referenced supporting id missing in marketSignals';
                  if (!signal.reasons || !signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE'))){
                    signal.reasons = Array.isArray(signal.reasons) ? signal.reasons.concat([reason]) : [reason];
                  }
                  signal.action = 'HOLD';
                }
                supportingIds = Array.isArray(decisionSignals) ? decisionSignals.slice() as string[] : [];
              }
              // ensure supportingIds always defined for downstream use
              if (!Array.isArray(supportingIds)) supportingIds = [];

          // Build supporting signal objects filtered out DATA_QUALITY (not a directed evidence)
          const supportingSignals = supportingIds.map(id => marketSignalsArr.find(s => String(s.id) === id)).filter(Boolean) as Array<{ id: string; type: string; origin?: string }>;

          // If any supporting signal lacks a provenance origin, fail-closed
          if (supportingSignals.some(s => !s.origin)){
            const reason = 'INSUFFICIENT_EVIDENCE: missing signal provenance (origin)';
            if (!signal.reasons || !signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE'))){
              signal.reasons = Array.isArray(signal.reasons) ? signal.reasons.concat([reason]) : [reason];
            }
            signal.action = 'HOLD';
          } else {
            // compute distinct types and distinct origins among directional signals (exclude DATA_QUALITY)
            const types = new Set<string>();
            const origins = new Set<string>();
            for (const s of supportingSignals){
              const t = idToType.get(s.id);
              const o = idToOrigin.get(s.id);
              if (t === 'DATA_QUALITY') continue; // never count as directed evidence
              if (t) types.add(t);
              if (o) origins.add(o);
            }

            // require at least two distinct types (existing rule)
            if (types.size < 2){
              const reason = 'INSUFFICIENT_EVIDENCE: need >=2 independent signals by type';
              if (!signal.reasons || !signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE'))){
                signal.reasons = Array.isArray(signal.reasons) ? signal.reasons.concat([reason]) : [reason];
              }
              signal.action = 'HOLD';
            } else if (origins.size < 2){
              // Even if types differ, require distinct provenance origins to count as independent
              const reason = 'INSUFFICIENT_EVIDENCE: signals share same provenance origin';
              if (!signal.reasons || !signal.reasons.some(r=> String(r).includes('INSUFFICIENT_EVIDENCE'))){
                signal.reasons = Array.isArray(signal.reasons) ? signal.reasons.concat([reason]) : [reason];
              }
              signal.action = 'HOLD';
            }
          }
        }
      }
    } catch (_){ /* preserve original behavior on unexpected errors */ }

  // Compute adjusted confidence using optional performanceReflection multiplier
  let adjustedConfidence = signal.confidence || 0;
  const multiplier = input.performanceReflection && typeof input.performanceReflection.confidenceMultiplier === 'number' ? input.performanceReflection.confidenceMultiplier : 1;
  adjustedConfidence = adjustedConfidence * multiplier;
  if (!Number.isFinite(adjustedConfidence)) adjustedConfidence = 0;
  adjustedConfidence = Math.max(0, Math.min(100, Math.round(adjustedConfidence)));

  // Use top-level helper to calculate macro adjustment

  // PerformanceProfile adjustment (strictly typed and conservative)
  const performanceAdjustment = { applied: false, delta: 0, reason: '' } as { applied: boolean; delta: number; reason: string };
  try {
    const perf = input.performanceProfile;
    if (perf && perf.summary && typeof perf.summary === 'object'){
      const winRatePercent = typeof perf.summary.winRatePercent === 'number' ? perf.summary.winRatePercent : undefined;
      const averagePnlSek = typeof perf.summary.averagePnlSek === 'number' ? perf.summary.averagePnlSek : undefined;
      const totalTrades = typeof perf.summary.totalTrades === 'number' ? perf.summary.totalTrades : undefined;

      // Apply weighted adjustment based on sample size only when we have at least 5 trades
      if (typeof totalTrades === 'number' && totalTrades >= 5 && typeof winRatePercent === 'number' && typeof averagePnlSek === 'number'){
        let delta = 0;
        if (winRatePercent >= 60 && averagePnlSek > 0) delta = 3;
        else if (winRatePercent < 35 || averagePnlSek < 0) delta = -3;
        // determine weight by sample size: 5-9 -> 50%, 10-19 -> 75%, 20+ -> 100%
        let weight = 1;
        if (totalTrades >= 20) weight = 1;
        else if (totalTrades >= 10) weight = 0.75;
        else weight = 0.5; // 5-9

        // compute applied (rounded) delta based on weight
        // use symmetric rounding so positive and negative deltas round consistently
        let appliedDelta = Math.sign(delta) * Math.round(Math.abs(delta) * weight);
        // clamp appliedDelta conservatively
        appliedDelta = Math.max(-5, Math.min(5, appliedDelta));

        if (appliedDelta !== 0){
          adjustedConfidence = Math.max(0, Math.min(100, adjustedConfidence + appliedDelta));
          performanceAdjustment.applied = true;
          performanceAdjustment.delta = appliedDelta;
          performanceAdjustment.reason = `winRatePercent=${winRatePercent}, averagePnlSek=${averagePnlSek}, totalTrades=${totalTrades}, appliedWeight=${weight}`;
        } else {
          performanceAdjustment.reason = `no meaningful performance delta (winRatePercent=${winRatePercent}, averagePnlSek=${averagePnlSek}, totalTrades=${totalTrades}, appliedWeight=${weight})`;
        }
      } else if (typeof totalTrades === 'number' && totalTrades < 5){
        performanceAdjustment.reason = `insufficient sample size (totalTrades=${totalTrades})`;
      } else {
        performanceAdjustment.reason = `missing performance summary fields`;
      }
    }
  } catch (_){ /* do not impact decision on errors */ }

  // Apply macro signals adjustment to confidence (max ±10 percentage points)
  let macroSummary: MacroConfidenceSummary | undefined = undefined;
  try {
    const marketSignalsRaw = input.marketSignals && Array.isArray((input.marketSignals as any).signals) ? (input.marketSignals as any).signals as MacroSignal[] : undefined;
    const macroResult = calculateMacroConfidenceAdjustment(marketSignalsRaw);
    if (macroResult && macroResult.signalCount > 0){
      macroSummary = { bullishStrength: macroResult.bullishStrength, bearishStrength: macroResult.bearishStrength, adjustment: macroResult.adjustment, signalCount: macroResult.signalCount };
    } else {
      macroSummary = undefined;
    }
    if (macroResult && typeof macroResult.adjustment === 'number' && macroResult.adjustment !== 0){
      const deltaPoints = Math.round(macroResult.adjustment * 100);
      adjustedConfidence = Math.max(0, Math.min(100, adjustedConfidence + deltaPoints));
    }
  } catch (_){ /* ignore macro adjustment errors */ }

  // Build risk input but omit performanceReflection so Risk Engine remains unaware
  const { performanceReflection, ...riskBase } = input as any;
  const riskInput = { ...riskBase, expectedReturnPercent: input.expectedReturnPercent ?? 0, confidence: adjustedConfidence } as any;
  const risk = evaluateRisk(riskInput);

  // Decision confidence is the adjustedConfidence (independent from risk.score)
  const result: DecisionResult = { allowed: risk.allowed, confidence: adjustedConfidence, risk, signal, tradeFeedbackEffect: feedbackEffect, signalFeedbackEffect } as any;
  // attach any performanceReflection (existing) and new explainability for performance adjustment
  if (input.performanceReflection) (result as any).performanceReflection = input.performanceReflection;
  (result as any).performanceAdjustment = performanceAdjustment;
  // attach macroSummary diagnostics when present (typed)
  if (typeof macroSummary !== 'undefined' && macroSummary !== null){ result.macroSummary = macroSummary; }
  return result;
}

export default {} as any;
