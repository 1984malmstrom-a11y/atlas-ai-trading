type Portfolio = {
  cash: number;
  holdings: Array<{
    instrumentId: string;
    symbol: string;
    name: string;
    quantity: number;
    averagePrice: number;
    sector?: string;
  }>;
};

export function buildPortfolioContext(portfolio: Portfolio, quotes: any[]){
  const generatedAt = new Date().toISOString();
  const currency = 'USD';

  const quotesById = new Map<string, any>();
  for (const q of quotes || []){ if (q && q.instrumentId) quotesById.set(q.instrumentId, q); }

  const holdingsDetailed = portfolio.holdings.map(h=>{
    const q = quotesById.get(h.instrumentId);
    const currentPrice = q && typeof q.price === 'number' ? q.price : null;
    const dataStatus = q && q.dataStatus ? q.dataStatus : (currentPrice===null ? 'UNAVAILABLE' : 'UNAVAILABLE');
    const marketValue = currentPrice !== null ? (h.quantity * currentPrice) : 0;
    const profitLoss = currentPrice !== null ? ((currentPrice - h.averagePrice) * h.quantity) : 0;
    const profitLossPercent = (currentPrice !== null && h.averagePrice !== 0) ? ((currentPrice - h.averagePrice) / h.averagePrice * 100) : 0;
    return {
      instrumentId: h.instrumentId,
      symbol: h.symbol,
      name: h.name,
      sector: h.sector || 'Other',
      quantity: h.quantity,
      averagePrice: h.averagePrice,
      currentPrice,
      marketValue,
      portfolioWeight: 0, // fill later
      profitLoss,
      profitLossPercent,
      dataStatus,
    };
  });

  const unavailableHoldings = holdingsDetailed.filter(h=> h.currentPrice === null).map(h=> h.instrumentId);

  // Exclude unavailable holdings from invested calculations
  const investedValue = holdingsDetailed.reduce((s,h)=> s + (h.currentPrice !== null ? h.marketValue : 0), 0);
  const cash = portfolio.cash || 0;
  const totalValue = cash + investedValue;

  // Avoid division by zero
  const cashPercent = totalValue > 0 ? (cash / totalValue * 100) : 0;

  const totalProfitLoss = holdingsDetailed.reduce((s,h)=> s + (h.currentPrice !== null ? h.profitLoss : 0), 0);
  const totalProfitLossPercent = investedValue > 0 ? (totalProfitLoss / investedValue * 100) : 0;

  // Fill portfolioWeight now that totalValue known
  for (const h of holdingsDetailed){
    h.portfolioWeight = totalValue > 0 ? (h.marketValue / totalValue * 100) : 0;
  }

  const holdingsCount = holdingsDetailed.length;

  // Concentration
  const available = holdingsDetailed.filter(h=> h.currentPrice !== null).slice().sort((a,b)=> b.marketValue - a.marketValue);
  const largestHolding = available.length > 0 ? { instrumentId: available[0].instrumentId, symbol: available[0].symbol, marketValue: available[0].marketValue, portfolioWeight: available[0].portfolioWeight } : null;
  const topThree = available.slice(0,3).reduce((s,h)=> s + h.marketValue, 0);
  const topThreePercent = totalValue > 0 ? (topThree / totalValue * 100) : 0;
  let level: 'LOW'|'MODERATE'|'HIGH' = 'LOW';
  const largestPercent = largestHolding ? largestHolding.portfolioWeight : 0;
  if (largestPercent < 20) level = 'LOW';
  else if (largestPercent <= 35) level = 'MODERATE';
  else level = 'HIGH';

  const concentration = { largestHolding, topThreePercent, level };

  // Sector exposure
  const sectorMap = new Map<string, { sector: string; marketValue: number; holdingsCount: number }>();
  for (const h of holdingsDetailed){
    if (h.currentPrice === null) continue; // exclude unavailable
    const s = sectorMap.get(h.sector) || { sector: h.sector, marketValue: 0, holdingsCount: 0 };
    s.marketValue += h.marketValue;
    s.holdingsCount += 1;
    sectorMap.set(h.sector, s);
  }
  const sectorExposure = Array.from(sectorMap.values()).map(s=> ({ sector: s.sector, marketValue: s.marketValue, portfolioWeight: totalValue > 0 ? (s.marketValue / totalValue * 100) : 0, holdingsCount: s.holdingsCount })).sort((a,b)=> b.marketValue - a.marketValue);

  return {
    generatedAt,
    currency,
    totalValue,
    cash,
    investedValue,
    cashPercent,
    totalProfitLoss,
    totalProfitLossPercent,
    holdingsCount,
    unavailableHoldings: unavailableHoldings,
    concentration,
    sectorExposure,
    holdings: holdingsDetailed,
  };
}

export default buildPortfolioContext;
