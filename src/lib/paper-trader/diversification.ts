import { calculatePortfolioExposure } from './portfolio-exposure';
import type { PortfolioSnapshot } from './risk-engine';

export type Diversification = {
  holdingCount: number;
  concentrationScore: number; // 0-100
  isConcentrated: boolean;
};

export function calculateDiversification(portfolio: PortfolioSnapshot): Diversification {
  if (!portfolio || !Number.isFinite(portfolio.totalValue) || portfolio.totalValue <= 0) {
    return { holdingCount: 0, concentrationScore: 100, isConcentrated: false };
  }

  const exposure = calculatePortfolioExposure(portfolio);

  // Count holdings with marketValue>0
  const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];
  let holdingCount = 0;
  for (const h of holdings) {
    let mv = 0;
    if (h.marketValue !== undefined && Number.isFinite(h.marketValue) && h.marketValue > 0) mv = h.marketValue;
    else if (h.quantity !== undefined && h.currentPrice !== undefined && Number.isFinite(h.quantity) && Number.isFinite(h.currentPrice) && h.quantity > 0 && h.currentPrice > 0) mv = h.quantity * h.currentPrice;
    if (mv > 0) holdingCount++;
  }

  const largestPercent = exposure.largestHoldingPercent; // 0-1
  // concentrationScore = 100 - (largestHoldingPercent * 100)
  let concentrationScore = 100 - (largestPercent * 100);
  if (!Number.isFinite(concentrationScore)) concentrationScore = 0;
  if (concentrationScore < 0) concentrationScore = 0;
  if (concentrationScore > 100) concentrationScore = 100;

  const isConcentrated = (largestPercent * 100) > 35;

  return { holdingCount, concentrationScore, isConcentrated };
}

export default {} as any;
