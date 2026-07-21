export type NewsSource = 'FINNHUB'|'FMP'|'SEC'|'COMPANY'|'OTHER';
export type NewsCategory =
  'EARNINGS'|'GUIDANCE'|'ANALYST'|'INSIDER'|'REGULATORY'|'PRODUCT'|'MACRO'|'MANAGEMENT'|'M_AND_A'|'LEGAL'|'OTHER';
export type Sentiment = 'POSITIVE'|'NEGATIVE'|'NEUTRAL'|'MIXED';
export type Importance = 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW';

export type RawNewsItem = {
  id?: string;
  source: NewsSource;
  headline: string;
  summary?: string;
  url?: string;
  symbols?: string[];
  publishedAt: string;
  category?: NewsCategory;
  sentiment?: Sentiment;
};

export type NormalizedNewsItem = {
  id: string;
  source: NewsSource;
  headline: string;
  summary: string;
  url: string | null;
  symbols: string[];
  publishedAt: string | null;
  category: NewsCategory;
  sentiment: Sentiment;
  importance: Importance;
  ageMinutes: number;
  isRecent: boolean;
  fingerprint: string;
};

export type NewsEvent = {
  id: string;
  headline: string;
  summary: string;
  primarySource: NewsSource;
  sources: NewsSource[];
  sourceCount: number;
  symbols: string[];
  publishedAt: string | null;
  category: NewsCategory;
  sentiment: Sentiment;
  importance: Importance;
  ageMinutes: number;
  isRecent: boolean;
  url: string | null;
};

export type NewsIntelligenceResult = {
  generatedAt: string;
  totalItems: number;
  recentItems: number;
  criticalItems: number;
  highPriorityItems: number;
  affectedSymbols: string[];
  categories: Record<NewsCategory, number>;
  sentimentSummary: Record<Sentiment, number>;
  events: NewsEvent[];
  warnings: string[];
};

const SOURCE_PRIORITY: NewsSource[] = ['SEC','COMPANY','FINNHUB','FMP','OTHER'];
const DEFAULT_RECENT_MINUTES = 24 * 60;

function safeTrim(s?: string){ return (s||'').toString().trim(); }

