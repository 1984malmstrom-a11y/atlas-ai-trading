export type CompletedEval = {
  symbol?: string;
  marketRegime?: { regime?: string } | null;
  marketContextAdvice?: { outlook?: string } | null;
  returnPercent?: number | null; // positive = profitable
  outcome?: 'PROFIT'|'LOSS'|'BREAKEVEN'|string | null;
};

export type HistoricalContextInput = {
  marketRegime?: { regime?: string } | null;
  marketContextAdvice?: { outlook?: string } | null;
  completedTradeEvaluations?: CompletedEval[] | null;
};

export type HistoricalContext = {
  sampleSize: number;
  historicalBias: 'HISTORICALLY_POSITIVE'|'HISTORICALLY_NEGATIVE'|'MIXED'|'INSUFFICIENT_HISTORY';
  confidence: number; // 0-100
  summary: string;
  supportingEvidence: string[]; // at least one entry
};

function clamp(n:number){ return Math.max(0, Math.min(100, Math.round(n))); }

// Pure deterministic historical context builder
export function buildHistoricalContext(input: HistoricalContextInput): HistoricalContext{
  const mr = input && input.marketRegime ? input.marketRegime : null;
  const advice = input && input.marketContextAdvice ? input.marketContextAdvice : null;
  const all = Array.isArray(input && input.completedTradeEvaluations) ? input!.completedTradeEvaluations! : [];

  // Filter only complete evaluations with numeric returnPercent
  const complete = all.filter((e:any)=> typeof e.returnPercent === 'number' && Number.isFinite(e.returnPercent));

  // Matching: prefer matches where both regime and outlook match; fallback to regime-only if advice missing
  const matches = complete.filter((e:any)=>{
    try{
      const matchRegime = mr && mr.regime ? String(mr.regime) === String((e.marketRegime && e.marketRegime.regime) || '') : true;
      const matchOutlook = advice && advice.outlook ? String(advice.outlook) === String((e.marketContextAdvice && e.marketContextAdvice.outlook) || '') : true;
      return matchRegime && matchOutlook;
    }catch(_){ return false; }
  });

  const sampleSize = matches.length;
  if (sampleSize === 0){
    return { sampleSize: 0, historicalBias: 'INSUFFICIENT_HISTORY', confidence: 0, summary: 'No matching historical evaluations', supportingEvidence: ['No matching history'] };
  }

  // compute average return and basic stats
  let sum = 0; let pos = 0; let neg = 0; let breakeven = 0;
  const evidences: string[] = [];
  for (let i=0;i<matches.length;i++){
    const it = matches[i];
    const rp = Number(it.returnPercent || 0);
    sum += rp;
    if (rp > 0) pos++; else if (rp < 0) neg++; else breakeven++;
    evidences.push(`${String(it.symbol||'NA')}:${rp.toFixed(2)}%`);
  }
  const avg = sum / sampleSize;

  let bias: HistoricalContext['historicalBias'] = 'MIXED';
  if (pos > 0 && neg === 0) bias = 'HISTORICALLY_POSITIVE';
  else if (neg > 0 && pos === 0) bias = 'HISTORICALLY_NEGATIVE';
  else bias = 'MIXED';

  // Confidence scales with sample size and magnitude of avg return
  // base increases with sample size but capped
  const base = Math.min(80, 10 + sampleSize * 15); // small samples have low base
  const magnitudeFactor = Math.min(20, Math.abs(avg) * 2); // each % roughly scales
  const conf = clamp(base + Math.round(magnitudeFactor));

  const summary = `Historical sample ${sampleSize}, avg return ${avg.toFixed(2)}%, bias ${bias}`;

  return { sampleSize, historicalBias: bias, confidence: conf, summary, supportingEvidence: evidences.length ? evidences.slice(0,10) : ['No details'] };
}

export default buildHistoricalContext;
