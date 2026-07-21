interface MarketContext {
  generatedAt: string;
  marketDataStatus: string;
  summary: { instrumentCount: number; advancing: number; declining: number; unchanged: number; unavailable: number; averageChangePercent: number };
  instruments: Array<any>;
  warnings?: string[];
}

export function analyzeMarket(context: MarketContext){
  const { summary, instruments, warnings = [] } = context;
  const { instrumentCount, advancing, declining, unchanged, unavailable, averageChangePercent } = summary;

  // Market sentiment
  let marketSentiment: 'BULLISH'|'NEUTRAL'|'BEARISH' = 'NEUTRAL';
  if (advancing > declining && averageChangePercent > 0) marketSentiment = 'BULLISH';
  else if (declining > advancing && averageChangePercent < 0) marketSentiment = 'BEARISH';

  // Market strength 0-100
  const advDeclDiff = advancing - declining;
  const advDeclScore = instrumentCount > 0 ? (advDeclDiff / instrumentCount) : 0; // -1..1
  const avgScore = Math.max(-1, Math.min(1, averageChangePercent / 5)); // scale percent to -1..1 (5% -> 1)
  const availabilityPenalty = instrumentCount > 0 ? (unavailable / instrumentCount) : 0; // 0..1

  let rawStrength = 50 + (advDeclScore * 30) + (avgScore * 20) - (availabilityPenalty * 30);
  rawStrength = Math.round(Math.max(0, Math.min(100, rawStrength)));

  const marketStrength = rawStrength;

  // Breadth
  const breadth = {
    advancing,
    declining,
    unchanged,
    ratio: (advancing + declining) > 0 ? Number((advancing / (advancing + declining)).toFixed(2)) : 0.5,
  };

  // Volatility based on spread between strongest and weakest changePercent
  const valid = instruments.filter(i => i.changePercent !== null && i.changePercent !== undefined);
  const spread = valid.length > 0 ? (Math.max(...valid.map(v=>v.changePercent)) - Math.min(...valid.map(v=>v.changePercent))) : 0;
  // spread in percentage points (e.g., 3.5 means 3.5%)
  let volatility: 'LOW'|'NORMAL'|'HIGH' = 'NORMAL';
  if (Math.abs(spread) < 1) volatility = 'LOW';
  else if (Math.abs(spread) >= 3) volatility = 'HIGH';

  // strongest / weakest (use provided objects)
  const strongest = instruments.length > 0 ? instruments.find(i => i.changePercent === Math.max(...instruments.map(x=> (x.changePercent===null? -Infinity : x.changePercent)))) || null : null;
  const weakest = instruments.length > 0 ? instruments.find(i => i.changePercent === Math.min(...instruments.map(x=> (x.changePercent===null? Infinity : x.changePercent)))) || null : null;

  // Insights (short, structured, non-AI)
  const insights: string[] = [];
  if (advancing > declining) insights.push('Majoriteten av bevakade aktier stiger.');
  if (declining > advancing) insights.push('Majoriteten av bevakade aktier faller.');
  if (strongest && strongest.symbol) insights.push(`${strongest.symbol} är dagens starkaste innehav.`);
  if (weakest && weakest.symbol) insights.push(`${weakest.symbol} är dagens svagaste innehav.`);

  // Warnings mapping
  const outWarnings: string[] = [];
  if (warnings.some(w => /fördröj|delayed/i.test(w))) outWarnings.push('Market data delayed.');
  if (instruments.some((i:any)=> i.dataStatus === 'STALE')) outWarnings.push('Market data stale.');
  if (context.marketDataStatus === 'PARTIAL' || summary.unavailable > 0) outWarnings.push('Partial market coverage.');

  return {
    generatedAt: new Date().toISOString(),
    marketSentiment,
    marketStrength,
    breadth,
    volatility,
    strongest: strongest ? { instrumentId: strongest.instrumentId, symbol: strongest.symbol, name: strongest.name, changePercent: strongest.changePercent } : null,
    weakest: weakest ? { instrumentId: weakest.instrumentId, symbol: weakest.symbol, name: weakest.name, changePercent: weakest.changePercent } : null,
    insights,
    warnings: outWarnings,
  };
}

export default analyzeMarket;
