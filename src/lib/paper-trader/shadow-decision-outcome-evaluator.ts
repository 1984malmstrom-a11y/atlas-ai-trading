export type TradeAction = 'BUY' | 'SELL' | 'HOLD' | string;

export type OutcomeValue = 'CORRECT' | 'INCORRECT' | 'NEUTRAL' | 'NOT_EVALUABLE';
export type ComparisonValue = 'SHADOW_BETTER' | 'ACTUAL_BETTER' | 'EQUAL' | 'NOT_EVALUABLE';

export type EvalInput = {
  actualAction: TradeAction;
  shadowAction: TradeAction;
  referencePrice: number | null | undefined;
  evaluationPrice: number | null | undefined;
  neutralThresholdPercent?: number | null | undefined; // 0-10 clamp
};

export type EvalResult = {
  returnPercent: number | null; // computed or null when not evaluable
  actualOutcome: OutcomeValue;
  shadowOutcome: OutcomeValue;
  comparison: ComparisonValue;
  actualScore: number; // -1,0,1
  shadowScore: number; // -1,0,1
  explanation: string; // concise deterministic explanation
};

function clampThreshold(v: number): number{
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, v));
}

function normalizeAction(a: TradeAction): string{
  try{ return String(a || '').toUpperCase(); }catch(_){ return ''; }
}

function scoreFromOutcome(o: OutcomeValue): number{
  if (o === 'CORRECT') return 1;
  if (o === 'INCORRECT') return -1;
  return 0; // NEUTRAL or NOT_EVALUABLE
}

export function evaluateShadowDecisionOutcome(input: EvalInput): EvalResult{
  const ref = typeof input.referencePrice === 'number' && Number.isFinite(input.referencePrice) ? input.referencePrice : null;
  const evalP = typeof input.evaluationPrice === 'number' && Number.isFinite(input.evaluationPrice) ? input.evaluationPrice : null;
  const thr = clampThreshold(typeof input.neutralThresholdPercent === 'number' ? input.neutralThresholdPercent : (input.neutralThresholdPercent ? Number(input.neutralThresholdPercent) : 0));

  if (!ref || !evalP || ref <= 0 || evalP <= 0){
    const expl = 'Invalid prices: not evaluable';
    return { returnPercent: null, actualOutcome: 'NOT_EVALUABLE', shadowOutcome: 'NOT_EVALUABLE', comparison: 'NOT_EVALUABLE', actualScore: 0, shadowScore: 0, explanation: expl };
  }

  const returnPercent = ((evalP - ref) / ref) * 100;

  const aAct = normalizeAction(input.actualAction);
  const sAct = normalizeAction(input.shadowAction);

  function outcomeFor(action: string): OutcomeValue{
    if (!action) return 'NOT_EVALUABLE';
    if (action === 'BUY'){
      if (returnPercent > thr) return 'CORRECT';
      if (returnPercent < -thr) return 'INCORRECT';
      return 'NEUTRAL';
    }
    if (action === 'SELL'){
      if (returnPercent < -thr) return 'CORRECT';
      if (returnPercent > thr) return 'INCORRECT';
      return 'NEUTRAL';
    }
    if (action === 'HOLD'){
      if (Math.abs(returnPercent) <= thr) return 'CORRECT';
      return 'INCORRECT';
    }
    return 'NOT_EVALUABLE';
  }

  const actualOutcome = outcomeFor(aAct);
  const shadowOutcome = outcomeFor(sAct);
  const actualScore = scoreFromOutcome(actualOutcome);
  const shadowScore = scoreFromOutcome(shadowOutcome);

  let comparison: ComparisonValue = 'EQUAL';
  if (actualOutcome === 'NOT_EVALUABLE' || shadowOutcome === 'NOT_EVALUABLE') comparison = 'NOT_EVALUABLE';
  else if (shadowScore > actualScore) comparison = 'SHADOW_BETTER';
  else if (actualScore > shadowScore) comparison = 'ACTUAL_BETTER';
  else comparison = 'EQUAL';

  const explanation = `return=${Number(returnPercent.toFixed(4))} thr=${thr} actual=${actualOutcome} shadow=${shadowOutcome} comp=${comparison}`;

  return { returnPercent: Number(Number(returnPercent.toFixed(8))), actualOutcome, shadowOutcome, comparison, actualScore, shadowScore, explanation };
}

export default evaluateShadowDecisionOutcome;
