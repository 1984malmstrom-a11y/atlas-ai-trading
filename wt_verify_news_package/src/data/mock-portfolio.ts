import { Portfolio } from '../domain/portfolio/types';
import { getMockHoldings } from './mock-holdings';

export function getMockPortfolio(): Portfolio{
  const holdings = getMockHoldings();
  const total = holdings.reduce((s, it)=> s + it.marketValue, 0) + 20000;
  return {
    id: 'demo', baseCurrency: 'USD', totalValue: total, availableCash: 20000,
    totalReturnPercent: 0.12, benchmarkReturnPercent: 0.08, largestRisk: 'Teknik', estimatedRisk: 'Medel', holdings
  }
}
