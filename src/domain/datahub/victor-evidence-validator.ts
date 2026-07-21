import { VictorEvidence } from './types';

export type ValidatedEvidence = VictorEvidence & {
  validationStatus: 'Confirmed'|'Partially Confirmed'|'Unconfirmed'|'Contradicted';
  supportingSourceCount: number;
  conflictingSourceCount: number;
  validationReasons: string[];
};

export type ValidationReport = {
  validatedEvidence: ValidatedEvidence[];
  rejectedEvidence: VictorEvidence[];
  corroboratedFacts: string[];
  contradictions: { symbol?: string | null; topic: string; providers: string[]; details?: string }[];
  lowConfidenceClaims: VictorEvidence[];
  sourceCoverage: number; // 0-100
  averageReliability: number; // 0-100
  averageConfidence: number; // 0-100
  validationScore: number; // 0-100
  summary: string;
};

function normalizeFact(f: string){ return (f||'').toString().trim().toLowerCase(); }

export function validateEvidence(allEvidence: VictorEvidence[]): ValidationReport {
  const providersSet = new Set(allEvidence.map(e=> e.provider));
  const distinctProviders = Array.from(providersSet);

  // maps normalized fact -> evidence entries
  const factMap = new Map<string, VictorEvidence[]>();
  for(const e of allEvidence){
    const facts = e.facts && e.facts.length ? e.facts : [e.summary];
    for(const f of facts){
      const k = normalizeFact(f);
      if (!factMap.has(k)) factMap.set(k, []);
      factMap.get(k)!.push(e);
    }
  }

  const corroboratedFacts: string[] = [];
  const contradictions: ValidationReport['contradictions'] = [];
  const lowConfidenceClaims: VictorEvidence[] = [];
  const rejectedEvidence: VictorEvidence[] = [];
  const validatedEvidence: ValidatedEvidence[] = [];

  // Helper: provider weight by type (mock rule)
  const providerWeight = (provider:string)=> {
    if (provider.toLowerCase().includes('fund') || provider.toLowerCase().includes('macro')) return 1.2;
    if (provider.toLowerCase().includes('news')) return 0.9;
    return 1.0;
  };

  // Freshness weight
  const freshnessWeight = (e: VictorEvidence)=> e.freshnessStatus === 'Fresh' ? 1.0 : (e.freshnessStatus === 'Aging' ? 0.7 : 0.4);

  // detect corroboration and contradictions
  for(const [fact, list] of factMap.entries()){
    const provs = Array.from(new Set(list.map(l=> l.provider)));
    if (provs.length >= 2){
      corroboratedFacts.push(fact);
    }
    // simple contradiction detection: same symbol but different summaries among providers
    const symbols = Array.from(new Set(list.map(l=> l.symbol || '')));
    if (symbols.length >= 1){
      const summaries = Array.from(new Set(list.map(l=> (l.summary||'').toString().trim())));
      if (summaries.length > 1){
        contradictions.push({ symbol: list[0].symbol || null, topic: fact, providers: provs, details: summaries.join(' || ') });
      }
    }
  }

  // Evaluate each evidence item
  for(const e of allEvidence){
    const reasons: string[] = [];
    let supporting = 0;
    let conflicting = 0;

    const facts = e.facts && e.facts.length ? e.facts : [e.summary];
    for(const f of facts){
      const k = normalizeFact(f);
      const matches = factMap.get(k) || [];
      const provs = Array.from(new Set(matches.map(m=> m.provider)));
      if (provs.length >= 2) { supporting = Math.max(supporting, provs.length); }
      // conflict if same symbol has different summaries
      const others = (matches || []).filter(m=> m.provider !== e.provider);
      const otherSummaries = Array.from(new Set(others.map(o=> (o.summary||'').toString().trim())));
      if (otherSummaries.length > 0 && otherSummaries.some(s=> s !== (e.summary||'').toString().trim())){ conflicting = Math.max(conflicting, otherSummaries.length); }
    }

    // reliability rules
    if ((e.reliabilityScore||0) < 30){
      rejectedEvidence.push(e); reasons.push('Reliability below 30 → rejected');
      continue; // do not validate further
    }
    if ((e.reliabilityScore||0) < 50){ lowConfidenceClaims.push(e); reasons.push('Reliability under 50 → low confidence'); }

    // status
    let status: ValidatedEvidence['validationStatus'] = 'Unconfirmed';
    if (supporting >= 2){ status = 'Confirmed'; reasons.push('Corroborated by multiple providers'); }
    else if (conflicting > 0){ status = 'Contradicted'; reasons.push('Conflicting reports from other providers'); }
    else { status = 'Unconfirmed'; reasons.push('Single-source claim'); }

    // adjust confidence upwards for confirmed items
    let adjConfidence = e.confidence || 50;
    if (status === 'Confirmed') adjConfidence = Math.min(100, Math.round(adjConfidence * 1.1));
    if (status === 'Contradicted') adjConfidence = Math.max(0, Math.round(adjConfidence * 0.6));

    // account for source weight & freshness
    const weight = providerWeight(e.provider) * freshnessWeight(e);
    const weightedReliability = Math.max(0, Math.min(100, Math.round((e.reliabilityScore||0) * weight)));

    const ve: ValidatedEvidence = { ...e, validationStatus: status, supportingSourceCount: supporting, conflictingSourceCount: conflicting, validationReasons: reasons, confidence: adjConfidence, reliabilityScore: weightedReliability } as ValidatedEvidence;

    if (ve.validationStatus === 'Contradicted'){ reasons.push('Marked contradicted'); }

    validatedEvidence.push(ve);
  }

  // Filter low vs rejected were handled
  // compute aggregates
  const used = validatedEvidence;
  const avgReli = used.length ? Math.round(used.reduce((s,u)=> s + (u.reliabilityScore||0),0) / used.length) : 0;
  const avgConf = used.length ? Math.round(used.reduce((s,u)=> s + (u.confidence||0),0) / used.length) : 0;

  const sourceCoverage = Math.round((distinctProviders.length / Math.max(1, 5)) * 100); // out of 5 mock providers

  // validation score: combine corroboration ratio, avgReli, avgConf, penalize contradictions and rejects
  const corroborationRatio = factMap.size ? (corroboratedFacts.length / factMap.size) : 0;
  const contradictionPenalty = Math.min(1, contradictions.length / Math.max(1, factMap.size));
  const rejectPenalty = Math.min(1, rejectedEvidence.length / Math.max(1, allEvidence.length));
  let validationScore = Math.round((corroborationRatio * 0.4 + (avgReli/100) * 0.35 + (avgConf/100) * 0.25) * 100);
  validationScore = Math.max(0, Math.min(100, Math.round(validationScore * (1 - contradictionPenalty) * (1 - rejectPenalty))));

  const summary = `Validation: ${validationScore} — ${corroboratedFacts.length} corroborated facts, ${contradictions.length} contradictions, ${rejectedEvidence.length} rejected.`;

  return {
    validatedEvidence,
    rejectedEvidence,
    corroboratedFacts,
    contradictions,
    lowConfidenceClaims,
    sourceCoverage,
    averageReliability: avgReli,
    averageConfidence: avgConf,
    validationScore,
    summary,
  };
}

const evidenceValidator = { validateEvidence };
export default evidenceValidator;
