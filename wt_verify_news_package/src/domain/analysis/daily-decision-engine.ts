import { TechnicalAnalysis, FundamentalAnalysis, NewsAnalysis, RiskAssessment, CoachDecision, DecisionAction } from './types';
import { Portfolio } from '../portfolio/types';

function nowIso(){ return new Date().toISOString(); }

function makeId(symbol: string){ return `${symbol}_${Date.now()}`; }

export type DecisionInput = {
  portfolio: Portfolio;
  technical: TechnicalAnalysis;
  fundamental: FundamentalAnalysis;
  news: NewsAnalysis;
  risk: RiskAssessment;
}

export function dailyDecisionEngine(input: DecisionInput): CoachDecision {
  const { portfolio, technical, fundamental, news, risk } = input;
  const symbol = technical.symbol;

  const reasonsFor: string[] = [];
  const reasonsAgainst: string[] = [];
  const invalidationConditions: string[] = [];

  // Basic scoring - deterministic
  let score = 50;
  if (technical.trend === 'BULLISH') score += 15; else if (technical.trend === 'BEARISH') score -= 15;
  score += Math.round((technical.momentumScore - 50) / 2);
  score += Math.round((fundamental.qualityScore - 50) / 2);
  if (news.sentiment === 'POSITIVE') score += 10; if (news.sentiment === 'NEGATIVE') score -= 10;

  // Rule checks for BUY
  const canBuy = technical.trend === 'BULLISH'
    && technical.momentumScore >= 60
    && fundamental.qualityScore >= 60
    && news.sentiment !== 'NEGATIVE'
    && risk.positionAllowed;

  // check available cash and position cap (10%)
  const positionCap = portfolio.totalValue * 0.10;
  const existingHolding = portfolio.holdings.find(h => h.symbol === symbol);
  const existingMarket = existingHolding ? existingHolding.marketValue : 0;
  const allowedNotional = positionCap - existingMarket;

  const suggestedPositionPercent = 0.05; // default suggestion 5%

  // START decision logic
  let action: DecisionAction = 'HOLD';

  if (existingHolding) {
    // Potential SELL or REDUCE or HOLD
    if (technical.trend === 'BEARISH') {
      const sellBecauseNews = news.sentiment === 'NEGATIVE' && news.importanceScore >= 70;
      const sellBecauseFund = fundamental.qualityScore < 40;
      if (sellBecauseNews || sellBecauseFund) {
        action = 'SELL';
        reasonsFor.push('Teknisk trend är negativ', sellBecauseNews ? 'Negativt nyhetssentiment med hög vikt' : 'Svag fundamental kvalitet');
      } else if (existingMarket > positionCap || risk.riskLevel === 'VERY_HIGH') {
        action = 'REDUCE';
        reasonsFor.push('Överskrider tillåten portföljandel eller väldigt hög risk');
      } else {
        action = 'HOLD';
      }
    } else {
      // not bearish
      if (existingMarket > positionCap || risk.riskLevel === 'VERY_HIGH') {
        action = 'REDUCE';
        reasonsFor.push('Överskrider tillåten portföljandel eller väldigt hög risk');
      } else {
        action = 'HOLD';
      }
    }
  } else {
    // Not owned: potential BUY or WATCH
    if (canBuy && allowedNotional > 100) {
      // also check available cash
      if (portfolio.availableCash >= 100) {
        action = 'BUY';
        reasonsFor.push('Stark teknisk och fundamental analys');
      } else {
        action = 'WATCH';
        reasonsAgainst.push('Otillräckligt tillgängligt kapital');
      }
    } else {
      // decide WATCH when interesting signals but not strong
      if (technical.momentumScore >= 50 || fundamental.qualityScore >= 50) {
        action = 'WATCH';
        reasonsAgainst.push('Signalernas styrka är inte tillräcklig för köp');
      } else {
        action = 'HOLD';
      }
    }
  }

  // Specific reduces for concentration or risk
  if (existingHolding && existingMarket > positionCap) {
    if (action !== 'SELL') action = 'REDUCE';
  }

  // Confidence mapping
  let confidence = Math.max(10, Math.min(95, score));

  // suggested quantity deterministic based on suggestedPositionPercent and current price
  const price = existingHolding ? existingHolding.currentPrice : (technical ? Math.max(1, Math.round((technical.momentumScore || 50) / 10) * 10) : 100);
  const suggestedNotional = portfolio.totalValue * suggestedPositionPercent;
  const suggestedQuantity = Math.max(0, Math.floor(suggestedNotional / price));

  // reasons against/for adjustments
  if (!risk.positionAllowed) reasonsAgainst.push('Riskmotorn tillåter inte positionen');
  if (news.sentiment === 'NEGATIVE') reasonsAgainst.push('Negativt nyhetssentiment');

  const simpleSummary = `${action} ${symbol} — ${confidence}%`;

  const decision = {
    id: makeId(symbol),
    symbol,
    assetName: existingHolding ? existingHolding.name : symbol,
    action,
    confidence,
    riskLevel: risk.riskLevel,
    suggestedPositionPercent,
    suggestedQuantity,
    simpleSummary,
    whatHappened: technical.summary || '',
    whatItMeans: fundamental.summary || '',
    whatAtlasWillDo: action === 'BUY' ? 'Föreslår köp via PaperTradingEngine' : action === 'SELL' ? 'Föreslår försäljning' : 'Ingen handel föreslås',
    reasonsFor,
    reasonsAgainst,
    invalidationConditions,
    createdAt: nowIso(),
  } as CoachDecision;

  return decision;
}

export default dailyDecisionEngine;
