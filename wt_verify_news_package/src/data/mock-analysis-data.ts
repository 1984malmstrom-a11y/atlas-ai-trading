// All data below is mockdata for local demo purposes only.
import { TechnicalAnalysis, FundamentalAnalysis, NewsAnalysis, RiskAssessment } from '../domain/analysis/types';

export const mockTechnical: TechnicalAnalysis[] = [
  { symbol: 'INVB', trend: 'NEUTRAL', momentumScore: 45, volumeScore: 40, volatilityScore: 30, movingAverageSignal: 'NEUTRAL', summary: 'Investor B visar måttlig aktivitet' },
  { symbol: 'VOLV-B', trend: 'NEUTRAL', momentumScore: 52, volumeScore: 50, volatilityScore: 40, movingAverageSignal: 'NEUTRAL', summary: 'Volvo stabil efter rapport' },
  { symbol: 'MSFT', trend: 'BULLISH', momentumScore: 70, volumeScore: 65, volatilityScore: 30, movingAverageSignal: 'BUY', summary: 'Microsoft visar styrka i momentum' },
  { symbol: 'GLOBAL-ETF', trend: 'NEUTRAL', momentumScore: 50, volumeScore: 45, volatilityScore: 20, movingAverageSignal: 'NEUTRAL', summary: 'Global ETF lugn' },
  { symbol: 'NEW-ASSET', trend: 'BULLISH', momentumScore: 62, volumeScore: 60, volatilityScore: 25, movingAverageSignal: 'BUY', summary: 'Ny tillgång visar möjlig köpmöjlighet' },
];

export const mockFundamental: FundamentalAnalysis[] = [
  { symbol: 'INVB', qualityScore: 55, valuationScore: 60, growthScore: 50, debtScore: 30, summary: 'Investor B har stabil grund' },
  { symbol: 'VOLV-B', qualityScore: 58, valuationScore: 55, growthScore: 52, debtScore: 45, summary: 'Volvo har måttlig kvalitet' },
  { symbol: 'MSFT', qualityScore: 82, valuationScore: 70, growthScore: 80, debtScore: 20, summary: 'Microsoft hög kvalitet och tillväxt' },
  { symbol: 'GLOBAL-ETF', qualityScore: 65, valuationScore: 68, growthScore: 50, debtScore: 10, summary: 'Brett globalt innehav' },
  { symbol: 'NEW-ASSET', qualityScore: 65, valuationScore: 60, growthScore: 55, debtScore: 10, summary: 'Ny tillgång med ok fundamental profil' },
];

export const mockNews: NewsAnalysis[] = [
  { symbol: 'INVB', sentiment: 'NEUTRAL', importanceScore: 30, sourceConfidence: 60, alreadyPricedIn: false, summary: 'Ingen större nyhet' },
  { symbol: 'VOLV-B', sentiment: 'NEUTRAL', importanceScore: 40, sourceConfidence: 60, alreadyPricedIn: false, summary: 'Produktnyhet med blygsam effekt' },
  { symbol: 'MSFT', sentiment: 'POSITIVE', importanceScore: 60, sourceConfidence: 80, alreadyPricedIn: false, summary: 'Stark kvartalsrapport' },
  { symbol: 'GLOBAL-ETF', sentiment: 'NEUTRAL', importanceScore: 20, sourceConfidence: 50, alreadyPricedIn: true, summary: 'Marknaden stabil' },
  { symbol: 'NEW-ASSET', sentiment: 'NEUTRAL', importanceScore: 30, sourceConfidence: 50, alreadyPricedIn: false, summary: 'Nya data pekar åt positivt håll' },
];

export const mockRisk: RiskAssessment[] = [
  { symbol: 'INVB', riskLevel: 'MEDIUM', portfolioConcentration: 0.05, sectorExposure: 'Finance', currencyExposure: 'SEK', positionAllowed: true, reasons: [] },
  { symbol: 'VOLV-B', riskLevel: 'MEDIUM', portfolioConcentration: 0.06, sectorExposure: 'Automotive', currencyExposure: 'SEK', positionAllowed: true, reasons: [] },
  { symbol: 'MSFT', riskLevel: 'LOW', portfolioConcentration: 0.06, sectorExposure: 'Technology', currencyExposure: 'USD', positionAllowed: true, reasons: [] },
  { symbol: 'GLOBAL-ETF', riskLevel: 'LOW', portfolioConcentration: 0.02, sectorExposure: 'Multi', currencyExposure: 'USD', positionAllowed: true, reasons: [] },
  { symbol: 'NEW-ASSET', riskLevel: 'MEDIUM', portfolioConcentration: 0.0, sectorExposure: 'Technology', currencyExposure: 'USD', positionAllowed: true, reasons: [] },
];

const mockAnalysisData = { mockTechnical, mockFundamental, mockNews, mockRisk };
export default mockAnalysisData;
