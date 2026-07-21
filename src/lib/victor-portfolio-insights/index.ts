export default function buildPortfolioInsights({ marketAnalysis, marketSignals, portfolioContext }: any){
  const now = new Date().toISOString();
  const signals = (marketSignals && Array.isArray(marketSignals.signals)) ? marketSignals.signals : [];
  const holdings = Array.isArray(portfolioContext?.holdings) ? portfolioContext.holdings : [];
  const sectorExposure = Array.isArray(portfolioContext?.sectorExposure) ? portfolioContext.sectorExposure : [];
  const unavailable = Array.isArray(portfolioContext?.unavailableHoldings) ? portfolioContext.unavailableHoldings : [];

  const holdingsBySymbol = new Map<string, any>();
  for(const h of holdings){ if (h && h.symbol) holdingsBySymbol.set(String(h.symbol).toUpperCase(), h); }

  // Warnings
  const warningsSet = new Set<string>();
  if(unavailable.length) warningsSet.add('Unavailable holdings: ' + unavailable.map((u:any)=>u.symbol||u).filter(Boolean).join(', '));
  const invalidWeights = holdings.filter((h:any)=> !isFinite(Number(h?.portfolioWeight)) || Number(h?.portfolioWeight) <= 0 ).map((h:any)=> h.symbol || h.instrumentId);
  if(invalidWeights.length) warningsSet.add('Invalid portfolio weights: ' + invalidWeights.join(', '));

  // Signals referencing unknown symbols
  const unknownSignalSymbols = new Set<string>();
  for(const s of signals){
    const syms = Array.isArray(s.symbols) ? s.symbols : (s.symbol ? [s.symbol] : []);
    for(const sym of syms){ if (!holdingsBySymbol.has(String(sym).toUpperCase())) unknownSignalSymbols.add(String(sym)); }
  }
  if(unknownSignalSymbols.size) warningsSet.add('Signals reference unknown symbols: ' + Array.from(unknownSignalSymbols).join(', '));

  // Affected holdings: match LEADER or LAGGARD
  const affectedMap = new Map<string, any>();
  const sevRank = (sev:string|undefined)=> sev==='IMPORTANT'?3: sev==='WATCH'?2:1;
  for(const s of signals.filter((x:any)=> x.type === 'LEADER' || x.type === 'LAGGARD')){
    const type = s.type;
    const severity = s.severity || 'INFO';
    const syms = Array.isArray(s.symbols) && s.symbols.length ? s.symbols : (s.evidence?.symbol ? [s.evidence.symbol] : []);
    for(const sym of syms){
      const key = String(sym).toUpperCase();
      const h = holdingsBySymbol.get(key);
      if(!h) continue;
      const existing = affectedMap.get(key);
      const candidate = {
        instrumentId: h.instrumentId || null,
        symbol: h.symbol,
        name: h.name || null,
        portfolioWeight: Number(h.portfolioWeight) || 0,
        profitLossPercent: isFinite(Number(h.profitLossPercent)) ? Number(h.profitLossPercent) : (isFinite(Number(h.profitLoss)) ? Number(h.profitLoss) : NaN),
        signalType: type,
        signalSeverity: severity,
        changePercent: Number(s.evidence?.changePercent) || null,
        impact: type === 'LEADER' ? 'POSITIVE' : 'NEGATIVE',
      };
      if(!existing) affectedMap.set(key, candidate);
      else{
        // choose one with higher severity or higher portfolioWeight
        const choose = (a:any,b:any)=>{
          const ra = sevRank(a.signalSeverity); const rb = sevRank(b.signalSeverity);
          if(ra !== rb) return ra>rb? a:b;
          return (a.portfolioWeight||0) >= (b.portfolioWeight||0) ? a:b;
        };
        affectedMap.set(key, choose(existing, candidate));
      }
    }
  }

  let affectedHoldings = Array.from(affectedMap.values());
  // sort: IMPORTANT>WATCH>INFO, then by portfolioWeight desc
  affectedHoldings.sort((a,b)=>{
    const r = sevRank(b.signalSeverity) - sevRank(a.signalSeverity);
    if(r!==0) return r;
    return (b.portfolioWeight||0) - (a.portfolioWeight||0);
  });

  // Exposure insights: sectors over thresholds
  const exposureInsights: any[] = [];
  for(const s of sectorExposure){
    const pw = Number(s.portfolioWeight) || 0;
    let severity: 'HIGH'|'MODERATE'|null = null;
    if(pw > 50) severity = 'HIGH';
    else if(pw > 35) severity = 'MODERATE';
    if(severity){
      exposureInsights.push({
        sector: s.sector,
        portfolioWeight: Number(Number(pw).toFixed(2)),
        holdingsCount: Number(s.holdingsCount) || 0,
        severity,
        title: severity === 'HIGH' ? `Hög koncentration: ${s.sector}` : `Sektorexponering: ${s.sector}`,
        description: `${s.sector} utgör ${Math.round(pw)}% av portföljen.`,
      });
    }
  }

  // Portfolio insights
  const insights: any[] = [];
  const pushUnique = (ins:any)=>{ if(!insights.some(x=> x.id === ins.id)) insights.push(ins); };

  // 1 & 2 & 3: per holding signals
  for(const h of affectedHoldings){
    if(h.signalType === 'LAGGARD'){
      const sev = h.signalSeverity === 'IMPORTANT' ? 'HIGH' : 'MODERATE';
      pushUnique({ id: `pi-HOLDING_PRESSURE-${h.symbol}-${sev}`, type: 'HOLDING_PRESSURE', severity: sev, title: `Press på innehav ${h.symbol}`, description: ` ${h.symbol} visar svag utveckling.`, symbols: [h.symbol], evidence: { symbol: h.symbol, portfolioWeight: h.portfolioWeight } });
    }
    if(h.signalType === 'LEADER'){
      const sev = h.signalSeverity === 'IMPORTANT' ? 'MODERATE' : 'LOW';
      pushUnique({ id: `pi-HOLDING_STRENGTH-${h.symbol}-${sev}`, type: 'HOLDING_STRENGTH', severity: sev, title: `Styrka i innehav ${h.symbol}`, description: `${h.symbol} är en av portföljens starkare innehav.`, symbols: [h.symbol], evidence: { symbol: h.symbol, portfolioWeight: h.portfolioWeight } });
    }
  }

  // 4: sector concentration
  for(const e of exposureInsights){
    pushUnique({ id: `pi-SECTOR_CONC-${e.sector}-${e.severity}`, type: 'SECTOR_CONCENTRATION', severity: e.severity, title: e.title, description: e.description, symbols: [], evidence: { sector: e.sector, portfolioWeight: e.portfolioWeight } });
  }

  // 5: portfolio concentration
  const concLevel = String(portfolioContext?.concentration?.level || '').toUpperCase();
  if(concLevel === 'MODERATE' || concLevel === 'HIGH'){
    const sev = concLevel === 'HIGH' ? 'HIGH' : 'MODERATE';
    pushUnique({ id: `pi-PORTFOLIO_CONC-${sev}`, type: 'PORTFOLIO_CONCENTRATION', severity: sev, title: `Portföljkoncentration: ${concLevel}`, description: `Portföljen är ${concLevel.toLowerCase()} koncentrerad.`, symbols: [], evidence: { concentration: portfolioContext?.concentration } });
  }

  // 6: data gap
  if(Array.isArray(unavailable) && unavailable.length){
    pushUnique({ id: `pi-DATA_GAP-1`, type: 'DATA_GAP', severity: 'MODERATE', title: 'Data saknas', description: `Det finns ${unavailable.length} innehav utan tillgänglig marknadsdata.`, symbols: unavailable.map((u:any)=> u.symbol || u), evidence: { unavailable } });
  }

  // Limit to 2-5 insights, deterministic order: pressure, strength, sector, portfolio, data_gap
  const order = { 'HOLDING_PRESSURE':1, 'HOLDING_STRENGTH':2, 'SECTOR_CONCENTRATION':3, 'PORTFOLIO_CONCENTRATION':4, 'DATA_GAP':5 } as any;
  insights.sort((a:any,b:any)=>{ const r = (order[a.type]||99) - (order[b.type]||99); if(r!==0) return r; return (b.severity === 'HIGH'?3: b.severity==='MODERATE'?2:1) - (a.severity === 'HIGH'?3: a.severity==='MODERATE'?2:1); });

  const portfolioInsights = insights.slice(0,5);

  // Final risk level
  const importantLaggards = affectedHoldings.filter((h:any)=> h.signalType==='LAGGARD' && h.signalSeverity==='IMPORTANT').length;
  const largestSector = sectorExposure.length ? (Number(sectorExposure[0].portfolioWeight) || 0) : 0;
  let riskLevel: 'LOW'|'MODERATE'|'HIGH' = 'LOW';
  if(portfolioContext?.concentration?.level === 'HIGH' || importantLaggards >= 2 || largestSector > 50) riskLevel = 'HIGH';
  else if(portfolioContext?.concentration?.level === 'MODERATE' || importantLaggards === 1 || largestSector > 35) riskLevel = 'MODERATE';
  else riskLevel = 'LOW';

  return {
    generatedAt: now,
    riskLevel,
    affectedHoldings,
    exposureInsights,
    portfolioInsights,
    warnings: Array.from(warningsSet),
  };
}

export { buildPortfolioInsights as buildPortfolioInsights };
