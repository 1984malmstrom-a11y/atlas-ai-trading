import { ReasoningReport } from '../reasoning/victor-reasoning-engine';
import { RecommendationReport } from '../recommendation/victor-recommendation-engine';
import { IntelligenceReport } from '../intelligence/victor-intelligence-engine';
import type { VictorMemoryContext } from '../memory/victor-memory-engine';

export type InvestmentReport = {
  reportId: string;
  generatedAt: string;
  company: string;
  overallRating: 'Strong Buy'|'Buy'|'Hold'|'Sell'|'Strong Sell';
  confidence: number;
  summary: string;
  recommendation: RecommendationReport;
  reasoning: ReasoningReport;
  positives: string[];
  negatives: string[];
  risks: string[];
  opportunities: string[];
  portfolioFit: number;
  investorFit: number;
  timeHorizon: string;
  watchlistActions: string[];
  nextReviewDate: string;
  modulesUsed: string[];
  disclaimer: string;
  evidenceCount?: number;
  collectedAt?: string | null;
  staleEvidenceCount?: number;
  providerErrors?: any[];
    overallScore?: number;
    memorySummary?: {
      previousAnalysisCount: number;
      previousRecommendation?: string | null;
      previousOverallScore?: number | null;
      currentOverallScore?: number | null;
      scoreChange?: number | null;
      recommendationChanged: boolean;
      historicalAccuracy?: number | null;
      knownUserPatterns: string[];
      summary: string;
    };
};

export function runVictorInvestmentReport(opts: { recommendation: RecommendationReport; reasoning: ReasoningReport; intelligence: IntelligenceReport; investorProfile?: any; portfolio?: any; scoreReport?: any; research?: any; memoryContext?: VictorMemoryContext }): InvestmentReport {
  const { recommendation, reasoning, intelligence, investorProfile, portfolio, scoreReport, research, memoryContext } = opts;
  const id = `ir-${Date.now()}-${Math.floor(Math.random()*10000)}`;
  const company = recommendation?.headline || 'Unknown';

  // Map recommendation.action to overallRating
  const mapRating = (action: string): InvestmentReport['overallRating'] => {
    if (action === 'BUY') return 'Buy';
    if (action === 'SELL') return 'Sell';
    if (action === 'HOLD') return 'Hold';
    return 'Hold';
  };

  const overallRating = ((): InvestmentReport['overallRating'] => {
    const r = mapRating(recommendation?.action || 'HOLD');
    if (recommendation.priority === 'Critical' && r === 'Buy') return 'Strong Buy';
    if (recommendation.priority === 'Critical' && r === 'Sell') return 'Strong Sell';
    return r;
  })();

  const confidence = Math.round((recommendation.confidence + (intelligence?.marketConfidence || 50) + (reasoning ? (reasoning.keyFactors.length * 5) : 0)) / 3);

  const positives = (reasoning?.keyFactors && reasoning.keyFactors.slice(0,3)) || [];
  const negatives = (reasoning?.conflictingEvidence && reasoning.conflictingEvidence.slice(0,3)) || [];
  const risks = reasoning.conflictingEvidence.slice(0,3) || [];
  const opportunities = intelligence.opportunities.slice(0,3) || [];

  const portfolioFit = recommendation.portfolioFit || 50;
  const investorFit = recommendation.riskFit || 50;
  const timeHorizon = recommendation.nextReviewDate ? '3-12 månader' : 'Kort sikt';

  const watchlistActions = recommendation.alternatives || [];
  const nextReviewDate = recommendation.nextReviewDate || new Date(Date.now() + 1000*60*60*24*30).toISOString();

  const modulesUsed = (intelligence.modules || []).map((m:any)=> m.title);
  // include research evidence info if provided
  const evidenceCount = research?.evidence?.length || 0;
  const collectedAt = research?.collectedAt || null;
  const staleEvidenceCount = research?.staleEvidenceCount || 0;
  const providerErrors = research?.providerErrors || [];

  const summary = `Investment report for ${company}: ${recommendation.summary}`;

  const disclaimer = 'Detta är en simulerad rekommendation baserad på mockdata. Ingen finansiell rådgivning.';

  // build memory summary
  const memPrev = memoryContext;
  const currentOverall = scoreReport?.overallScore;
  const prevOverall = memPrev?.previousOverallScore;
  const scoreChange = (typeof currentOverall === 'number' && typeof prevOverall === 'number') ? (currentOverall - prevOverall) : null;
  let historicalAccuracy: number | null = null;
  try{
    if (memPrev?.relevantPastOutcomes && memPrev.relevantPastOutcomes.length){
      const total = memPrev.relevantPastOutcomes.length;
      const correct = memPrev.relevantPastOutcomes.filter(r=> r.outcomeStatus === 'Correct').length;
      historicalAccuracy = total > 0 ? Math.round((correct/total)*100) : null;
    }
  }catch(e){ historicalAccuracy = null; }

  const memorySummary = {
    previousAnalysisCount: memPrev?.symbolAnalysisCount || 0,
    previousRecommendation: memPrev?.previousRecommendation || null,
    previousOverallScore: prevOverall ?? null,
    currentOverallScore: currentOverall ?? null,
    scoreChange,
    recommendationChanged: memPrev?.recommendationChanged || false,
    historicalAccuracy,
    knownUserPatterns: memPrev?.knownUserPatterns || [],
    summary: memPrev?.memorySummary || '',
  };

  return {
    reportId: id,
    generatedAt: new Date().toISOString(),
    company,
    overallRating,
    confidence: Math.max(0, Math.min(100, confidence)),
    // include overallScore if scoring ran
    ...( scoreReport ? { overallScore: scoreReport.overallScore } : {} ),
    summary,
    recommendation,
    reasoning,
    positives: Array.from(new Set(positives as string[])).slice(0,5),
    negatives: Array.from(new Set(negatives as string[])).slice(0,5),
    risks: Array.from(new Set(risks as string[])).slice(0,5),
    opportunities: Array.from(new Set(opportunities as string[])).slice(0,5),
    portfolioFit,
    investorFit,
    timeHorizon,
    watchlistActions,
    nextReviewDate,
    modulesUsed,
    // data hub metadata
    evidenceCount,
    collectedAt,
    staleEvidenceCount,
    providerErrors,
    disclaimer,
    // attach memory summary
    memorySummary,
  };
}

export default runVictorInvestmentReport;
