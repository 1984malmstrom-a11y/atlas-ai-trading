import { RawNewsItem, normalizeNewsItems, deduplicateNewsItems, NewsEvent } from '../news-intelligence/index';
import type { InputItem, AnalysisResult } from '../analysis-pipeline/index';
import { analyzeInput } from '../analysis-pipeline/index';

export type NewsProviderFn = (opts?: any) => Promise<RawNewsItem[]>;

export type NewsIngestionOptions = {
  provider: NewsProviderFn;
  providerOptions?: any;
};

export type NewsIngestionReport = {
  fetched: number;
  duplicatesRemoved: number;
  filtered: number;
  analysesCreated: number;
  results: AnalysisResult[];
  warnings?: string[];
  duplicatesByUrl?: number;
  duplicatesByTitle?: number;
  itemsWithoutDedupKey?: number;
  analysesWithAffectedSymbols?: number;
  analysesWithoutAffectedSymbols?: number;
  percentWithAffectedSymbols?: number;
};

function mapCategoryToSourceType(cat?: string){
  if(!cat) return 'news';
  const c = cat.toLowerCase();
  if(c.includes('earn') || c.includes('guidance') || c.includes('analyst')) return 'report';
  if(c.includes('macro')) return 'macro';
  return 'news';
}

export async function NewsIngestionService(opts: NewsIngestionOptions): Promise<NewsIngestionReport> {
  const provider = opts.provider;
  const providerOptions = opts.providerOptions || {};

  const rawItems = await provider(providerOptions);
  const fetched = Array.isArray(rawItems) ? rawItems.length : 0;

  // ------------------------------------------------------------------
  // Robust pre-deduplication across symbol fetches. Key priority:
  // 1) canonical URL (must include pathname other than '/')
  // 2) normalized non-empty headline
  // 3) provider id
  // 4) fallback unique key (do not dedupe)
  // ------------------------------------------------------------------
  const dedupeMap = new Map<string, { item: RawNewsItem; keyType: 'url'|'title'|'id'|'unique' }>();
  let duplicatesByUrl = 0;
  let duplicatesByTitle = 0;
  let itemsWithoutDedupKey = 0;

  function normalizeUrlKey(u?: string){
    if(!u) return '';
    try{
      const parsed = new URL(String(u));
      const host = parsed.hostname.toLowerCase();
      let path = parsed.pathname || '';
      if(path.endsWith('/')) path = path.slice(0,-1);
      // Avoid using provider API endpoints as canonical keys (they point to provider APIs, not article pages)
      if(!path || path === '' || path.startsWith('/api')) return '';
      return `${host}${path}`;
    }catch(e){
      const s = String(u || '').trim().toLowerCase();
      const noQuery = s.split('?')[0].split('#')[0];
      return noQuery.replace(/\/+$/,'');
    }
  }

  function normalizeHeadlineKey(h?: string){
    if(!h) return '';
    let s = String(h).trim().toLowerCase();
    s = s.replace(/\s+/g,' ');
    s = s.replace(/[\.\!\?\:;,]$/,'');
    return s;
  }

  let uniqueCounter = 0;
  for(const it of (rawItems||[])){
    const canonicalUrl = it.url ? normalizeUrlKey(it.url) : '';
    const normTitle = normalizeHeadlineKey(it.headline || '');
    const providerId = it.id ? String(it.id) : '';

    let key = '';
    let keyType: 'url'|'title'|'id'|'unique' = 'unique';
    if(canonicalUrl){ key = 'url:' + canonicalUrl; keyType = 'url'; }
    else if(normTitle){ key = 'title:' + normTitle; keyType = 'title'; }
    else if(providerId){ key = 'id:' + providerId; keyType = 'id'; }
    else { key = 'unique:' + (uniqueCounter++); itemsWithoutDedupKey++; keyType = 'unique'; }

    const existing = dedupeMap.get(key);
    if(existing){
      const prev = existing.item;
      const s1 = Array.isArray(prev.symbols) ? prev.symbols.map((x:any)=>String(x).toUpperCase()) : [];
      const s2 = Array.isArray(it.symbols) ? it.symbols.map((x:any)=>String(x).toUpperCase()) : [];
      prev.symbols = Array.from(new Set([...s1,...s2]));
      if(!prev.url && it.url) prev.url = it.url;
      if(!prev.summary && it.summary) prev.summary = it.summary;
      if(!prev.publishedAt && it.publishedAt) prev.publishedAt = it.publishedAt;
      if(keyType === 'url') duplicatesByUrl++; else if(keyType === 'title') duplicatesByTitle++;
    }else{
      dedupeMap.set(key, { item: { ...it, symbols: Array.isArray(it.symbols) ? it.symbols.map((x:any)=>String(x).toUpperCase()) : [] }, keyType });
    }
  }

  const preDeduped = Array.from(dedupeMap.values()).map(v=>v.item);

  // Normalize items
  const itemsForNormalization = preDeduped || [];
  const normalized = normalizeNewsItems(itemsForNormalization as any);

  // Group normalized items by our prior dedup keys so we only merge when
  // the selected stable key matches. This avoids merging distinct articles
  // that happen to have similar headlines/summaries.
  const grouped = new Map<string, (typeof normalized)[0][]>();
  // We built dedupeMap earlier in the same insertion order; recreate keys array
  const keys = Array.from(dedupeMap.keys());
  for(let i=0;i<normalized.length;i++){
    const key = keys[i] || ('unique:' + i);
    const arr = grouped.get(key) || [];
    arr.push(normalized[i]);
    grouped.set(key, arr);
  }

  const events: NewsEvent[] = [];
  const warnings: string[] = [];
  const LOCAL_SOURCE_PRIORITY = ['SEC','COMPANY','FINNHUB','FMP','OTHER'];
  for(const [fp, group] of grouped.entries()){
    if(group.length > 1) warnings.push('DUPLICATE_MERGED');
    // choose primary by local source priority
    group.sort((a,b)=> LOCAL_SOURCE_PRIORITY.indexOf(a.source) - LOCAL_SOURCE_PRIORITY.indexOf(b.source));
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
    const id = 'evt-' + String(fp || primary.headline || '').replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64);
    events.push({
      id,
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
    } as NewsEvent);
  }

  const duplicatesRemoved = fetched - events.length;

  // No DIAG strings: keep warnings list limited to real warnings from normalization/dedup

  // Filter out any events that are missing headline or appear broken
  const filteredEvents = events.filter(e => !!e.headline && !!e.summary);
  const filtered = events.length - filteredEvents.length;

  const results: AnalysisResult[] = [];
  for(const ev of filteredEvents){
    const input: InputItem = {
      id: ev.id,
      sourceType: mapCategoryToSourceType(ev.category),
      title: ev.headline,
      content: ev.summary || ev.headline,
      receivedAt: ev.publishedAt || new Date().toISOString(),
      meta: { sourceSymbols: Array.isArray(ev.symbols) ? ev.symbols.map(s=>String(s).toUpperCase()) : [] },
    };

    try{
      const res = await analyzeInput(input);
      results.push(res);
    }catch(e){
      // swallow individual analysis errors but continue
    }
  }

  // Sort results so that highest importance is last (the debug route takes the last entries and reverses)
  results.sort((a,b)=> (a.importanceScore || 0) - (b.importanceScore || 0));
  // no diagnostic DIAG strings added here

  return {
    fetched,
    duplicatesRemoved,
    filtered,
    analysesCreated: results.length,
    results,
    warnings,
    duplicatesByUrl,
    duplicatesByTitle,
    itemsWithoutDedupKey,
    analysesWithAffectedSymbols: results.filter(r=>Array.isArray(r.affectedSymbols) && r.affectedSymbols.length>0).length,
    analysesWithoutAffectedSymbols: results.filter(r=>!Array.isArray(r.affectedSymbols) || r.affectedSymbols.length===0).length,
    percentWithAffectedSymbols: results.length ? Math.round((results.filter(r=>Array.isArray(r.affectedSymbols) && r.affectedSymbols.length>0).length / results.length) * 100) : 0,
  };
}

// Simple mock runner demonstrating behaviour — does not run automatically
export async function exampleRun(provider: NewsProviderFn){
  const report = await NewsIngestionService({ provider });
  return report;
}

export default { NewsIngestionService };
