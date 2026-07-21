import { Portfolio } from './types';
import { getMockHoldings } from '../../data/mock-holdings';

// Domain service: synchronous provider of demo portfolio data.
export function getPortfolio(): Portfolio {
  const holdings = getMockHoldings();
  const total = holdings.reduce((s: number, it)=> s + it.marketValue, 0) + 20000;
  return {
    id: 'demo', baseCurrency: 'USD', totalValue: total, availableCash: 20000,
    totalReturnPercent: 0.12, benchmarkReturnPercent: 0.08, largestRisk: 'Teknik', estimatedRisk: 'Medel', holdings
  };
}
