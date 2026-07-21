import { NewsIntelligenceResult, NewsEvent } from '../news-intelligence/index';

export type MarketMood = 'BULLISH'|'BEARISH'|'MIXED'|'NEUTRAL';

function importanceWeight(imp: string){
  if(imp === 'CRITICAL') return 3;
  if(imp === 'HIGH') return 2;
  if(imp === 'MEDIUM') return 1;
  return 0.5;
}

function sentimentVal(s: string){
  if(s === 'POSITIVE') return 1;
  if(s === 'NEGATIVE') return 1; // for magnitude counting
  return 0;
}

export function buildVictorNewsContext(news: NewsIntelligenceResult){
  const events = (news.events || []) as NewsEvent[];
  // select top events (HIGH or CRITICAL)
  const top = events.filter(e=> e.importance === 'HIGH' || e.importance === 'CRITICAL')
    .slice()
    .sort((a,b)=>{
      const rank = (a.importance === 'CRITICAL'?0:1) - (b.importance === 'CRITICAL'?0:1);
      if(rank!==0) return rank;
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta;
    })
    .slice(0,5);

  const watchset = new Set<string>();
  const opportunities: NewsEvent[] = [];
  const risks: NewsEvent[] = [];
  let posScore = 0;
  let negScore = 0;
  for(const e of events){
    const w = importanceWeight(e.importance as any);
    if(e.sentiment === 'POSITIVE') posScore += w;
    if(e.sentiment === 'NEGATIVE') negScore += w;
    if((e.importance === 'HIGH' || e.importance === 'CRITICAL')){
      for(const s of e.symbols||[]) if(s) watchset.add(s);
      if(e.sentiment === 'POSITIVE') opportunities.push(e);
      if(e.sentiment === 'NEGATIVE') risks.push(e);
    }
  }

  // watchlist must only contain unique symbols from HIGH or CRITICAL events
  const watchlist = Array.from(watchset).sort();
  const portfolioMentions = Array.from(new Set(events.flatMap(e=>e.symbols||[]))).filter(Boolean).sort();

  // determine marketMood deterministically
  let marketMood: MarketMood = 'NEUTRAL';
  if(posScore === 0 && negScore === 0) marketMood = 'NEUTRAL';
  else if(posScore > negScore * 1.2) marketMood = 'BULLISH';
  else if(negScore > posScore * 1.2) marketMood = 'BEARISH';
  else marketMood = 'MIXED';

  // summary
  const positiveCount = opportunities.length;
  const regulatoryRisks = events.filter(e=> e.category === 'REGULATORY' && (e.importance === 'HIGH' || e.importance === 'CRITICAL')).length;
  const summaryParts: string[] = [];
  if(positiveCount){
    if(positiveCount === 1) summaryParts.push('1 viktig positiv händelse');
    else summaryParts.push(`${positiveCount} viktiga positiva händelser`);
  }
  if(regulatoryRisks){
    if(regulatoryRisks === 1) summaryParts.push('1 regulatorisk risk');
    else summaryParts.push(`${regulatoryRisks} regulatoriska risker`);
  }
  let summary = '';
  if(summaryParts.length === 0){
    summary = 'Inga viktiga händelser identifierades.';
  }else{
    summary = summaryParts.join(' och ') + ' identifierades.';
  }

  return {
    generatedAt: news.generatedAt || new Date().toISOString(),
    marketMood,
    topEvents: top,
    watchlist,
    opportunities,
    risks,
    portfolioMentions,
    summary,
  };
}

export default { buildVictorNewsContext };
