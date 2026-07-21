import { Holding } from '../domain/portfolio/types';

export function getMockHoldings(): Holding[]{
  return [
    { id: 'h1', symbol: 'AAPL', name: 'Apple Inc', assetType: 'Stock', quantity: 50, averagePrice: 150, currentPrice: 172.3, marketValue: 8615, unrealizedPnl: 1115, unrealizedPnlPercent: 0.148, portfolioWeight: 0.086, riskLevel: 'Medel' },
    { id: 'h2', symbol: 'TSLA', name: 'Tesla', assetType: 'Stock', quantity: 10, averagePrice: 700, currentPrice: 725.5, marketValue: 7255, unrealizedPnl: 255, unrealizedPnlPercent: 0.035, portfolioWeight: 0.072, riskLevel: 'Hög' },
    { id: 'h3', symbol: 'NVDA', name: 'Nvidia', assetType: 'Stock', quantity: 5, averagePrice: 420, currentPrice: 460.1, marketValue: 2300.5, unrealizedPnl: 200.5, unrealizedPnlPercent: 0.096, portfolioWeight: 0.023, riskLevel: 'Hög' },
    { id: 'h4', symbol: 'MSFT', name: 'Microsoft', assetType: 'Stock', quantity: 20, averagePrice: 300, currentPrice: 315.5, marketValue: 6310, unrealizedPnl: 310, unrealizedPnlPercent: 0.056, portfolioWeight: 0.063, riskLevel: 'Låg' }
  ];
}
