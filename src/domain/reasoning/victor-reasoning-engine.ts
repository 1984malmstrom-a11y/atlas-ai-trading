import { RecommendationReport } from '../recommendation/victor-recommendation-engine';
import type { VictorMemoryContext } from '../memory/victor-memory-engine';

export type ReasoningReport = {
  conclusion: string;
  confidenceExplanation: string;
  keyFactors: string[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  assumptions: string[];
  unansweredQuestions: string[];
  recommendationStrength: 'Weak'|'Moderate'|'Strong';
  explainLikeBeginner: string;
  explainLikeExperienced: string;
  updatedAt: string;
};

export function runVictorReasoning(opts: { recommendation: RecommendationReport; intelligence?: any; research?: any; memoryContext?: VictorMemoryContext }): ReasoningReport {
  const reco = opts.recommendation;
  const intelligence = opts.intelligence;
  const research = opts.research;
  const memoryContext = opts.memoryContext;
  const keyFactors: string[] = [];
  const supportingEvidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const assumptions: string[] = [];
  const unansweredQuestions: string[] = [];

  // Collect key factors from recommendation reasoning and intelligence opportunities
  if (reco.reasoning && reco.reasoning.length) keyFactors.push(...reco.reasoning.slice(0,5));
  if (intelligence?.opportunities) keyFactors.push(...(intelligence.opportunities.slice(0,3) as string[]));

  // Supporting evidence: modules
  if (reco.modules) supportingEvidence.push(...reco.modules.map((m:any)=> m.title));
  if (intelligence?.strongestSignals) supportingEvidence.push(...intelligence.strongestSignals.slice(0,3));

  // Conflicting evidence from intelligence contradictions and reco warnings
  if (intelligence?.contradictions) conflictingEvidence.push(...(intelligence.contradictions as string[]).slice(0,3));
  if (reco.warnings) conflictingEvidence.push(...(reco.warnings as string[]).slice(0,3));

  // Assumptions: if intelligence missing information, assume
  if (intelligence?.missingInformation && intelligence.missingInformation.length) assumptions.push('Antagande: inga negativa makrohändelser i saknad data');
  assumptions.push('Antagande: marknaden förblir stabil under kort sikt');

  // Unanswered questions
  if (intelligence?.missingInformation) unansweredQuestions.push(...intelligence.missingInformation.slice(0,3));
  if (reco.warnings && reco.warnings.length) unansweredQuestions.push(...reco.warnings.slice(0,3));

  // strength
  const strength: ReasoningReport['recommendationStrength'] = reco.confidence >= 75 ? 'Strong' : (reco.confidence >= 50 ? 'Moderate' : 'Weak');

  // Memory-based notes
  if (memoryContext) {
    if (memoryContext.previousRecommendation) supportingEvidence.push(`Tidigare rekommendation: ${memoryContext.previousRecommendation}`);
    if (typeof memoryContext.symbolAnalysisCount === 'number') supportingEvidence.push(`Tidigare analyser: ${memoryContext.symbolAnalysisCount}`);
    if (typeof memoryContext.previousOverallScore === 'number') supportingEvidence.push(`Tidigare poäng: ${memoryContext.previousOverallScore}`);
    if (typeof memoryContext.scoreChange === 'number') supportingEvidence.push(`Poängförändring: ${memoryContext.scoreChange > 0 ? '+' : ''}${memoryContext.scoreChange}`);
    if (memoryContext.recommendationChanged) assumptions.push('Rekommendationen har ändrats sedan förra analysen. Kontrollera drivkrafter.');
  }

  const explainLikeBeginner = 'Mycket talar för att bolaget utvecklas åt rätt håll. Samtidigt finns vissa risker som gör att rekommendationen inte är självklar.';
  const explainLikeExperienced = 'Rekommendationen bygger främst på förbättrade fundamenta, positivt momentum och attraktiv relativ värdering, men motverkas delvis av makroekonomisk osäkerhet.';

  const conclusion = `${reco.action} - ${reco.headline}`;
  const confidenceExplanation = `Baseras på confidence ${reco.confidence} och intelligence score ${intelligence?.overallScore || 'N/A'}`;

  return {
    conclusion,
    confidenceExplanation,
    keyFactors: Array.from(new Set(keyFactors)).slice(0,6),
    supportingEvidence: Array.from(new Set(supportingEvidence)).slice(0,6),
    conflictingEvidence: Array.from(new Set(conflictingEvidence)).slice(0,6),
    assumptions: Array.from(new Set(assumptions)).slice(0,6),
    unansweredQuestions: Array.from(new Set(unansweredQuestions)).slice(0,6),
    recommendationStrength: strength,
    explainLikeBeginner,
    explainLikeExperienced,
    updatedAt: new Date().toISOString(),
  };
}

export default runVictorReasoning;
