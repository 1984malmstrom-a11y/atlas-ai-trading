import { IntelligenceReport } from '../intelligence/victor-intelligence-engine';
import type { VictorMemoryContext } from '../memory/victor-memory-engine';

export type RecommendationReport = {
  recommendationId: string;
  headline: string;
  summary: string;
  action: 'BUY'|'HOLD'|'SELL'|'WATCH';
  priority: 'Critical'|'High'|'Medium'|'Low';
  confidence: number; // 0-100
  portfolioFit: number; // 0-100
  riskFit: number; // 0-100
  diversificationImpact: string;
  estimatedRisk: string;
  estimatedReward: string;
  reasoning: string[];
  warnings: string[];
  alternatives: string[];
  nextReviewDate: string;
  modules?: any[];
  updatedAt: string;
};

function extractSymbolsFromText(text: string){
  const re = /[A-ZÅÄÖ0-9\-]{2,}/g;
  const found = text.match(re) || [];
  // prefer tokens with dash or uppercase letters
  return Array.from(new Set(found)).slice(0,3);
}

export function runVictorRecommendation(opts: { intelligence: IntelligenceReport; investorProfile?: any; portfolio?: any; memoryContext?: VictorMemoryContext }): RecommendationReport {
  const intelligence = opts.intelligence;
  const profile = opts.investorProfile || {};
  const portfolio = opts.portfolio || { holdings: [], totalValue: 0 };
  const memoryContext = opts.memoryContext;

  const topOpp = (intelligence.opportunities[0] || '') as string;
  const symbols = extractSymbolsFromText(topOpp);
  const primary = symbols[0] || 'Opportunity';

  // base action from sentiment
  let action: RecommendationReport['action'] = 'HOLD';
  if (intelligence.overallSentiment === 'Very Bullish' || intelligence.overallSentiment === 'Bullish') action = 'BUY';
  if (intelligence.overallSentiment === 'Very Bearish' || intelligence.overallSentiment === 'Bearish') action = 'SELL';

  // adjust for investor risk
  const userRisk = profile?.risk || 'Medium';
  if (userRisk === 'Låg' && action === 'BUY') {
    // be more conservative
    action = 'HOLD';
  }

  // priority mapping
  let priority: RecommendationReport['priority'] = 'Medium';
  if (intelligence.overallScore >= 85) priority = 'Critical';
  else if (intelligence.overallScore >= 70) priority = 'High';
  else if (intelligence.overallScore >= 50) priority = 'Medium';
  else priority = 'Low';

  // portfolio fit: if portfolio already heavy in same sector, reduce fit
  let portfolioFit = 70;
  try{
    const pc = intelligence.modules.find((m:any)=> m.title === 'Portfolio Context');
    if (pc && (pc.summary||'').toLowerCase().includes('tungt')) portfolioFit = 30;
  }catch(e){}

  // if user's profile and recommendation align, boost confidence
  let confidence = Math.round((intelligence.marketConfidence + intelligence.overallScore) / 2);
  if ((userRisk === 'Låg' && action === 'HOLD') || (userRisk !== 'Låg' && action === 'BUY')) confidence = Math.min(100, confidence + 5);
  // gentle adjustment from memory: if previous recommendation exists and differs, slightly lower confidence
  try{
    if (memoryContext && memoryContext.previousRecommendation && memoryContext.previousRecommendation !== action) {
      confidence = Math.max(0, confidence - 3);
    }
    // if user has patterns indicating preference, nudge confidence
    if (memoryContext && Array.isArray(memoryContext.knownUserPatterns) && memoryContext.knownUserPatterns.length) {
      confidence = Math.min(100, confidence + 2);
    }
  }catch(e){}

  // if portfolio has same symbol, reduce diversification impact
  const hasSymbol = portfolio.holdings?.some((h:any)=> (primary !== 'Opportunity') && h.symbol === primary);
  const diversificationImpact = hasSymbol ? 'Reduces diversification' : 'Improves diversification';

  const estimatedRisk = (confidence > 75) ? 'Moderate' : (confidence > 50 ? 'Low-Moderate' : 'High');
  const estimatedReward = (confidence > 75) ? 'Attractive' : (confidence > 50 ? 'Moderate' : 'Speculative');

  const reasoning: string[] = [];
  reasoning.push(intelligence.summary);
  reasoning.push(`Overall sentiment: ${intelligence.overallSentiment}`);

  // include short memory note
  if (memoryContext && memoryContext.symbolAnalysisCount) reasoning.push(`Tidigare analyser: ${memoryContext.symbolAnalysisCount}`);

  const warnings: string[] = [];
  if (userRisk === 'Låg' && action === 'BUY') warnings.push('Rekommenderat köp motsvarar din låg-risk-profil. Överväg mindre position.');
  if (portfolioFit < 40) warnings.push('Portföljen är redan tung i samma sektor; detta sänker portfolio fit.');

  const alternatives = extractSymbolsFromText(intelligence.summary).slice(0,3).filter(s=> s !== primary);
  if (!alternatives.length) alternatives.push('Atlas Copco', 'ABB', 'SKF');

  const nextReviewDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30 * 3).toISOString(); // 3 months

  const id = `rec-${Date.now()}-${Math.floor(Math.random()*10000)}`;
  return {
    recommendationId: id,
    headline: `${action} ${primary}`,
    summary: `Rekommendation baserad på Victors analys: ${intelligence.summary}`,
    action,
    priority,
    confidence: Math.round(confidence),
    portfolioFit: Math.max(0, Math.min(100, portfolioFit)),
    riskFit: userRisk === 'Låg' ? 30 : 70,
    diversificationImpact,
    estimatedRisk,
    estimatedReward,
    reasoning,
    warnings,
    alternatives,
    nextReviewDate,
    modules: intelligence.modules,
    updatedAt: new Date().toISOString(),
  };
}

export default runVictorRecommendation;
