export type AnalysisScore = {
  id: string;
  symbol: string;
  score: number;
  reason?: string;
}

export type Trend = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export type MaSignal = 'BUY' | 'NEUTRAL' | 'SELL';

export type TechnicalAnalysis = {
  symbol: string;
  trend: Trend;
  momentumScore: number; // 0-100
  volumeScore: number; // 0-100
  volatilityScore: number; // 0-100
  movingAverageSignal: MaSignal;
  summary: string;
}

export type FundamentalAnalysis = {
  symbol: string;
  qualityScore: number; // 0-100
  valuationScore: number; // 0-100
  growthScore: number; // 0-100
  debtScore: number; // 0-100
  summary: string;
}

export type NewsSentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
export type NewsAnalysis = {
  symbol: string;
  sentiment: NewsSentiment;
  importanceScore: number; // 0-100
  sourceConfidence: number; // 0-100
  alreadyPricedIn: boolean;
  summary: string;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
export type RiskAssessment = {
  symbol: string;
  riskLevel: RiskLevel;
  portfolioConcentration: number; // fraction 0-1
  sectorExposure: string;
  currencyExposure: string;
  positionAllowed: boolean;
  reasons: string[];
}

export type DecisionAction = 'BUY' | 'SELL' | 'HOLD' | 'REDUCE' | 'WATCH';

export type CoachDecision = {
  id: string;
  symbol: string;
  assetName?: string;
  action: DecisionAction;
  confidence: number; // 0-100
  riskLevel: RiskLevel;
  suggestedPositionPercent: number; // 0-1
  suggestedQuantity: number;
  simpleSummary: string;
  whatHappened: string;
  whatItMeans: string;
  whatAtlasWillDo: string;
  reasonsFor: string[];
  reasonsAgainst: string[];
  invalidationConditions: string[];
  createdAt: string; // ISO
}
