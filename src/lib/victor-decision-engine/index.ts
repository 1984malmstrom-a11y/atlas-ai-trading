type Priority = 'LOW'|'MEDIUM'|'HIGH';

export function buildVictorDecision(opts:{ marketAnalysis?: any; marketSignals?: any; portfolioContext?: any }){
  const { marketAnalysis = {}, marketSignals = { signals: [], confidence: 100 }, portfolioContext = {} } = opts || {};

  const signals = Array.isArray(marketSignals.signals) ? marketSignals.signals : [];
  const concentrationLevel = portfolioContext.concentration?.level || 'LOW';

  // Priority rules
  const hasImportant = signals.some((s:any)=> s.severity === 'IMPORTANT' && ['MARKET_TREND','MARKET_BREADTH','LAGGARD'].includes(s.type));
  const hasLaggardImportant = signals.some((s:any)=> s.type === 'LAGGARD' && s.severity === 'IMPORTANT');
  const hasBreadthImportant = signals.some((s:any)=> s.type === 'MARKET_BREADTH' && s.severity === 'IMPORTANT');

  let priority: Priority = 'LOW';
  if (hasBreadthImportant || hasLaggardImportant || hasImportant || concentrationLevel === 'HIGH') priority = 'HIGH';
  else if (signals.some((s:any)=> s.severity === 'WATCH') || concentrationLevel === 'MODERATE') priority = 'MEDIUM';

  // Summary: single short Swedish sentence
  const sentiment = marketAnalysis.marketSentiment || 'neutral';
  const sentText = sentiment === 'BULLISH' ? 'stiger' : sentiment === 'BEARISH' ? 'faller' : 'är stabil';
  const concentrationText = concentrationLevel === 'HIGH' ? 'koncentrerad' : concentrationLevel === 'MODERATE' ? 'delvis koncentrerad' : 'diversifierad';
  const summary = `Marknaden ${sentText} och portföljen är ${concentrationText}.`;

  // Reasoning: 3-5 short deterministic points
  const reasoning: string[] = [];
  if (marketAnalysis.marketSentiment === 'BEARISH') reasoning.push('Majoriteten av bevakade aktier faller.');
  if (marketAnalysis.weakest && marketAnalysis.weakest.symbol) reasoning.push(`${marketAnalysis.weakest.symbol} är dagens svagaste innehav.`);
  if (concentrationLevel === 'HIGH') reasoning.push('Portföljen är starkt koncentrerad.');
  if (marketSignals && marketSignals.warnings && marketSignals.warnings.length) reasoning.push('Datakvalitet: fördröjd.');
  const reasoningTrim = reasoning.slice(0,5);

  // Actions: deterministic set based on signals and concentration
  const actions: Array<any> = [];
  const addAction = (id:string,type:'OBSERVE'|'REVIEW'|'DIVERSIFICATION',title:string,description:string, pr:Priority)=>{
    actions.push({ id, type, title, description, priority: pr });
  };

  // HIGH concentration -> DIVERSIFICATION
  if (concentrationLevel === 'HIGH') addAction('act-diversify-1','DIVERSIFICATION','Diversifiera portföljen','Överväg att sprida exponeringen över flera sektorer.', 'HIGH');

  // IMPORTANT trend -> OBSERVE
  if (signals.some((s:any)=> s.type==='MARKET_TREND' && s.severity==='IMPORTANT')) addAction('act-observe-trend','OBSERVE','Observera trenden','Följ marknadstrenden noggrant.', 'HIGH');

  // WATCH signals -> REVIEW
  if (signals.some((s:any)=> s.severity==='WATCH')) addAction('act-review-watch','REVIEW','Granska bevakningen','Granska instrument märkta för uppföljning.', 'MEDIUM');

  // Deduplicate actions by id
  const seen = new Set<string>();
  const uniqActions = actions.filter(a=>{ if(seen.has(a.id)) return false; seen.add(a.id); return true; });

  // Confidence from marketSignals.confidence
  let confidence = Number(marketSignals.confidence || 100);
  if (!isFinite(confidence)) confidence = 0;
  if (confidence < 0) confidence = 0;
  if (confidence > 100) confidence = 100;

  return {
    generatedAt: new Date().toISOString(),
    priority,
    summary,
    actions: uniqActions,
    reasoning: reasoningTrim,
    confidence,
  };
}

export default buildVictorDecision;
