import type { EvalResult as ShadowEvalResult } from './shadow-decision-outcome-evaluator';

export type ShadowPerformanceSummary = {
  evaluatedCount: number;
  shadowBetterCount: number;
  actualBetterCount: number;
  equalCount: number;
  notEvaluableCount: number;
  shadowBetterRate: number; // 0-100
  actualBetterRate: number; // 0-100
  netShadowAdvantage: number; // shadowTotalScore - actualTotalScore
  actualTotalScore: number;
  shadowTotalScore: number;
  assessment: 'SHADOW_SIGNIFICANTLY_BETTER'|'SHADOW_SLIGHTLY_BETTER'|'EQUAL_PERFORMANCE'|'ACTUAL_SLIGHTLY_BETTER'|'ACTUAL_SIGNIFICANTLY_BETTER'|'INSUFFICIENT_DATA';
};

export function aggregateShadowDecisionPerformance({ evaluations }: { evaluations: any[] }): ShadowPerformanceSummary{
  // pure deterministic aggregation using stored shadowDecisionOutcome values
  let shadowBetterCount = 0;
  let actualBetterCount = 0;
  let equalCount = 0;
  let notEvaluableCount = 0;
  let actualTotalScore = 0;
  let shadowTotalScore = 0;

  for (const ev of Array.isArray(evaluations) ? evaluations : []){
    try{
      const so: ShadowEvalResult | undefined = ev && ev.shadowDecisionOutcome ? ev.shadowDecisionOutcome : (ev && ev.evaluation && ev.evaluation.shadowDecisionOutcome ? ev.evaluation.shadowDecisionOutcome : undefined);
      if (!so || !so.comparison){ notEvaluableCount++; continue; }
      const comp = String(so.comparison);
      if (comp === 'SHADOW_BETTER') shadowBetterCount++;
      else if (comp === 'ACTUAL_BETTER') actualBetterCount++;
      else if (comp === 'EQUAL') equalCount++;
      else if (comp === 'NOT_EVALUABLE') { notEvaluableCount++; continue; }

      // accumulate scores when evaluable (exclude NOT_EVALUABLE)
      const aScore = typeof so.actualScore === 'number' && Number.isFinite(so.actualScore) ? Number(so.actualScore) : 0;
      const sScore = typeof so.shadowScore === 'number' && Number.isFinite(so.shadowScore) ? Number(so.shadowScore) : 0;
      actualTotalScore += aScore;
      shadowTotalScore += sScore;
    }catch(_){ notEvaluableCount++; }
  }

  const evaluatedCount = shadowBetterCount + actualBetterCount + equalCount;
  const shadowBetterRate = evaluatedCount === 0 ? 0 : Math.round((shadowBetterCount / evaluatedCount) * 100);
  const actualBetterRate = evaluatedCount === 0 ? 0 : Math.round((actualBetterCount / evaluatedCount) * 100);
  const netShadowAdvantage = shadowTotalScore - actualTotalScore;

  let assessment: ShadowPerformanceSummary['assessment'] = 'INSUFFICIENT_DATA';
  if (evaluatedCount < 5){ assessment = 'INSUFFICIENT_DATA'; }
  else if (netShadowAdvantage >= 5 && shadowBetterRate >= 60){ assessment = 'SHADOW_SIGNIFICANTLY_BETTER'; }
  else if (netShadowAdvantage > 0){ assessment = 'SHADOW_SLIGHTLY_BETTER'; }
  else if (netShadowAdvantage <= -5 && actualBetterRate >= 60){ assessment = 'ACTUAL_SIGNIFICANTLY_BETTER'; }
  else if (netShadowAdvantage < 0){ assessment = 'ACTUAL_SLIGHTLY_BETTER'; }
  else { assessment = 'EQUAL_PERFORMANCE'; }

  return { evaluatedCount, shadowBetterCount, actualBetterCount, equalCount, notEvaluableCount, shadowBetterRate, actualBetterRate, netShadowAdvantage, actualTotalScore, shadowTotalScore, assessment } as ShadowPerformanceSummary;
}

export default aggregateShadowDecisionPerformance;
