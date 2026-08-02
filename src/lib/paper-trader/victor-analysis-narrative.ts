export type VictorDecisionViewInput = {
  symbol?: string | null;
  action?: 'BUY' | 'SELL' | 'HOLD' | string | null;
  confidence?: number | null; // percent 0..100
  reasoning?: readonly string[] | string | null;
  signals?: readonly string[] | null;
  referencePrice?: number | null;
  risk?: { level?: string | null; reasons?: readonly string[] | null } | null;
  marketContextDiagnostics?: import('./signal-confluence').MarketContextDiagnostics | null;
  technicalSummary?: { trend?: string | null; signal?: string | null; score?: number | null; reason?: string | null } | null;
  fundamentalSummary?: { headline?: string | null } | null;
};

export type VictorAnalysisNarrative = {
  headline: string;
  verdict: string;
  whyNow: readonly string[];
  supportingFactors: readonly string[];
  conflictingFactors: readonly string[];
  riskFactors: readonly string[];
  watchNext: readonly string[];
  dataQuality: {
    status: 'GOOD' | 'LIMITED' | 'INSUFFICIENT';
    label: string;
    missing: readonly string[];
  };
};

function dedupeAndLimit(arr: string[] | undefined, limit = 5){
  if (!Array.isArray(arr)) return [] as string[];
  const out: string[] = [];
  for (const s of arr){ if (!s) continue; if (out.indexOf(s) === -1) out.push(s); if (out.length >= limit) break; }
  return out;
}

function mapDataQuality(hist?: import('./historical-market-context').HistoricalMarketContextSnapshot | null, mr?: import('./market-regime-intelligence').MarketRegimeIntelligenceSnapshot | null){
  const hasHist = !!hist;
  const hasMr = !!mr;
  // collect missing capabilities (stable order, dedup, max 3)
  const missing: string[] = [];
  try{ if (hist && Array.isArray((hist as any).missingCapabilities)){
    for (const m of (hist as any).missingCapabilities){ if (!m) continue; if (missing.indexOf(String(m)) === -1) missing.push(String(m)); if (missing.length >= 3) break; }
  } }catch(_){ }
  if (hist && (hist.dataQuality === 'COMPLETE') && mr && (mr.quality === 'COMPLETE')) return { status: 'GOOD' as const, label: 'Bra beslutsunderlag', missing };
  if (hasHist || hasMr) return { status: 'LIMITED' as const, label: 'Begränsat beslutsunderlag', missing };
  return { status: 'INSUFFICIENT' as const, label: 'Otillräckligt beslutsunderlag', missing };
}

