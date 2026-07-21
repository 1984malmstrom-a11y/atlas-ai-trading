import { VictorResearchReport } from '../research/victor-research-engine';
import { IntelligenceReport } from '../intelligence/victor-intelligence-engine';
import { RecommendationReport } from '../recommendation/victor-recommendation-engine';
import { ReasoningReport } from '../reasoning/victor-reasoning-engine';
import type { VictorMemoryContext } from '../memory/victor-memory-engine';

export type ScoreReport = {
  overallScore: number; // 0-100
  fundamentalScore: number;
  technicalScore: number;
  macroScore: number;
  sentimentScore: number;
  portfolioScore: number;
  investorProfileScore: number;
  confidenceScore: number;
  riskScore: number;
  diversificationScore: number;
  scoreBreakdown: string[];
  summary: string;
  modules?: any[];
  updatedAt: string;
};

export function runVictorScoring(opts: { research?: VictorResearchReport; intelligence?: IntelligenceReport; recommendation?: RecommendationReport; reasoning?: ReasoningReport; investorProfile?: any; portfolioAnalysis?: any; memoryContext?: VictorMemoryContext }): ScoreReport {
  const research = opts.research;
  const intelligence = opts.intelligence;
  const recommendation = opts.recommendation;
  const reasoning = opts.reasoning;
  const profile = opts.investorProfile || {};
  const memoryContext = opts.memoryContext;

  // Mock sub-scores derived from module confidences and recommendation confidence
  const fundamentalScore = Math.round((research?.modules?.find((m:any)=> m.title==='Company Fundamentals')?.confidence || 60));
  const technicalScore = Math.round((research?.modules?.find((m:any)=> m.title==='Technical Analysis')?.confidence || 60));
  const macroScore = Math.round((research?.modules?.find((m:any)=> m.title==='Macro Economy')?.confidence || 60));
  const sentimentScore = Math.round((intelligence?.marketConfidence) || 60);
  const portfolioScore = Math.round((recommendation?.portfolioFit) || 50);
  const investorProfileScore = profile?.risk === 'Låg' ? 40 : 70;
  const confidenceScore = Math.round((recommendation?.confidence || 50));
  const riskScore = reasoning ? Math.max(0, 100 - (reasoning.conflictingEvidence?.length || 0) * 15) : 70;
  const diversificationScore = Math.round(100 - (100 - (recommendation?.portfolioFit || 50)));

  // Weighted overall score
  const overall = Math.round((fundamentalScore * 0.2) + (technicalScore * 0.15) + (macroScore * 0.1) + (sentimentScore * 0.15) + (portfolioScore * 0.15) + (confidenceScore * 0.15));

  // small memory-based adjustment: never decisive, only nudges by a few points
  let adjustedOverall = overall;
  try{
    if (memoryContext && typeof memoryContext.previousOverallScore === 'number'){
      const prev = memoryContext.previousOverallScore;
      const diff = overall - prev;
      if (diff > 5) adjustedOverall = Math.min(100, adjustedOverall + 2);
      else if (diff < -5) adjustedOverall = Math.max(0, adjustedOverall - 2);
    }
    if (memoryContext && memoryContext.recommendationChanged) adjustedOverall = Math.max(0, adjustedOverall - 1);
  }catch(e){}

  const breakdown: string[] = [];
  if (reasoning?.keyFactors) breakdown.push(...reasoning.keyFactors.map((k:string)=> `+ ${k}`));
  if (reasoning?.conflictingEvidence) breakdown.push(...reasoning.conflictingEvidence.map((c:string)=> `- ${c}`));

  const summary = `Overall score ${overall}. Fundamental ${fundamentalScore}, Technical ${technicalScore}, Macro ${macroScore}, Sentiment ${sentimentScore}.`;

  return {
    overallScore: adjustedOverall,
    fundamentalScore,
    technicalScore,
    macroScore,
    sentimentScore,
    portfolioScore,
    investorProfileScore,
    confidenceScore,
    riskScore,
    diversificationScore,
    scoreBreakdown: breakdown.slice(0,8),
    summary,
    modules: research?.modules || intelligence?.modules || recommendation?.modules || [],
    updatedAt: new Date().toISOString(),
  };
}

export default runVictorScoring;
