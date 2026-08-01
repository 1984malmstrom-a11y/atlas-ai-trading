export type EvidenceConsistencyInput = {
  decisionEvidence?: {
    evidenceScore?: number;
    bullishEvidence?: string[];
    bearishEvidence?: string[];
    uncertaintyFactors?: string[];
    evidenceQuality?: 'HIGH'|'MEDIUM'|'LOW';
    summary?: string;
  } | null;
};

export type EvidenceConsistency = {
  consistency: 'STRONGLY_ALIGNED'|'MOSTLY_ALIGNED'|'MIXED'|'WEAK'|'INSUFFICIENT_EVIDENCE';
  consistencyScore: number; // 0-100
  alignedSignals: string[]; // at least one
  conflictingSignals: string[]; // at least one
  uncertaintySummary: string; // deterministic
};

function clamp(n:number){ return Math.max(0, Math.min(100, Math.round(n))); }

export function analyzeEvidenceConsistency(input: EvidenceConsistencyInput): EvidenceConsistency{
  const de = input && input.decisionEvidence ? input.decisionEvidence : null;
  if (!de) return { consistency: 'INSUFFICIENT_EVIDENCE', consistencyScore: 0, alignedSignals: ['None'], conflictingSignals: ['None'], uncertaintySummary: 'No decision evidence available' };

  const bullish = Array.isArray(de.bullishEvidence) ? de.bullishEvidence.filter(Boolean) : [];
  const bearish = Array.isArray(de.bearishEvidence) ? de.bearishEvidence.filter(Boolean) : [];
  const uncertainty = Array.isArray(de.uncertaintyFactors) ? de.uncertaintyFactors.filter(Boolean) : [];
  const quality = de.evidenceQuality || 'MEDIUM';
  const scoreBase = typeof de.evidenceScore === 'number' ? clamp(de.evidenceScore) : 50;

  const bullishCount = bullish.filter(s=> !s.startsWith('Neutral')).length;
  const bearishCount = bearish.filter(s=> !s.startsWith('Neutral')).length;
  const neutralCount = bullish.concat(bearish).filter(s=> String(s).startsWith('Neutral')).length;
  const uncertaintyCount = uncertainty.filter(u=> u !== 'None').length;

  const totalDirectional = bullishCount + bearishCount;
  if (totalDirectional === 0 && neutralCount === 0) return { consistency: 'INSUFFICIENT_EVIDENCE', consistencyScore: 0, alignedSignals: ['None'], conflictingSignals: ['None'], uncertaintySummary: `Quality:${quality} | Uncertainty:${uncertainty.join(',') || 'None'}` };

  // directional balance and quality adjustments
  const diff = bullishCount - bearishCount;
  const magnitude = Math.abs(diff) || (neutralCount > 0 ? 1 : 0);
  // magnitude increases score (stronger agreement -> higher consistency)
  let adj = magnitude * 10;
  if (quality === 'HIGH') adj += 10; else if (quality === 'LOW') adj -= 10;
  adj -= uncertaintyCount * 8;

  let consistencyScore = clamp(scoreBase + adj);

  // Determine consistency category
  let consistency: EvidenceConsistency['consistency'] = 'MIXED';
  if (Math.abs(diff) >= 3 && uncertaintyCount === 0 && consistencyScore >= 70) consistency = 'STRONGLY_ALIGNED';
  else if (Math.abs(diff) >= 1 && consistencyScore >= 50 && uncertaintyCount <= 1) consistency = 'MOSTLY_ALIGNED';
  else if (bullishCount > 0 && bearishCount > 0) consistency = 'MIXED';
  else if (consistencyScore < 40) consistency = 'WEAK';
  else consistency = 'MOSTLY_ALIGNED';

  // alignedSignals: top side
  let alignedSignals: string[] = [];
  let conflictingSignals: string[] = [];
  if (diff > 0){ alignedSignals = bullish.slice(0,5); conflictingSignals = bearish.slice(0,5); }
  else if (diff < 0){ alignedSignals = bearish.slice(0,5); conflictingSignals = bullish.slice(0,5); }
  else { alignedSignals = [bullish[0] || bearish[0] || 'None']; conflictingSignals = [bullish[1] || bearish[1] || 'None']; }

  if (!alignedSignals.length) alignedSignals = ['None'];
  if (!conflictingSignals.length) conflictingSignals = ['None'];

  const uncertaintySummary = `Quality:${quality} | UncertaintyCount:${uncertaintyCount} | Factors:${uncertainty.join(',') || 'None'}`;

  return { consistency, consistencyScore, alignedSignals, conflictingSignals, uncertaintySummary };
}

export default analyzeEvidenceConsistency;
