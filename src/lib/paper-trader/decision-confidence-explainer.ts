export type DecisionConfidenceExplainerInput = {
  decisionReason: any;
  marketRegime?: { regime?: string; confidence?: number } | null;
  marketContextAdvice?: { outlook?: string; confidence?: number } | null;
  historicalContext?: { historicalBias?: string; confidence?: number; sampleSize?: number } | null;
  adaptiveDecisionContext?: { confidenceBias?: number } | null;
};

export type DecisionConfidenceExplanation = {
  overallAssessment: 'HIGH_CONFIDENCE'|'MEDIUM_CONFIDENCE'|'LOW_CONFIDENCE'|'UNSURE';
  confidenceDrivers: string[]; // at least one
  confidenceRisks: string[]; // at least one
  explanation: string; // concise deterministic explanation
  explanationScore: number; // 0-100
};

function clamp(n:number){ return Math.max(0, Math.min(100, Math.round(n))); }

export function buildDecisionConfidenceExplanation(input: DecisionConfidenceExplainerInput): DecisionConfidenceExplanation{
  const dr = input.decisionReason || {} as any;
  const mr = input.marketRegime || (dr && dr.marketRegime) || null;
  const mca = input.marketContextAdvice || (dr && dr.marketContextAdvice) || null;
  const hc = input.historicalContext || (dr && dr.historicalContext) || null;
  const ac = input.adaptiveDecisionContext || {} as any;

  const drivers: string[] = [];
  const risks: string[] = [];

  // Base numeric sources
  const srcDecisionConf = typeof dr.confidence === 'number' ? dr.confidence : (typeof dr.confidence === 'string' ? Number(dr.confidence) : null);
  const srcRegimeConf = mr && typeof mr.confidence === 'number' ? mr.confidence : null;
  const srcAdviceConf = mca && typeof mca.confidence === 'number' ? mca.confidence : null;
  const srcHistConf = hc && typeof hc.confidence === 'number' ? hc.confidence : null;
  const bias = ac && typeof ac.confidenceBias === 'number' ? ac.confidenceBias : 0;

  // driver: explicit decision confidence
  if (typeof srcDecisionConf === 'number') drivers.push(`DecisionConfidence:${clamp(srcDecisionConf)}`); else drivers.push('DecisionConfidence:unknown');

  // driver: regime alignment with action
  try{
    const action = dr && dr.action ? String(dr.action).toUpperCase() : null;
    const outlook = mca && mca.outlook ? String(mca.outlook) : null;
    if (outlook){
      const aligns = (action === 'BUY' && outlook === 'FAVORABLE_LONG') || (action === 'SELL' && outlook === 'FAVORABLE_SHORT');
      if (aligns) drivers.push(`MarketAdviceAligned:${outlook}`); else risks.push(`MarketAdviceNotAligned:${outlook}`);
    }
  }catch(_){ }

  // driver: historical positive
  if (hc && hc.historicalBias){
    if (hc.historicalBias === 'HISTORICALLY_POSITIVE') drivers.push('Historical:positive');
    else if (hc.historicalBias === 'HISTORICALLY_NEGATIVE') risks.push('Historical:negative');
    else if (hc.historicalBias === 'MIXED') risks.push('Historical:mixed');
  }

  // risk: high volatility/regime
  if (mr && mr.regime === 'HIGH_VOLATILITY') risks.push('Regime:HIGH_VOLATILITY');
  if (mr && mr.regime === 'UNCERTAIN') risks.push('Regime:UNCERTAIN');

  // adaptive bias as driver/risk
  if (typeof bias === 'number' && bias !== 0){
    if (bias > 0) drivers.push(`AdaptiveConfidenceBias:+${bias}`); else risks.push(`AdaptiveConfidenceBias:${bias}`);
  }

  // ensure at least one driver and one risk
  if (!drivers.length) drivers.push('NoPositiveDrivers');
  if (!risks.length) risks.push('NoMajorRisks');

  // explanationScore: average of available numeric confidences plus bias
  const numericSources: number[] = [];
  if (typeof srcDecisionConf === 'number') numericSources.push(srcDecisionConf);
  if (typeof srcRegimeConf === 'number') numericSources.push(srcRegimeConf);
  if (typeof srcAdviceConf === 'number') numericSources.push(srcAdviceConf);
  if (typeof srcHistConf === 'number') numericSources.push(srcHistConf);
  let score = 50;
  if (numericSources.length) score = Math.round(numericSources.reduce((s,n)=> s + n, 0) / numericSources.length);
  score = score + Math.round(bias);
  // penalize small historical sample if historical context exists
  if (hc && typeof hc.sampleSize === 'number' && hc.sampleSize > 0 && hc.sampleSize < 3) score = score - 10;
  // penalize for high volatility
  if (mr && mr.regime === 'HIGH_VOLATILITY') score = score - 15;
  const finalScore = clamp(score);

  // overall assessment thresholds
  let overall: DecisionConfidenceExplanation['overallAssessment'] = 'UNSURE';
  if (finalScore >= 70) overall = 'HIGH_CONFIDENCE';
  else if (finalScore >= 40) overall = 'MEDIUM_CONFIDENCE';
  else overall = 'LOW_CONFIDENCE';

  const explanationParts: string[] = [];
  explanationParts.push(`Regime:${mr && mr.regime ? mr.regime : 'unknown'}`);
  if (mca && mca.outlook) explanationParts.push(`Advice:${mca.outlook}`);
  if (hc && hc.historicalBias) explanationParts.push(`History:${hc.historicalBias}`);
  if (typeof bias === 'number' && bias !== 0) explanationParts.push(`AdaptiveBias:${bias}`);
  explanationParts.push(`Score:${finalScore}`);

  const explanation = explanationParts.join(' | ');

  return { overallAssessment: overall, confidenceDrivers: drivers, confidenceRisks: risks, explanation, explanationScore: finalScore };
}

export default buildDecisionConfidenceExplanation;
