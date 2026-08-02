import { RawNewsItem, normalizeNewsItems } from '../news-intelligence/index';

export type CompanyNewsSentiment = 'POSITIVE'|'NEGATIVE'|'MIXED'|'NEUTRAL'|'UNKNOWN';

export type CompanyNewsContext = {
  schemaVersion: 1;
  source: 'FINNHUB_COMPANY_NEWS';

  symbol: string;
  observedAt: string | null;
  generatedAt: string;

  articleCount: number;
  freshArticleCount: number;

  sentiment: CompanyNewsSentiment;
  sentimentScore: number | null;

  latestHeadline: string | null;
  latestPublishedAt: string | null;

  keyThemes: readonly string[];
  warnings: readonly string[];
};

export type BuildCompanyNewsInput = {
  symbol: string;
  articles?: RawNewsItem[];
  now?: Date;
};

const STOPWORDS = new Set(["the","and","for","with","that","from","this","will","have","has","are","was","were","but","not","its","it's","company","shares","stock","stocks"]);

function dedupeByPriority(items: { id?: string; headline: string; publishedAt: string | null }[]){
  const byId = new Map<string, any>();
  const byKey = new Map<string, any>();
  const out: any[] = [];
  for(const it of items){
    const id = it.id ? String(it.id) : '';
    if(id){ if(!byId.has(id)){ byId.set(id, it); out.push(it); } continue; }
    const key = (String(it.headline||'').trim().toLowerCase()) + '|' + String(it.publishedAt||'');
    if(byKey.has(key)) continue; byKey.set(key, it); out.push(it);
  }
  return out;
}

function clampHeadline(h?: string | null){
  if(!h) return null;
  const s = String(h).trim();
  if(s.length <= 180) return s;
  return s.slice(0,177) + '...';
}

function mapSentimentToScore(s: string | undefined){
  if(!s) return null;
  if(s === 'POSITIVE') return 1; if(s === 'NEGATIVE') return -1; if(s === 'MIXED') return 0; if(s === 'NEUTRAL') return 0; return null;
}

export function buildCompanyNewsContext(input: BuildCompanyNewsInput): CompanyNewsContext{
  const now = input.now ? input.now : new Date();
  const nowMs = now.getTime();
  const symbol = String(input.symbol || '').toUpperCase();
  const raw = Array.isArray(input.articles) ? input.articles.slice() : [];

  // normalize using existing news-intelligence helpers (gives sentiment and parsed dates)
  const normalized = normalizeNewsItems(raw, nowMs);

  // filter by symbol and timestamp rules
  const included: typeof normalized = [] as any;
  const warningsSet = new Set<string>();
  for(const n of normalized){
    if(!Array.isArray(n.symbols) || !n.symbols.map(s=>String(s).toUpperCase()).includes(symbol)) continue; // symbol mismatch
    if(!n.publishedAt){ warningsSet.add('COMPANY_NEWS_TIMESTAMP_INVALID'); continue; }
    const pubMs = Date.parse(n.publishedAt || '');
    if(isNaN(pubMs)){ warningsSet.add('COMPANY_NEWS_TIMESTAMP_INVALID'); continue; }
    const ageMs = nowMs - pubMs;
    if(ageMs < -5*60*1000) { warningsSet.add('COMPANY_NEWS_TIMESTAMP_INVALID'); continue; } // future beyond 5 min
    const ageHours = ageMs / (1000*60*60);
    if(ageHours > 72) continue; // exclude older than 72h
    included.push(n);
  }

  if(included.length === 0){
    // provider might be unavailable or empty
    warningsSet.add('COMPANY_NEWS_EMPTY');
  }

  // dedupe by id/headline+publishedAt
  const deduped = dedupeByPriority(included.map(i=> ({ id: i.id, headline: i.headline, publishedAt: i.publishedAt })));

  // compute counts and freshness
  let articleCount = deduped.length;
  let freshArticleCount = 0;
  let sentimentScoreSum = 0; let sentimentCount = 0;
  const themesMap = new Map<string, number>();
  let latestHeadline: string | null = null; let latestPublishedAt: string | null = null;

  // sort newest first
  deduped.sort((a,b)=>{ const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0; const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0; return tb - ta; });

  for(const it of deduped){
    const pa = it.publishedAt ? Date.parse(it.publishedAt) : 0;
    const ageHours = (nowMs - pa) / (1000*60*60);
    if(ageHours <= 24) freshArticleCount++;
    // find original normalized item to get sentiment and headline words
    const orig = normalized.find(n=> (n.id === it.id) || (n.headline === it.headline && n.publishedAt === it.publishedAt));
    if(orig){
      const sc = mapSentimentToScore(orig.sentiment);
      if(sc !== null){ sentimentScoreSum += sc; sentimentCount++; }
      // extract words
      const words = orig.headline.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
      for(const w of words){ if(w.length < 3) continue; if(STOPWORDS.has(w)) continue; themesMap.set(w, (themesMap.get(w)||0)+1); }
    }
    if(!latestHeadline){ latestHeadline = it.headline || null; latestPublishedAt = it.publishedAt || null; }
  }

  const sentimentScore = sentimentCount > 0 ? Number((sentimentScoreSum / sentimentCount).toFixed(3)) : null;
  let sentiment: CompanyNewsSentiment = 'UNKNOWN';
  if(sentimentScore === null) sentiment = 'UNKNOWN'; else if(sentimentScore > 0) sentiment = 'POSITIVE'; else if(sentimentScore < 0) sentiment = 'NEGATIVE'; else sentiment = 'NEUTRAL';

  // build key themes top 5
  const themes = Array.from(themesMap.entries()).sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,5).map(t=> t[0]);

  // prepare out object
  const out: CompanyNewsContext = {
    schemaVersion: 1,
    source: 'FINNHUB_COMPANY_NEWS',
    symbol,
    observedAt: included.length > 0 ? (included[0].publishedAt || null) : null,
    generatedAt: new Date(nowMs).toISOString(),
    articleCount: Math.max(0, articleCount),
    freshArticleCount: Math.max(0, freshArticleCount),
    sentiment,
    sentimentScore,
    latestHeadline: clampHeadline(latestHeadline || null),
    latestPublishedAt: latestPublishedAt || null,
    keyThemes: themes.slice(0,5),
    warnings: Array.from(warningsSet).slice(0,10),
  };

  return JSON.parse(JSON.stringify(out));
}