function simpleHash(input: string){
  // FNV-1a 32-bit -> hex, deterministic and fast
  let h = 2166136261 >>> 0;
  for(let i=0;i<input.length;i++){
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ('0000000'+(h>>>0).toString(16)).slice(-8);
}

function normalizeSymbols(sym?: string[]){
  if(!Array.isArray(sym)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for(const s of sym){
    if(!s) continue;
    const up = s.toString().trim().toUpperCase();
    if(!up) continue;
    if(seen.has(up)) continue;
    seen.add(up);
    out.push(up);
  }
  return out;
}

function makeFingerprint(item: {headline:string, summary?:string, symbols?:string[]}){
  const h = safeTrim(item.headline).toLowerCase().replace(/\s+/g,' ');
  const s = safeTrim(item.summary).toLowerCase().replace(/\s+/g,' ');
  const sy = (item.symbols||[]).slice().map(x=>x.toUpperCase()).sort().join(',');
  return simpleHash(h + '|' + s + '|' + sy);
}

export function normalizeNewsItems(items: RawNewsItem[], nowMs?: number){
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return items.map(it=>{
    const headline = safeTrim(it.headline || '');
    const summary = safeTrim(it.summary || '');
    const symbols = normalizeSymbols(it.symbols);
    let publishedAt: string | null = null;
    let ageMinutes = 0;
    let isRecent = false;
    const warnings: string[] = [];
    if(!headline) warnings.push('MISSING_HEADLINE');
    const parsed = Date.parse(it.publishedAt || '');
    if(isNaN(parsed)){
      publishedAt = null;
      ageMinutes = 0;
      warnings.push('INVALID_DATE');
    }else{
      publishedAt = new Date(parsed).toISOString();
      const diffMs = now - parsed;
      if(diffMs < 0){ ageMinutes = 0; warnings.push('FUTURE_DATE'); }
      else ageMinutes = Math.floor(diffMs/60000);
    }
    isRecent = (publishedAt !== null) ? (ageMinutes <= DEFAULT_RECENT_MINUTES) : false;
    const category = classifyCategory(headline, summary, it.category);
    const sentiment = classifySentiment(headline, summary, it.sentiment);
    const importance = classifyImportance(category, sentiment, headline+summary);
    const id = it.id ? it.id.toString() : ('news-'+simpleHash(it.source + '|' + (publishedAt||'') + '|' + headline));
    const fingerprint = makeFingerprint({headline, summary, symbols});
    return {
      id,
      source: it.source,
      headline,
      summary,
      url: it.url ? safeTrim(it.url) : null,
      symbols,
      publishedAt,
      category,
      sentiment,
      importance,
      ageMinutes,
      isRecent,
      fingerprint,
      __warnings: warnings,
    } as NormalizedNewsItem & {__warnings?: string[]};
  });
}

function kwMatch(txt: string, kws: string[]){
  const t = txt.toLowerCase();
  return kws.some(k=> t.indexOf(k) !== -1);
}

function classifyCategory(headline: string, summary: string, provided?: NewsCategory): NewsCategory{
  if(provided) return provided;
  const txt = (headline + ' ' + summary).toLowerCase();
  if(kwMatch(txt,['fed','ecb','cpi','rates','inflation','macroeconomic','unemployment'])) return 'MACRO';
  if(kwMatch(txt,['earnings','result','report'])) return 'EARNINGS';
  if(kwMatch(txt,['guidance','outlook'])) return 'GUIDANCE';
  if(kwMatch(txt,['upgrade','downgrade','price target','price-target'])) return 'ANALYST';
  if(kwMatch(txt,['insider','director','bought','sold','bought shares','insider transaction'])) return 'INSIDER';
  if(kwMatch(txt,['sec','filing','investigation','regulatory','halt'])) return 'REGULATORY';
  if(kwMatch(txt,['acquisition','merger','acquire','bid'])) return 'M_AND_A';
  if(kwMatch(txt,['lawsuit','lawsuit','sued','legal'])) return 'LEGAL';
  if(kwMatch(txt,['ceo','cfo','resign','appointed','appointed as'])) return 'MANAGEMENT';
  if(kwMatch(txt,['launch','product','approval','approved'])) return 'PRODUCT';
  if(kwMatch(txt,['fed','ecb','cpi','rates','inflation','macroeconomic','unemployment'])) return 'MACRO';
  return 'OTHER';
}

function classifySentiment(headline:string, summary:string, provided?: Sentiment): Sentiment{
  if(provided) return provided;
  const txt = (headline + ' ' + summary).toLowerCase();
  const pos = kwMatch(txt,['beat','beats','raises','upgrade','approved','approval','buyback','acquisition announced']);
  const neg = kwMatch(txt,['miss','cuts','cut','downgrade','investigation','lawsuit','resign','bankrupt','bankruptcy','fraud']);
  if(pos && neg) return 'MIXED';
  if(pos) return 'POSITIVE';
  if(neg) return 'NEGATIVE';
  return 'NEUTRAL';
}

function classifyImportance(category: NewsCategory, sentiment: Sentiment, text: string): Importance{
  const t = text.toLowerCase();
  if(kwMatch(t,['halt','bankrupt','bankruptcy','fraud','major investigation','fraudulent'])) return 'CRITICAL';
  if(category === 'REGULATORY' && kwMatch(t,['halt','investigation','fraud'])) return 'CRITICAL';
  if(category === 'M_AND_A' && t.length>0) return 'CRITICAL';
  if(category === 'EARNINGS' || category === 'GUIDANCE') return 'HIGH';
  if(category === 'ANALYST' || category === 'INSIDER' || category === 'MANAGEMENT' || category === 'LEGAL') return 'HIGH';
  if(category === 'PRODUCT' || category === 'MACRO') return 'MEDIUM';
  return 'LOW';
}

export function deduplicateNewsItems(items: (NormalizedNewsItem & {__warnings?:string[]})[]){
  const map = new Map<string, (NormalizedNewsItem & {__warnings?:string[]})[]>();
  const warnings: string[] = [];
  for(const it of items){
    const key = it.fingerprint || makeFingerprint(it);
    const arr = map.get(key) || [];
    arr.push(it);
    map.set(key, arr);
  }
  const events: {event: NewsEvent, duplicateMerged?: boolean}[] = [];
  for(const [fp, group] of map.entries()){
    if(group.length>1) warnings.push('DUPLICATE_MERGED');
    // choose primary by source priority
    group.sort((a,b)=> SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source));
    const primary = group[0];
    const sources = Array.from(new Set(group.map(g=>g.source)));
    const symbols = Array.from(new Set(group.flatMap(g=>g.symbols||[]))).sort();
    const publishedAt = primary.publishedAt;
    const category = primary.category;
    const sentiment = primary.sentiment;
    const importance = primary.importance;
    const ageMinutes = primary.ageMinutes;
    const isRecent = primary.isRecent;
    const url = primary.url || null;
    events.push({ event: {
      id: 'evt-'+fp,
      headline: primary.headline,
      summary: primary.summary,
      primarySource: primary.source,
      sources,
      sourceCount: sources.length,
      symbols,
      publishedAt,
      category,
      sentiment,
      importance,
      ageMinutes,
      isRecent,
      url,
    }, duplicateMerged: group.length>1});
  }
  return { events: events.map(e=>e.event), warnings } as {events:NewsEvent[], warnings:string[]};
}

export function buildNewsIntelligence(itemsRaw: RawNewsItem[], options?: {nowMs?:number, recentWindowMinutes?:number}): NewsIntelligenceResult{
  const now = options?.nowMs ?? Date.now();
  const recentWindow = options?.recentWindowMinutes ?? DEFAULT_RECENT_MINUTES;
  const normalized = normalizeNewsItems(itemsRaw, now);
  // collect warnings
  const warningsSet = new Set<string>();
  for(const n of (normalized as any)){
    if((n as any).__warnings) for(const w of (n as any).__warnings) warningsSet.add(w);
    if(n.publishedAt === null) warningsSet.add('INVALID_DATE');
    if(n.publishedAt !== null){
      const parsed = Date.parse(n.publishedAt);
      if(parsed > now) warningsSet.add('FUTURE_DATE');
    }
    if(!n.headline) warningsSet.add('MISSING_HEADLINE');
  }
  // dedupe
  const {events, warnings: dedupWarnings} = deduplicateNewsItems(normalized as any);
  for(const w of dedupWarnings) warningsSet.add(w);
  // compute aggregates
  const categories: Record<NewsCategory, number> = {
    EARNINGS:0, GUIDANCE:0, ANALYST:0, INSIDER:0, REGULATORY:0, PRODUCT:0, MACRO:0, MANAGEMENT:0, M_AND_A:0, LEGAL:0, OTHER:0,
  };
  const sentimentSummary: Record<Sentiment, number> = { POSITIVE:0, NEGATIVE:0, NEUTRAL:0, MIXED:0 };
  const affectedSymbolsSet = new Set<string>();
  let recentItems = 0;
  let criticalItems = 0;
  let highPriorityItems = 0;
  for(const ev of events){
    categories[ev.category] = (categories[ev.category]||0)+1;
    sentimentSummary[ev.sentiment] = (sentimentSummary[ev.sentiment]||0)+1;
    for(const s of ev.symbols) affectedSymbolsSet.add(s);
    if(ev.isRecent || (ev.publishedAt && Date.parse(ev.publishedAt) >= now - recentWindow*60000)) recentItems++;
    if(ev.importance === 'CRITICAL') criticalItems++;
    if(ev.importance === 'HIGH') highPriorityItems++;
  }
  // sort events by importance then publishedAt desc
  const importanceRank: Record<Importance, number> = { CRITICAL:0, HIGH:1, MEDIUM:2, LOW:3 };
  events.sort((a,b)=>{
    const r = importanceRank[a.importance] - importanceRank[b.importance];
    if(r!==0) return r;
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
  return {
    generatedAt: new Date(now).toISOString(),
    totalItems: normalized.length,
    recentItems,
    criticalItems,
    highPriorityItems,
    affectedSymbols: Array.from(affectedSymbolsSet).sort(),
    categories,
    sentimentSummary,
    events,
    warnings: Array.from(warningsSet).slice(0,50),
  };
}

export default { normalizeNewsItems, buildNewsIntelligence, deduplicateNewsItems };
