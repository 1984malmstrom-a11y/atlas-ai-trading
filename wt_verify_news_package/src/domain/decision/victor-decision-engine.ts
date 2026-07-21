import { VictorResearchReport } from '../research/victor-research-engine';

export type DecisionReport = {
  recommendation: 'BUY'|'HOLD'|'SELL'|'WATCH';
  action: string;
  confidence: number; // 0-100
  riskLevel: 'Low'|'Medium'|'High';
  expectedTimeframe: string;
  reasoning: string[];
  positives: string[];
  negatives: string[];
  catalysts: string[];
  risks: string[];
  sourcesUsed: string[];
  updatedAt: string;
};

function inferRecommendation(report: VictorResearchReport): { rec: DecisionReport['recommendation']; confidence: number }{
  const conf = report.confidence;
  // simple heuristics: high confidence -> BUY, medium -> HOLD, low -> WATCH
  if (conf >= 70) return { rec: 'BUY', confidence: conf };
  if (conf >= 50) return { rec: 'HOLD', confidence: conf };
  if (conf >= 30) return { rec: 'WATCH', confidence: conf };
  return { rec: 'SELL', confidence: conf };
}

function inferRisk(report: VictorResearchReport): 'Low'|'Medium'|'High' {
  const riskModule = report.modules.find(m=> m.title === 'Portfolio Context');
  if (!riskModule) return 'Medium';
  const text = (riskModule.summary||'').toLowerCase();
  if (text.includes('tungt') || text.includes('koncentr')) return 'High';
  if (text.includes('diversifier')) return 'Low';
  return 'Medium';
}

export function runVictorDecision(report: any): DecisionReport {
  // Accept either a Research report or a ScoreReport with overallScore
  const confSource = typeof report.overallScore === 'number' ? report.overallScore : report.confidence;
  const conf = Math.round(confSource || 0);
  let rec: DecisionReport['recommendation'];
  if (conf >= 70) rec = 'BUY';
  else if (conf >= 50) rec = 'HOLD';
  else if (conf >= 30) rec = 'WATCH';
  else rec = 'SELL';
  const confidence = conf;
  const riskLevel = inferRisk(report);

  const positives: string[] = [];
  const negatives: string[] = [];
  const catalysts: string[] = [];
  const risks: string[] = [];
  const reasoning: string[] = [];

  // derive bullets from modules
  (report.modules||[]).forEach((m:any) => {
    const s = m.summary || '';
    reasoning.push(`${m.title}: ${s}`);
    const low = s.toLowerCase();
    if (low.includes('styrka') || low.includes('positiv') || low.includes('möjlig')) positives.push(s);
    if (low.includes('svag') || low.includes('negativ') || low.includes('svaghet') || low.includes('svagt')) negatives.push(s);
    if (low.includes('kommande') || low.includes('möjliga') || low.includes('rapport')) catalysts.push(s);
    if (low.includes('risk') || low.includes('konjunktur') || low.includes('valuta')) risks.push(s);
  });

  // fallback examples if empty
  if (!positives.length) positives.push('Ingen stark positiv signal hittad i mockdata.');
  if (!negatives.length) negatives.push('Inga direkta negativa signaler i mockdata.');

  const timeframe = (confidence >= 75) ? '6-12 månader' : (confidence >= 50 ? '3-6 månader' : '1-3 månader');

  return {
    recommendation: rec,
    action: rec,
    confidence: Math.round(confidence),
    riskLevel,
    expectedTimeframe: timeframe,
    reasoning,
    positives,
    negatives,
    catalysts,
    risks,
    sourcesUsed: (report.modules||[]).map((m:any)=> m.title),
    updatedAt: report.updatedAt,
  };
}

export default runVictorDecision;
