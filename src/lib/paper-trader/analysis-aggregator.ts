export type EngineResult = { status?: string, score?: number, signal?: string, reasons?: string[] };

export function combineAnalyses(input: { technical?: EngineResult | null, fundamental?: EngineResult | null }){
  const tech = input && input.technical ? input.technical : null;
  const fund = input && input.fundamental ? input.fundamental : null;

  const scores: number[] = [];
  const tryPush = (r: EngineResult | null) => {
    if (!r) return;
    const s = typeof (r as any).score === 'number' && Number.isFinite((r as any).score) ? Number((r as any).score) : undefined;
    if (typeof s === 'number') scores.push(Math.round(s));
  };
  tryPush(tech);
  tryPush(fund);

  let overallScore = 0;
  if (scores.length > 0){
    const sum = scores.reduce((s,a)=> s+a, 0);
    overallScore = Math.round(sum / scores.length);
  }

  // confidence mirrors overallScore in this mock aggregator
  const confidence = overallScore;

  let overallSignal: 'BUY'|'HOLD'|'SELL' = 'HOLD';
  if (scores.length === 0){
    overallSignal = 'HOLD';
  } else if (overallScore >= 75) overallSignal = 'BUY';
  else if (overallScore >= 50) overallSignal = 'HOLD';
  else overallSignal = 'SELL';

  // gather deterministic reasons from engines in order technical then fundamental
  const reasons: string[] = [];
  const pushReasons = (r: EngineResult | null) => {
    if (!r || !Array.isArray(r.reasons)) return;
    for (const s of r.reasons){
      if (typeof s === 'string' && s.length){
        if (reasons.length < 4) reasons.push(s);
        else break;
      }
    }
  };
  if (scores.length > 0){
    pushReasons(tech);
    pushReasons(fund);
  }

  return { overallScore, overallSignal, confidence, reasons };
}

export default combineAnalyses;