export function buildVictorAnalysisNarrative(input: VictorDecisionViewInput): VictorAnalysisNarrative {
  const action = (input && input.action) ? String(input.action).toUpperCase() : 'UNKNOWN';
  const diag = input && input.marketContextDiagnostics ? input.marketContextDiagnostics : null;
  const hist = diag && diag.historicalContext ? diag.historicalContext : null;
  const mr = diag && diag.marketRegime ? diag.marketRegime : null;

  // Headline rules
  let headline = 'Victor analyserar marknadsläget';
  const alignment = diag ? diag.contextAlignment : 'INSUFFICIENT';
  if (action === 'BUY' && alignment === 'SUPPORTIVE') headline = 'Victor ser ett köpläge som stöds av marknadskontexten';
  else if (action === 'BUY' && alignment === 'CONFLICTING') headline = 'Victor ser ett köpläge, men marknadskontexten varnar';
  else if (action === 'SELL' && alignment === 'SUPPORTIVE') headline = 'Victor ser ett säljläge som stöds av marknadskontexten';
  else if (action === 'HOLD') headline = 'Victor avvaktar medan signalerna är blandade';
  else if (alignment === 'INSUFFICIENT') headline = 'Victor avvaktar eftersom beslutsunderlaget är begränsat';

  // Verdict (short summary)
  let verdict = 'Översikt baserad på tillgänglig diagnostik.';
  if (alignment === 'SUPPORTIVE') verdict = 'Marknadskontexten stödjer beslutet.';
  else if (alignment === 'CONFLICTING') verdict = 'Marknadskontexten indikerar konflikt med beslutet.';
  else if (alignment === 'NEUTRAL') verdict = 'Marknadskontexten påverkar beslutet neutralt.';
  else if (alignment === 'INSUFFICIENT') verdict = 'Beslutsunderlaget är otillräckligt för en tydlig bedömning.';

  // whyNow: prefer decision reasoning, then technical/fundamental snippets
  const whySet: string[] = [];
  try{ if (input.reasoning){ if (Array.isArray(input.reasoning)) whySet.push(String(input.reasoning[0] || '').trim()); else whySet.push(String(input.reasoning).trim()); } }catch(_){ }
  try{ if (input.technicalSummary && input.technicalSummary.reason) whySet.push(String(input.technicalSummary.reason).trim()); }catch(_){ }
  try{ if (input.fundamentalSummary && input.fundamentalSummary.headline) whySet.push(String(input.fundamentalSummary.headline).trim()); }catch(_){ }

  // supporting / conflicting factors
  const supporting: string[] = [];
  const conflicting: string[] = [];
  try{
    if (diag && Array.isArray(diag.contextSummary)) supporting.push(...diag.contextSummary.slice(0,5));
    if (mr && Array.isArray(mr.supportingSignals) && mr.supportingSignals.length) supporting.push(...mr.supportingSignals.slice(0,5).map(s=> `Signal: ${s}`));
    if (mr && Array.isArray(mr.conflictingSignals) && mr.conflictingSignals.length) conflicting.push(...mr.conflictingSignals.slice(0,5).map(s=> `Signal: ${s}`));
    if (input.signals && Array.isArray(input.signals) && input.signals.length){ supporting.push(...input.signals.slice(0,5).map(s=> `Signal: ${String(s)}`)); }
  }catch(_){ }

  // risk factors
  const risks: string[] = [];
  try{ if (input.risk && input.risk.level) risks.push(`Risknivå: ${String(input.risk.level)}`); }catch(_){ }
  try{ if (Array.isArray(input.risk && input.risk.reasons) && input.risk!.reasons!.length) risks.push(...(input.risk!.reasons as string[]).slice(0,3)); }catch(_){ }
  try{ if (hist && typeof hist.currentDrawdownPercent === 'number') risks.push(`Aktuell drawdown: ${String(hist.currentDrawdownPercent)} %`); }catch(_){ }
  try{ if (mr && mr.riskRegime === 'RISK_OFF') risks.push('Regimen indikerar riskaversion'); }catch(_){ }

  // watch next (supported follow-ups only)
  const watch: string[] = [];
  try{ if (hist && hist.volatilityState === 'HIGH') watch.push('Om volatiliteten fortsätter expandera'); }catch(_){ }
  try{ if (hist && hist.momentumPersistence === 'REVERSING') watch.push('Om momentum återtar trend'); }catch(_){ }
  try{ if (mr && mr.riskRegime && mr.riskRegime === 'RISK_OFF') watch.push('Om regimen skiftar från risk-off till neutral'); }catch(_){ }

  const dataQuality = mapDataQuality((hist as any) || null, (mr as any) || null);

  const narrative: VictorAnalysisNarrative = {
    headline,
    verdict,
    whyNow: dedupeAndLimit(whySet.filter(Boolean) as string[], 5),
    supportingFactors: dedupeAndLimit(supporting, 5).slice(0,5),
    conflictingFactors: dedupeAndLimit(conflicting, 5).slice(0,5),
    riskFactors: dedupeAndLimit(risks, 5).slice(0,5),
    watchNext: dedupeAndLimit(watch, 3).slice(0,3),
    dataQuality
  };

  return narrative;
}

export default { buildVictorAnalysisNarrative };
