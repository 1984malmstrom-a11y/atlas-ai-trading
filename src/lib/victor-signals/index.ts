export type SignalOrigin = 'MARKET_QUOTES_AGGREGATE'|'SYMBOL_PRICE_SERIES'|'VOLATILITY_SERIES'|'DATA_QUALITY_SOURCE';

export type Signal = {
  id: string;
  type: 'MARKET_BREADTH'|'MARKET_TREND'|'LEADER'|'LAGGARD'|'VOLATILITY'|'DATA_QUALITY'|'TECHNICAL_MOMENTUM';
  origin: SignalOrigin;
  // Optional, only provided for technically-derived signals to state direction
  direction?: 'BULLISH'|'BEARISH'|'NEUTRAL';
  severity: 'INFO'|'WATCH'|'IMPORTANT';
  title: string;
  description: string;
  symbols: string[];
  evidence: any;
};

export function buildMarketSignals(context:any, analysis:any){
  const signals: Signal[] = [];
  const warnings = new Set<string>();

  const summary = context.summary || { instrumentCount:0, advancing:0, declining:0, unchanged:0, unavailable:0, averageChangePercent:0 };
  const { instrumentCount, advancing, declining, unavailable } = summary;

  const advPct = instrumentCount > 0 ? (advancing / instrumentCount) * 100 : 0;
  const decPct = instrumentCount > 0 ? (declining / instrumentCount) * 100 : 0;

  // MARKET_BREADTH
  if (decPct >= 70){
    signals.push({ id: 'breadth-declining-70', type: 'MARKET_BREADTH', origin: 'MARKET_QUOTES_AGGREGATE', severity: 'IMPORTANT', title: 'Bredd: Starkt fall', description: 'Majoriteten faller', symbols: [], evidence: { declining, instrumentCount, decliningPercent: Number(decPct.toFixed(1)) } });
  } else if (declining > advancing){
    signals.push({ id: 'breadth-declining-more', type: 'MARKET_BREADTH', origin: 'MARKET_QUOTES_AGGREGATE', severity: 'WATCH', title: 'Bredd: Fler faller', description: 'Fler aktier faller än stiger', symbols: [], evidence: { advancing, declining } });
  }
  if (advPct >= 70){
    signals.push({ id: 'breadth-advancing-70', type: 'MARKET_BREADTH', origin: 'MARKET_QUOTES_AGGREGATE', severity: 'IMPORTANT', title: 'Bredd: Starkt upp', description: 'Majoriteten stiger', symbols: [], evidence: { advancing, instrumentCount, advancingPercent: Number(advPct.toFixed(1)) } });
  }

  // MARKET_TREND
  if (analysis.marketSentiment === 'BEARISH' && analysis.marketStrength < 35){
    signals.push({ id: 'trend-bearish-weak', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', severity: 'IMPORTANT', title: 'Trend: Svag nedgång', description: 'Bearish och svag marknad', symbols: [], evidence: { marketSentiment: analysis.marketSentiment, marketStrength: analysis.marketStrength } });
  } else if (analysis.marketSentiment === 'BULLISH' && analysis.marketStrength > 65){
    signals.push({ id: 'trend-bullish-strong', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', severity: 'IMPORTANT', title: 'Trend: Stark uppgång', description: 'Bullish och stark marknad', symbols: [], evidence: { marketSentiment: analysis.marketSentiment, marketStrength: analysis.marketStrength } });
  } else if (analysis.marketSentiment === 'NEUTRAL'){
    signals.push({ id: 'trend-neutral', type: 'MARKET_TREND', origin: 'MARKET_QUOTES_AGGREGATE', severity: 'INFO', title: 'Trend: Neutral', description: 'Ingen tydlig trend', symbols: [], evidence: { marketSentiment: analysis.marketSentiment } });
  }

  // LEADER
  if (analysis.strongest && typeof analysis.strongest.changePercent === 'number' && analysis.strongest.changePercent >= 1){
    signals.push({ id: 'leader-1', type: 'LEADER', origin: 'MARKET_QUOTES_AGGREGATE', severity: 'INFO', title: 'Ledare', description: 'Starkast utveckling', symbols: [analysis.strongest.symbol], evidence: { symbol: analysis.strongest.symbol, changePercent: analysis.strongest.changePercent } });
  }

  // LAGGARD
  if (analysis.weakest && typeof analysis.weakest.changePercent === 'number' && analysis.weakest.changePercent <= -1){
    const sev: Signal['severity'] = analysis.weakest.changePercent <= -2 ? 'IMPORTANT' : 'WATCH';
    signals.push({ id: 'laggard-1', type: 'LAGGARD', origin: 'MARKET_QUOTES_AGGREGATE', severity: sev, title: 'Efterhängare', description: 'Svagast utveckling', symbols: [analysis.weakest.symbol], evidence: { symbol: analysis.weakest.symbol, changePercent: analysis.weakest.changePercent } });
  }

  // VOLATILITY
  if (analysis.volatility === 'HIGH'){
    signals.push({ id: 'vol-high', type: 'VOLATILITY', origin: 'MARKET_QUOTES_AGGREGATE', severity: 'IMPORTANT', title: 'Volatilitet: Hög', description: 'Stor spridning i utveckling', symbols: [], evidence: { volatility: analysis.volatility } });
  } else if (analysis.volatility === 'NORMAL'){
    signals.push({ id: 'vol-normal', type: 'VOLATILITY', origin: 'MARKET_QUOTES_AGGREGATE', severity: 'INFO', title: 'Volatilitet: Normal', description: 'Normal spridning', symbols: [], evidence: { volatility: analysis.volatility } });
  }

  // DATA_QUALITY (single signals, avoid duplicates)
  const dqHandled = new Set<string>();
  if (context.warnings && context.warnings.some((w:string)=>/fördröj|delayed/i.test(w))){
    dqHandled.add('delayed');
    signals.push({ id: 'dq-delayed', type: 'DATA_QUALITY', origin: 'DATA_QUALITY_SOURCE', severity: 'INFO', title: 'Data: Fördröjd', description: 'Marknadsdata är fördröjd', symbols: [], evidence: { warnings: context.warnings } });
  }
  if (context.instruments && context.instruments.some((i:any)=> i.dataStatus === 'STALE')){
    dqHandled.add('stale');
    signals.push({ id: 'dq-stale', type: 'DATA_QUALITY', origin: 'DATA_QUALITY_SOURCE', severity: 'IMPORTANT', title: 'Data: Stale', description: 'STALE data upptäckt', symbols: context.instruments.filter((i:any)=>i.dataStatus==='STALE').map((i:any)=>i.symbol).filter(Boolean), evidence: { staleSymbols: context.instruments.filter((i:any)=>i.dataStatus==='STALE').map((i:any)=> ({ symbol: i.symbol, marketTimestamp: i.marketTimestamp })) } });
  }
  if ((context.marketDataStatus === 'PARTIAL' || (context.summary && context.summary.unavailable > 0)) && !dqHandled.has('partial')){
    signals.push({ id: 'dq-partial', type: 'DATA_QUALITY', origin: 'DATA_QUALITY_SOURCE', severity: 'WATCH', title: 'Data: Partiell täckning', description: 'Delvis marknadstäckning', symbols: [], evidence: { unavailable: context.summary ? context.summary.unavailable : 0 } });
  }

  // Confidence calculation (single adjustments, avoid double-counting)
  let confidence = 100;
  const hasDelayed = (context.marketDataStatus === 'DELAYED') || (context.warnings && context.warnings.some((w:string)=>/fördröj|delayed/i.test(w)));
  const hasPartial = (context.marketDataStatus === 'PARTIAL') || (context.summary && context.summary.unavailable > 0);
  const hasStale = context.instruments && context.instruments.some((i:any)=> i.dataStatus === 'STALE');
  const isUnavailable = context.marketDataStatus === 'UNAVAILABLE';

  if (isUnavailable){
    confidence = 0;
  } else {
    if (hasDelayed) confidence -= 10;
    if (hasPartial) confidence -= 25;
    if (hasStale) confidence -= 40;
  }

  if (confidence < 0) confidence = 0;
  if (confidence > 100) confidence = 100;

  return { generatedAt: new Date().toISOString(), confidence, signals, warnings: Array.from(warnings) };
}

export default buildMarketSignals;
