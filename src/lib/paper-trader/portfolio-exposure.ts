import type { PortfolioSnapshot } from './risk-engine';

export type PortfolioExposure = {
  largestHoldingPercent: number; // 0-1
  totalInvestedPercent: number; // 0-1
  cashPercent: number; // 0-1
};

export function calculatePortfolioExposure(portfolio: PortfolioSnapshot): PortfolioExposure {
  if (!portfolio || !Number.isFinite(portfolio.totalValue) || portfolio.totalValue <= 0) {
    return { largestHoldingPercent: 0, totalInvestedPercent: 0, cashPercent: 0 };
  }

  const total = portfolio.totalValue;

  const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];

  let totalInvested = 0;
  let largest = 0;

  for (const h of holdings) {
    let mv = 0;
    if (h.marketValue !== undefined) {
      if (Number.isFinite(h.marketValue) && h.marketValue > 0) mv = h.marketValue;
    } else if (h.quantity !== undefined && h.currentPrice !== undefined) {
      if (Number.isFinite(h.quantity) && Number.isFinite(h.currentPrice) && h.quantity > 0 && h.currentPrice > 0) {
        mv = h.quantity * h.currentPrice;
      }
    }
    if (!Number.isFinite(mv) || mv < 0) mv = 0;
    totalInvested += mv;
    if (mv > largest) largest = mv;
  }

  const availableCash = Number.isFinite(portfolio.availableCash) && portfolio.availableCash > 0 ? portfolio.availableCash : 0;

  const largestHoldingPercent = total > 0 ? (largest / total) : 0;
  const totalInvestedPercent = total > 0 ? (totalInvested / total) : 0;
  const cashPercent = total > 0 ? (availableCash / total) : 0;

  return { largestHoldingPercent, totalInvestedPercent, cashPercent };
}

export default {} as any;