export function sanitizeCompanyNewsContextForState(ctx: CompanyNewsContext | null){
  if(!ctx) return null;
  return {
    schemaVersion: ctx.schemaVersion,
    source: ctx.source,
    symbol: String(ctx.symbol || '').toUpperCase(),
    observedAt: ctx.observedAt || null,
    generatedAt: ctx.generatedAt,
    articleCount: Number(ctx.articleCount || 0),
    freshArticleCount: Number(ctx.freshArticleCount || 0),
    sentiment: ctx.sentiment,
    sentimentScore: ctx.sentimentScore === null ? null : Number(ctx.sentimentScore),
    latestHeadline: clampHeadline(ctx.latestHeadline || null),
    latestPublishedAt: ctx.latestPublishedAt || null,
    keyThemes: Array.isArray(ctx.keyThemes) ? ctx.keyThemes.slice(0,5) : [],
    warnings: Array.isArray(ctx.warnings) ? ctx.warnings.slice(0,10) : [],
  } as CompanyNewsContext;
}

export function createPerCycleCompanyNewsResolver(opts: { fetchCompanyNews: (o:{ symbol: string })=>Promise<RawNewsItem[]>, instruments?: any[], timeoutMs?: number, updateState?: (s:string,r:CompanyNewsContext|null)=>void }){
  const map = new Map<string, Promise<CompanyNewsContext | null>>();
  const fetcher = opts.fetchCompanyNews;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 5000;
  const instruments = Array.isArray(opts.instruments) ? opts.instruments : [];
  async function resolve({ symbol, analyzed, instrument } : { symbol: string; analyzed?: boolean; instrument?: any }){
    const sym = String(symbol || '').toUpperCase(); if(!sym) return null;
    // resolve assetType
    let at = instrument && instrument.assetType ? String(instrument.assetType).toUpperCase() : undefined;
    if(!at){ try{ const inst = Array.isArray(instruments) ? instruments.find((i:any)=> String((i.providerSymbol||i.id||'')).toUpperCase() === sym) : null; at = inst && inst.assetType ? String(inst.assetType).toUpperCase() : undefined; }catch(_){ at = undefined; } }
    if(at && at !== 'STOCK') return null; // only STOCK
    if(analyzed === false) return null;
    if(map.has(sym)) return map.get(sym) as Promise<CompanyNewsContext | null>;
    const p = (async ()=>{
      try{
        const res = await Promise.race([ fetcher({ symbol: sym }), new Promise<null>((resolve)=> setTimeout(()=> resolve(null), timeoutMs)) ]);
        if(!Array.isArray(res)){
          const unavailable = buildCompanyNewsContext({ symbol: sym, articles: [], now: new Date() });
          try{ if(opts.updateState) opts.updateState(sym, sanitizeCompanyNewsContextForState(unavailable)); }catch(_){ }
          return unavailable;
        }
        const ctx = buildCompanyNewsContext({ symbol: sym, articles: res, now: new Date() });
        try{ if(opts.updateState) opts.updateState(sym, sanitizeCompanyNewsContextForState(ctx)); }catch(_){ }
        return ctx;
      }catch(_){ const u = buildCompanyNewsContext({ symbol: sym, articles: [], now: new Date() }); try{ if(opts.updateState) opts.updateState(sym, sanitizeCompanyNewsContextForState(u)); }catch(_){ } return u; }
    })();
    map.set(sym, p);
    return p;
  }
  return { resolve };
}

export default { buildCompanyNewsContext, sanitizeCompanyNewsContextForState, createPerCycleCompanyNewsResolver };
