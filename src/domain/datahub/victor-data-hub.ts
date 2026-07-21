import orchestrator from './victor-data-orchestrator';
import { VictorEvidence } from './types';

function nowIso(){ return new Date().toISOString(); }

export async function collectEvidence(symbol?: string){
  const collectedAt = nowIso();
  const evidence: VictorEvidence[] = [];
  const providerErrors: { providerId: string; error: string }[] = [];

  const providerResults = await orchestrator.fetchAllProviders(symbol, { timeoutMs: 5000, retries: 1, cacheTtls: { 'Market Data': 60*1000, 'Financial News': 10*60*1000, 'Company Fundamentals': 24*60*60*1000, 'Macro Economy': 6*60*60*1000, 'Technical Analysis': 5*60*1000 } });
  for(const r of providerResults){
    if (r.status === 'Success' || r.status === 'Cached'){
      const arr = Array.isArray(r.evidence) ? r.evidence : [];
      for(const e of arr){ const ev: VictorEvidence = { ...e, fetchedAt: e.fetchedAt || nowIso() } as VictorEvidence; evidence.push(ev); }
    } else {
      providerErrors.push({ providerId: r.providerId, error: r.error || r.status });
    }
  }

  // dedupe by symbol+title
  const map = new Map<string, VictorEvidence>();
  for(const e of evidence){
    const key = `${e.symbol||''}::${e.title}`;
    if (!map.has(key)) map.set(key, e);
    else {
      // merge facts and pick higher reliability
      const existing = map.get(key)!;
      existing.facts = Array.from(new Set([...(existing.facts||[]), ...(e.facts||[])]));
      existing.reliabilityScore = Math.max(existing.reliabilityScore||0, e.reliabilityScore||0);
      existing.confidence = Math.max(existing.confidence||0, e.confidence||0);
    }
  }

  const collected = Array.from(map.values());

  // mark freshness
  const now = new Date();
  let staleCount = 0;
  for(const e of collected){
    const pub = e.publishedAt ? new Date(e.publishedAt) : new Date(e.fetchedAt);
    const days = Math.max(0, Math.floor((now.getTime() - pub.getTime()) / (1000*60*60*24)));
    if (days <= 3) e.freshnessStatus = 'Fresh';
    else if (days <= 30) e.freshnessStatus = 'Aging';
    else { e.freshnessStatus = 'Stale'; staleCount++; }
  }

  // sort by reliability then confidence
  collected.sort((a,b)=> (b.reliabilityScore||0) - (a.reliabilityScore||0) || (b.confidence||0) - (a.confidence||0));

  return {
    evidence: collected,
    providerErrors,
    collectedAt,
    evidenceCount: collected.length,
    staleEvidenceCount: staleCount,
  };
}

const dataHub = { collectEvidence };
export default dataHub;
