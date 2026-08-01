export type Holding = {
  id: string;
  symbol: string;
  name: string;
  assetType: 'Stock' | 'ETF' | 'Crypto' | 'Bond' | 'Forex' | 'Commodity';
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  portfolioWeight: number;
  riskLevel?: string;
}

export type Portfolio = {
  id: string;
  baseCurrency: string;
  totalValue: number;
  availableCash: number;
  totalReturnPercent: number;
  benchmarkReturnPercent: number;
  largestRisk?: string;
  estimatedRisk?: string;
  holdings: Holding[];
}
