import { VictorResearchReport } from '../research/victor-research-engine';

export type IntelligenceReport = {
  overallSentiment: 'Very Bullish'|'Bullish'|'Neutral'|'Bearish'|'Very Bearish';
  marketConfidence: number; // 0-100
  opportunities: string[];
  threats: string[];
  contradictions: string[];
  missingInformation: string[];
  strongestSignals: string[];
  weakestSignals: string[];
  summary: string;
  overallScore: number; // 0-100
  modules: any[]; // passthrough from research
  updatedAt: string;
};

export function runVictorIntelligence(report: VictorResearchReport): IntelligenceReport {
  const modules = report.modules || [];
  const opportunities: string[] = [];
  const threats: string[] = [];
  const contradictions: string[] = [];
  const missingInformation: string[] = [];

  // sentiment markers
  const posKeywords = ['positiv','styrka','bull','buy','möjlig','stark'];
  const negKeywords = ['negativ','svag','bear','sell','risk','svaghet'];

  // count signals
  let posCount = 0, negCount = 0;

  modules.forEach((m:any)=>{
    const s = (m.summary||'').toLowerCase();
    if (!s || s.trim().length < 3) { missingInformation.push(m.title); return; }
    let foundPos=false, foundNeg=false;
    posKeywords.forEach(k=> { if (s.includes(k)) { posCount++; foundPos=true; opportunities.push(`${m.title}: ${m.summary}`); } });
    negKeywords.forEach(k=> { if (s.includes(k)) { negCount++; foundNeg=true; threats.push(`${m.title}: ${m.summary}`); } });
    if (foundPos && foundNeg) contradictions.push(`${m.title} visar både positiva och negativa signaler.`);
  });

  // overall sentiment
  const delta = posCount - negCount;
  let overallSentiment: IntelligenceReport['overallSentiment'] = 'Neutral';
  if (delta >= 3) overallSentiment = 'Very Bullish';
  else if (delta === 2) overallSentiment = 'Bullish';
  else if (delta === 1) overallSentiment = 'Neutral';
  else if (delta === 0) overallSentiment = 'Neutral';
  else if (delta <= -3) overallSentiment = 'Very Bearish';
  else overallSentiment = 'Bearish';

  // strongest/weakest by module confidence
  const sorted = modules.slice().sort((a:any,b:any)=> (b.confidence||50) - (a.confidence||50));
  const strongestSignals = sorted.slice(0,3).map((m:any)=> `${m.title}: ${m.summary}`);
  const weakestSignals = sorted.slice(-3).map((m:any)=> `${m.title}: ${m.summary}`);

  // contradictions already collected; if modules disagree on simple keywords across modules, add contradictions
  const allSummaries = modules.map((m:any)=> (m.summary||'').toLowerCase()).join(' || ');
  posKeywords.forEach(k=>{ if (allSummaries.includes(k) && allSummaries.includes('negativ')) contradictions.push(`Konflikt: både positiva och negativa signaler i olika moduler.`); });

  // overall score: weighted average of module confidences (simple)
  const avgConfidence = Math.round((modules.reduce((s:any,m:any)=> s + (m.confidence||50), 0) / Math.max(1, modules.length)));
  const marketConfidence = Math.min(100, Math.max(0, avgConfidence + (posCount - negCount) * 5));

  const summaryParts: string[] = [];
  summaryParts.push(`Overall sentiment: ${overallSentiment}.`);
  if (opportunities.length) summaryParts.push(`Möjligheter: ${opportunities.slice(0,3).join('; ')}`);
  if (threats.length) summaryParts.push(`Hot: ${threats.slice(0,3).join('; ')}`);
  if (contradictions.length) summaryParts.push(`Motsägelser: ${contradictions.slice(0,3).join('; ')}`);
  if (missingInformation.length) summaryParts.push(`Saknad info: ${missingInformation.join(', ')}`);

  const overallScore = Math.round((marketConfidence + avgConfidence) / 2);

  return {
    overallSentiment,
    marketConfidence,
    opportunities: Array.from(new Set(opportunities)),
    threats: Array.from(new Set(threats)),
    contradictions: Array.from(new Set(contradictions)),
    missingInformation: Array.from(new Set(missingInformation)),
    strongestSignals,
    weakestSignals,
    summary: summaryParts.join(' '),
    overallScore,
    modules,
    updatedAt: new Date().toISOString(),
  };
}

export default runVictorIntelligence;
