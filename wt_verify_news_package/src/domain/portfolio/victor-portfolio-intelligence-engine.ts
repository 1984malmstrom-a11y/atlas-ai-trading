export type PortfolioHolding = {
  symbol: string;
  companyName?: string;
  quantity: number;
  averagePrice?: number;
  currentPrice?: number;
  currency?: string;
  sector?: string;
  country?: string;
  assetType?: string;
  portfolioWeight?: number; // optional, normalized if missing
};

export type PortfolioSnapshot = {
  holdings: PortfolioHolding[];
  totalValue?: number;
  cashValue?: number;
  baseCurrency?: string;
  capturedAt?: string;
};

export type PortfolioExposure = {
  name: string;
  value: number;
  percentage: number;
  holdingCount: number;
};

export type CorrelatedHoldingGroup = {
  symbols: string[];
  reason: string;
  overlapScore: number;
  riskLevel: 'Low' | 'Medium' | 'High';
};

export type PortfolioIntelligenceReport = {
  totalValue: number;
  holdingsCount: number;
  cashPercentage: number;
  largestHolding?: PortfolioHolding;
  largestHoldingWeight: number;
  sectorExposure: PortfolioExposure[];
  countryExposure: PortfolioExposure[];
  assetTypeExposure: PortfolioExposure[];
  concentrationScore: number; // 0-100 (high is good)
  diversificationScore: number; // 0-100
  portfolioRiskScore: number; // 0-100 (high = risky)
  profileAlignmentScore: number; // 0-100
  correlatedHoldings: CorrelatedHoldingGroup[];
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  recommendations: string[];
  summary: string;
  generatedAt: string;
};

import { VictorMemoryContext } from '../memory/victor-memory-engine';

function clamp(n:number, a=0, b=100){ return Math.max(a, Math.min(b, n)); }

