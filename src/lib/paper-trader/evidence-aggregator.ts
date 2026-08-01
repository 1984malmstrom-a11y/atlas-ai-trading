export type DecisionEvidenceInput = {
  decisionReason?: any;
  marketRegime?: { regime?: string; confidence?: number; } | null;
  marketContextAdvice?: { outlook?: string; confidence?: number } | null;
  historicalContext?: { historicalBias?: string; confidence?: number; sampleSize?: number } | null;
  adaptiveDecisionContext?: { confidenceBias?: number } | null;
  decisionConfidenceExplanation?: { overallAssessment?: string; explanationScore?: number } | null;
};

export type DecisionEvidence = {
  evidenceScore: number; // 0-100
  bullishEvidence: string[];
  bearishEvidence: string[];
  uncertaintyFactors: string[]; // at least one
  evidenceQuality: 'HIGH'|'MEDIUM'|'LOW';
  summary: string;
};

function clamp(n:number){ return Math.max(0, Math.min(100, Math.round(n))); }

export function buildDecisionEvidence(input: DecisionEvidenceInput): DecisionEvidence{
  const dr = input.decisionReason || {};
  const mr = input.marketRegime || (dr && dr.marketRegime) || null;
  const mca = input.marketContextAdvice || (dr && dr.marketContextAdvice) || null;
  const hc = input.historicalContext || (dr && dr.historicalContext) || null;
  const ac = input.adaptiveDecisionContext || {} as any;
  const expl = input.decisionConfidenceExplanation || (dr && dr.decisionConfidenceExplanation) || null;

  const bullish: string[] = [];
  const bearish: string[] = [];
  const uncertainty: string[] = [];

  const action = dr && dr.action ? String(dr.action).toUpperCase() : null;

  // Collect evidence signals
  if (mr && mr.regime){
    if (mr.regime === 'STRONG_UPTREND' || mr.regime === 'WEAK_UPTREND') bullish.push(`MarketRegime:${mr.regime}`);
    if (mr.regime === 'STRONG_DOWNTREND' || mr.regime === 'WEAK_DOWNTREND') bearish.push(`MarketRegime:${mr.regime}`);
    if (mr.regime === 'HIGH_VOLATILITY' || mr.regime === 'UNCERTAIN') uncertainty.push(`Regime:${mr.regime}`);
  }

  if (mca && mca.outlook){
    if (mca.outlook === 'FAVORABLE_LONG') bullish.push('MarketContext:FAVORABLE_LONG');
    else if (mca.outlook === 'FAVORABLE_SHORT') bearish.push('MarketContext:FAVORABLE_SHORT');
    else uncertainty.push(`MarketContext:${mca.outlook}`);
  }

  if (hc && hc.historicalBias){
    if (hc.historicalBias === 'HISTORICALLY_POSITIVE') bullish.push('History:positive');
    else if (hc.historicalBias === 'HISTORICALLY_NEGATIVE') bearish.push('History:negative');
    else if (hc.historicalBias === 'MIXED') uncertainty.push('History:mixed');
    else if (hc.historicalBias === 'INSUFFICIENT_HISTORY') uncertainty.push('History:insufficient');
  }

  if (expl && expl.explanationScore !== undefined){
    if (expl.explanationScore >= 70) bullish.push(`Explainer:strong(${expl.explanationScore})`);
    else if (expl.explanationScore <= 30) bearish.push(`Explainer:weak(${expl.explanationScore})`);
    else uncertainty.push(`Explainer:mid(${expl.explanationScore})`);
  }

  // Adaptive adjustments
  if (ac && typeof ac.confidenceBias === 'number'){
    if (ac.confidenceBias > 0) bullish.push(`AdaptiveBias:+${ac.confidenceBias}`);
    else if (ac.confidenceBias < 0) bearish.push(`AdaptiveBias:${ac.confidenceBias}`);
  }

  // If no directional evidence, mark as neutral evidence (ensure at least one of bullish/bearish exists)
  if (!bullish.length && !bearish.length){ bullish.push('Neutral:balanced'); }

  // Uncertainty fallback
  if (!uncertainty.length) uncertainty.push('None');

  // Compute numeric score from available numeric sources
  const nums: number[] = [];
  if (typeof dr.confidence === 'number') nums.push(dr.confidence);
  if (mr && typeof mr.confidence === 'number') nums.push(mr.confidence);
  if (mca && typeof mca.confidence === 'number') nums.push(mca.confidence);
  if (hc && typeof hc.confidence === 'number') nums.push(hc.confidence);
  if (expl && typeof expl.explanationScore === 'number') nums.push(expl.explanationScore);

  let baseScore = nums.length ? Math.round(nums.reduce((s,n)=> s + n, 0) / nums.length) : 50;
  // adjust for historical sample size and directional alignment
  const sampleSize = hc && typeof hc.sampleSize === 'number' ? hc.sampleSize : 0;
  if (hc && hc.historicalBias === 'INSUFFICIENT_HISTORY') baseScore -= 10;
  else if (sampleSize > 0 && sampleSize < 3) baseScore -= 8;
  else if (sampleSize >= 3){
    // determine directional alignment from collected evidence
    const bullishCount = bullish.length;
    const bearishCount = bearish.length;
    const direction = bearishCount > bullishCount ? 'BEARISH' : (bullishCount > bearishCount ? 'BULLISH' : 'NEUTRAL');
    if (hc.historicalBias === 'HISTORICALLY_POSITIVE'){
      if (direction === 'BULLISH') baseScore += 8; else baseScore -= 4;
    } else if (hc.historicalBias === 'HISTORICALLY_NEGATIVE'){
      if (direction === 'BEARISH') baseScore += 8; else baseScore -= 4;
    }
  }

  // penalize high volatility
  if (mr && mr.regime === 'HIGH_VOLATILITY') baseScore -= 15;

  // small boost if explainer strongly supports action
  if (expl && expl.explanationScore >= 80) baseScore += 5;

  // adaptive bias small adjustment
  if (ac && typeof ac.confidenceBias === 'number') baseScore += Math.round(ac.confidenceBias);

  const evidenceScore = clamp(baseScore);

  // determine evidence quality
  let quality: DecisionEvidence['evidenceQuality'] = 'MEDIUM';
  if (evidenceScore >= 70 && sampleSize >= 3) quality = 'HIGH';
  else if (evidenceScore < 40) quality = 'LOW';
  else quality = 'MEDIUM';

  const summaryParts: string[] = [];
  summaryParts.push(`Score:${evidenceScore}`);
  if (quality) summaryParts.push(`Quality:${quality}`);
  if (hc && hc.historicalBias) summaryParts.push(`History:${hc.historicalBias}`);
  if (mr && mr.regime) summaryParts.push(`Regime:${mr.regime}`);

  const summary = summaryParts.join(' | ');

  return { evidenceScore, bullishEvidence: bullish, bearishEvidence: bearish, uncertaintyFactors: uncertainty, evidenceQuality: quality, summary };
}

export default buildDecisionEvidence;
