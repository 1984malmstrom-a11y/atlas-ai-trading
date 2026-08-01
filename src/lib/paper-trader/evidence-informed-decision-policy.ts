export type EvidenceInformedInput = {
  currentAction?: 'BUY'|'SELL'|'HOLD'|string | null;
  currentConfidence?: number | null;
  decisionEvidence?: { evidenceScore?: number; bullishEvidence?: string[]; bearishEvidence?: string[]; uncertaintyFactors?: string[]; evidenceQuality?: string } | null;
  evidenceConsistency?: { consistency?: string; consistencyScore?: number; alignedSignals?: string[]; conflictingSignals?: string[]; uncertaintySummary?: string } | null;
};

export type EvidenceInformedDecision = {
  recommendedAction: 'BUY'|'SELL'|'HOLD';
  recommendedConfidence: number; // 0-100
  agreesWithCurrentDecision: boolean;
  rationale: string[]; // at least one
  blockingFactors: string[]; // at least one
};

function clamp(n:number){ return Math.max(0, Math.min(100, Math.round(n))); }

export function buildEvidenceInformedDecision(input: EvidenceInformedInput): EvidenceInformedDecision{
  const act = (input.currentAction || 'HOLD') as string;
  const conf = (typeof input.currentConfidence === 'number' && Number.isFinite(input.currentConfidence)) ? input.currentConfidence : 0;
  const de = input.decisionEvidence || {} as any;
  const ec = input.evidenceConsistency || {} as any;

  const bullish = Array.isArray(de.bullishEvidence) ? de.bullishEvidence.filter(Boolean).filter((s:any)=> !String(s).startsWith('Neutral')) : [];
  const bearish = Array.isArray(de.bearishEvidence) ? de.bearishEvidence.filter(Boolean).filter((s:any)=> !String(s).startsWith('Neutral')) : [];
  const uncertainty = Array.isArray(de.uncertaintyFactors) ? de.uncertaintyFactors.filter(Boolean) : [];
  const evidenceQuality = de.evidenceQuality || 'MEDIUM';

  let direction: 'BULLISH'|'BEARISH'|'MIXED'|'NONE' = 'NONE';
  if (bullish.length && !bearish.length) direction = 'BULLISH';
  else if (bearish.length && !bullish.length) direction = 'BEARISH';
  else if (bullish.length && bearish.length) direction = 'MIXED';

  const cons = String(ec.consistency || 'INSUFFICIENT_EVIDENCE');

  const rationale: string[] = [];
  const blockers: string[] = [];

  // Determine recommendedAction conservatively
  let recommendedAction: EvidenceInformedDecision['recommendedAction'] = 'HOLD';

  // Blocking conditions for taking directional action
  const highUncertainty = uncertainty.length && !(uncertainty.length === 1 && uncertainty[0] === 'None');
  const lowQuality = evidenceQuality === 'LOW';

  if (direction === 'BULLISH' && (cons === 'STRONGLY_ALIGNED' || cons === 'MOSTLY_ALIGNED') && !highUncertainty && !lowQuality){
    recommendedAction = 'BUY';
    rationale.push('Evidence indicates bullish direction and consistency supports action');
  } else if (direction === 'BEARISH' && (cons === 'STRONGLY_ALIGNED' || cons === 'MOSTLY_ALIGNED') && !highUncertainty && !lowQuality){
    recommendedAction = 'SELL';
    rationale.push('Evidence indicates bearish direction and consistency supports action');
  } else {
    recommendedAction = 'HOLD';
    rationale.push('Evidence does not strongly support a directional trade; default to HOLD');
  }

  // Additional rationale items
  rationale.push(`Direction:${direction}`);
  rationale.push(`Consistency:${cons}`);
  if (typeof de.evidenceScore === 'number') rationale.push(`EvidenceScore:${clamp(de.evidenceScore as number)}`);

  // blocking factors
  if (highUncertainty) blockers.push('High uncertainty present');
  if (lowQuality) blockers.push('Evidence quality LOW');
  if (direction === 'MIXED') blockers.push('Conflicting directional signals');
  if (cons === 'INSUFFICIENT_EVIDENCE') blockers.push('Insufficient evidence');
  if (!blockers.length) blockers.push('None');

  // recommendedConfidence
  let recommendedConfidence = clamp(conf);
  if (recommendedAction === act){
    // boost when aligned and strong
    if (cons === 'STRONGLY_ALIGNED') recommendedConfidence = clamp(recommendedConfidence + 5);
    else if (cons === 'MOSTLY_ALIGNED') recommendedConfidence = clamp(recommendedConfidence + 2);
  } else {
    // when disagreeing, set to average of current confidence and evidenceScore if available
    if (typeof de.evidenceScore === 'number') recommendedConfidence = clamp(Math.round((recommendedConfidence + clamp(de.evidenceScore)) / 2));
    else recommendedConfidence = clamp(Math.max(0, recommendedConfidence - 10));
  }

  const agrees = recommendedAction === act;

  // Ensure at least one rationale and blocking factor
  if (!rationale.length) rationale.push('No rationale available');
  if (!blockers.length) blockers.push('None');

  return { recommendedAction, recommendedConfidence, agreesWithCurrentDecision: agrees, rationale, blockingFactors: blockers };
}