export async function analyzePortfolio(snapshot: PortfolioSnapshot | undefined, opts?: { investorProfile?: any; memoryContext?: VictorMemoryContext }): Promise<PortfolioIntelligenceReport>{
  const generatedAt = new Date().toISOString();
  if (!snapshot || !Array.isArray(snapshot.holdings) || snapshot.holdings.length === 0){
    return {
      totalValue: 0,
      holdingsCount: 0,
      cashPercentage: 0,
      largestHolding: undefined,
      largestHoldingWeight: 0,
      sectorExposure: [],
      countryExposure: [],
      assetTypeExposure: [],
      concentrationScore: 100,
      diversificationScore: 100,
      portfolioRiskScore: 0,
      profileAlignmentScore: 100,
      correlatedHoldings: [],
      strengths: [],
      weaknesses: [],
      risks: [],
      recommendations: ['Din portfölj är tom. Lägg till ett innehav för analys.'],
      summary: 'Tom portfölj',
      generatedAt,
    };
  }

  // compute values and normalize weights
  type LocalHolding = PortfolioHolding & { __value?: number };
  const holdings: LocalHolding[] = snapshot.holdings.map(h=>({ ...h } as LocalHolding));
  // compute current value per holding
  holdings.forEach(h=>{
    const price = (typeof h.currentPrice === 'number') ? h.currentPrice : (h.averagePrice ?? 0);
    h.__value = (h.quantity || 0) * (price || 0);
  });
  const rawTotal = holdings.reduce((s,h)=> s + (h.__value || 0), 0);
  const cash = typeof snapshot.cashValue === 'number' ? snapshot.cashValue : 0;
  const totalValue = (typeof snapshot.totalValue === 'number' && snapshot.totalValue > 0) ? snapshot.totalValue : rawTotal + cash;
  // avoid zero division
  const normTotal = totalValue > 0 ? totalValue : 1;

  holdings.forEach(h=>{
    const val = h.__value || 0;
    h.portfolioWeight = typeof h.portfolioWeight === 'number' && h.portfolioWeight > 0 ? h.portfolioWeight : (val / normTotal);
  });

  const holdingsCount = holdings.length;

  // exposures
  const exposureMap = (key:string)=>{
    const map = new Map<string, { value:number, count:number }>();
    holdings.forEach(h=>{
      const name = (h as any)[key] || 'Unknown';
      const val = h.__value || 0;
      const e = map.get(name) || { value: 0, count: 0 };
      e.value += val; e.count += 1; map.set(name, e);
    });
    const arr: PortfolioExposure[] = [];
    for(const [name, v] of map.entries()) arr.push({ name, value: v.value, percentage: Math.round((v.value / normTotal) * 10000) / 100, holdingCount: v.count });
    arr.sort((a,b)=> b.value - a.value);
    return arr;
  };

  const sectorExposure = exposureMap('sector');
  const countryExposure = exposureMap('country');
  const assetTypeExposure = exposureMap('assetType');

  // largest holding
  const sortedByWeight = holdings.slice().sort((a,b)=> (b.portfolioWeight || 0) - (a.portfolioWeight || 0));
  const largest = sortedByWeight[0];
  const largestWeight = largest ? Math.round((largest.portfolioWeight || 0) * 10000) / 100 : 0;

  // concentration warnings
  const highestWeight = largest ? (largest.portfolioWeight || 0) : 0;
  const concentrationScore = clamp(Math.round((1 - highestWeight) * 100));
  // diversification: more holdings and more sectors -> higher score
  const uniqueSectors = new Set(holdings.map(h=> h.sector || 'Unknown')).size;
  const diversificationScore = clamp(Math.round(Math.min(100, (holdingsCount * 5) + (uniqueSectors * 5))));

  // portfolioRiskScore: higher when concentration low & diversification low
  const portfolioRiskScore = clamp(Math.round(100 - ((concentrationScore * 0.6) + (diversificationScore * 0.4)) / 1));

  // profile alignment: compare investorProfile.riskTolerance (0-100) to portfolioRiskScore
  const riskTolerance = opts?.investorProfile?.riskTolerance;
  const profileAlignmentScore = typeof riskTolerance === 'number' ? clamp(100 - Math.abs(portfolioRiskScore - riskTolerance)) : 50;

  // correlated holdings mock logic
  const groups: CorrelatedHoldingGroup[] = [];
  const visited = new Set<string>();
  for(let i=0;i<holdings.length;i++){
    const a = holdings[i];
    const group: string[] = [a.symbol];
    let score = 0;
    for(let j=i+1;j<holdings.length;j++){
      const b = holdings[j];
      let s = 0;
      if (a.sector && b.sector && a.sector === b.sector) s += 1.0;
      if (a.country && b.country && a.country === b.country) s += 0.8;
      if (a.assetType && b.assetType && a.assetType === b.assetType) s += 0.5;
      if (s > 0){ group.push(b.symbol); score += s; }
    }
    if (group.length >= 2){
      const overlapScore = Math.round(score * 100) / 100;
      const riskLevel = overlapScore >= 2 ? 'High' : overlapScore >= 1 ? 'Medium' : 'Low';
      groups.push({ symbols: Array.from(new Set(group)), reason: 'Mock overlap: sector/country/assetType', overlapScore, riskLevel });
    }
  }

  // strengths/weaknesses/risks/recommendations (basic heuristics)
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (largestWeight > 25) risks.push(`Starkt koncentrerat innehav: ${largest.symbol} utgör ${largestWeight}%`);
  else if (largestWeight > 15) risks.push(`Förhöjd koncentration i ${largest.symbol}: ${largestWeight}%`);

  const topSector = sectorExposure[0];
  if (topSector && topSector.percentage > 50) risks.push(`Hög sektorsexponering mot ${topSector.name}: ${topSector.percentage}%`);
  else if (topSector && topSector.percentage > 35) risks.push(`Förhöjd sektorsrisk mot ${topSector.name}: ${topSector.percentage}%`);

  if (diversificationScore < 40) weaknesses.push('Låg diversifiering');
  if ((cash / normTotal) > 0.5) weaknesses.push('Hög kontantandel');

  if (portfolioRiskScore > 70) recommendations.push('Överväg att minska exponering mot stora innehav och sprida risker över fler sektorer.');
  if (portfolioRiskScore <= 70 && portfolioRiskScore > 40) recommendations.push('Portföljen ser måttligt riskfylld ut; finjustera viktning efter profil.');
  if (portfolioRiskScore <= 40) strengths.push('Portföljen visar låg risknivå baserat på enkel heuristik.');

  // memoryContext nudges (conservative)
  if (opts?.memoryContext){
    const mem = opts.memoryContext;
    if (mem.symbolAnalysisCount && mem.symbolAnalysisCount > 5) recommendations.push('Victor har historik för detta värdepapper — använd historiska utfall med försiktighet.');
  }

  const summary = `Automatisk portföljanalys genererad av Victor.`;

  return {
    totalValue: Math.round(totalValue * 100) / 100,
    holdingsCount,
    cashPercentage: Math.round((cash / normTotal) * 10000) / 100,
    largestHolding: largest ? { ...largest } : undefined,
    largestHoldingWeight: Math.round(largestWeight * 100) / 100,
    sectorExposure,
    countryExposure,
    assetTypeExposure,
    concentrationScore: clamp(concentrationScore),
    diversificationScore: clamp(diversificationScore),
    portfolioRiskScore: clamp(portfolioRiskScore),
    profileAlignmentScore: clamp(profileAlignmentScore),
    correlatedHoldings: groups,
    strengths,
    weaknesses,
    risks,
    recommendations,
    summary,
    generatedAt,
  };
}

export default analyzePortfolio;