export default buildEvidenceInformedDecision;

export type EvidenceExecutionBlock = {
  blocked: boolean;
  code?: 'BLOCKED_BY_CONTRADICTORY_EVIDENCE';
  reason?: string;
  conflictSignals?: string[];
  evidenceScore?: number;
  evidenceQuality?: string;
  consistencyScore?: number;
};

// Determine whether evidence should block execution. Conservative: only block
// when there is concrete conflicting evidence AND quality threshold is met.
export function evaluateEvidenceExecutionGate(decision: any): EvidenceExecutionBlock{
  try{
    if (!decision || (decision.action !== 'BUY' && decision.action !== 'SELL')) return { blocked: false };
    const evInf = decision.evidenceInformedDecision as any || null;
    if (!evInf) return { blocked: false };
    if (evInf.agreesWithCurrentDecision) return { blocked: false };

    const de = decision.decisionEvidence as any || {};
    const ec = decision.evidenceConsistency as any || {};

    const conflictSignals: string[] = [];

    // 1) explicit conflicting signals reported by consistency analysis
    if (Array.isArray(ec.conflictingSignals)){
      const cs = ec.conflictingSignals
        .filter(Boolean)
        .map((s:any)=> String(s).trim())
        .filter((s:any)=> s.length > 0)
        .filter((s:any)=> {
          const u = String(s).toUpperCase();
          if (u === 'NONE' || u === 'INSUFFICIENT_EVIDENCE') return false;
          if (u.startsWith('NEUTRAL')) return false;
          return true;
        });
      if (cs.length) conflictSignals.push(...cs);
    }

    // 2) mixed directional evidence: both non-neutral bullish and bearish present
    const bullish = Array.isArray(de.bullishEvidence) ? de.bullishEvidence.filter(Boolean).filter((s:any)=> !String(s).startsWith('Neutral')) : [];
    const bearish = Array.isArray(de.bearishEvidence) ? de.bearishEvidence.filter(Boolean).filter((s:any)=> !String(s).startsWith('Neutral')) : [];
    if (bullish.length && bearish.length) conflictSignals.push('BULLISH_AND_BEARISH_PRESENT');

    // 3) historical strong contradiction (requires sample size)
    if (decision.historicalContext && typeof decision.historicalContext.sampleSize === 'number' && decision.historicalContext.sampleSize >= 3){
      const hb = String(decision.historicalContext.historicalBias || '').toUpperCase();
      if (hb === 'HISTORICALLY_POSITIVE' && decision.action === 'SELL') conflictSignals.push('HISTORICAL_POSITIVE_CONFLICT');
      if (hb === 'HISTORICALLY_NEGATIVE' && decision.action === 'BUY') conflictSignals.push('HISTORICAL_NEGATIVE_CONFLICT');
    }

    if (!conflictSignals.length) return { blocked: false };

    const evidenceScore = typeof de.evidenceScore === 'number' ? Number(de.evidenceScore) : undefined;
    const evidenceQuality = typeof de.evidenceQuality === 'string' ? de.evidenceQuality : undefined;
    const consistencyScore = typeof ec.consistencyScore === 'number' ? Number(ec.consistencyScore) : undefined;

    // Quality threshold: at least one of these must hold to block
    const qualitySatisfied = (evidenceQuality === 'HIGH') || (typeof evidenceScore === 'number' && evidenceScore >= 70) || (typeof consistencyScore === 'number' && consistencyScore >= 60);
    if (!qualitySatisfied){
      return { blocked: false, reason: 'Conflict present but quality threshold not met', conflictSignals, evidenceScore, evidenceQuality, consistencyScore };
    }

    return { blocked: true, code: 'BLOCKED_BY_CONTRADICTORY_EVIDENCE', reason: 'High-quality contradictory evidence', conflictSignals, evidenceScore, evidenceQuality, consistencyScore };
  }catch(_){
    return { blocked: false };
  }
}
