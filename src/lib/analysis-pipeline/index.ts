// Analysis pipeline core - pure TypeScript, mock implementations ready to be replaced by real AI

export type IncomingItem = {
  id: string;
  source?: string;
  title?: string;
  content: string;
  receivedAt?: string; // ISO
  meta?: Record<string, any>;
};

export type NormalizedItem = {
  id: string;
  source?: string;
  title?: string;
  content: string;
  receivedAt: string;
  language?: string;
};

export type Classification = 'news' | 'report' | 'sec' | 'macro' | 'corporate_event' | 'unknown';

export type Summary = {
  text: string;
  tokens?: number;
};

export type Sentiment = {
  score: number; // -1..1
  label: 'positive' | 'neutral' | 'negative';
};

export type Analysis = {
  id: string;
  source?: string;
  title?: string;
  summary: Summary;
  classification: Classification;
  sentiment: Sentiment;
  affectedCompanies: string[];
  importance: number; // 0-100
  createdAt: string; // ISO
  raw?: IncomingItem | NormalizedItem;
};

// Simple in-memory queue for Victors analyses
export const victorsAnalysisQueue: Analysis[] = [];

// Step 1: Normalization
export function normalize(item: IncomingItem): NormalizedItem {
  const receivedAt = item.receivedAt || new Date().toISOString();
  const content = (item.content || '').replace(/\s+/g, ' ').trim();
  const title = item.title ? item.title.trim() : undefined;
  return {
    id: item.id,
    source: item.source,
    title,
    content,
    receivedAt,
    language: 'sv' // default for mock; replace detection later
  };
}

// Step 2 / 3: Mock summarization (replaceable)
export type Summarizer = (text: string, opts?: { maxTokens?: number }) => Promise<Summary>;

export const mockSummarizer: Summarizer = async (text) => {
  // return first sentence-like chunk as a short summary
  const end = text.indexOf('.') >= 0 ? text.indexOf('.') + 1 : Math.min(200, text.length);
  const s = text.slice(0, end).trim();
  return { text: s || text.slice(0, 200), tokens: Math.ceil((s.length || text.length) / 4) };
};

// Step 4: Classification (simple keyword based)
export function classify(text: string): Classification {
  const t = text.toLowerCase();
  if (/sec|10-k|10-q|form\s+4/.test(t)) return 'sec';
  if (/quarterly report|q[1-4]|earnings|kvartal/.test(t)) return 'report';
  if (/inflation|cpi|riksbank|fed|central bank|ränta/.test(t)) return 'macro';
  if (/merger|acquir|acquisition|splits|spin-off|delisting|bankruptcy/.test(t)) return 'corporate_event';
  if (/news|breaking|press release|pressmeddelande/.test(t)) return 'news';
  return 'unknown';
}

// Step 5: Sentiment (very small mock classifier)
const POSITIVE = ['increase', 'beat', 'gain', 'up', 'strong', 'positive', 'outperform'];
const NEGATIVE = ['decrease', 'miss', 'down', 'weak', 'negative', 'underperform', 'loss'];

export function analyzeSentiment(text: string): Sentiment {
  const low = text.toLowerCase();
  let score = 0;
  for (const w of POSITIVE) if (low.includes(w)) score += 1;
  for (const w of NEGATIVE) if (low.includes(w)) score -= 1;
  // normalize
  const n = Math.max(1, Math.abs(score));
  const final = Math.max(-1, Math.min(1, score / 3));
  const label = final > 0.2 ? 'positive' : final < -0.2 ? 'negative' : 'neutral';
  return { score: final, label };
}

// Step 6: Affected companies (mock: detect known tickers/names) using token boundaries
const KNOWN_COMPANIES = ['NVIDIA', 'Microsoft', 'Alphabet', 'Apple', 'Amazon', 'Tesla', 'Meta Platforms', 'Meta', 'Nebius'];
function escapeRegexLocal(s: string){ return s.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&'); }
export function extractAffectedCompanies(text: string): string[] {
  const found = new Set<string>();
  if(!text) return [];
  // search for company names as whole words (prevents metadata matching 'meta')
  for (const c of KNOWN_COMPANIES) {
    const re = new RegExp('(?:\\b' + escapeRegexLocal(c) + '\\b|\\(' + escapeRegexLocal(c) + '\\))','i');
    if (re.test(text)) found.add(c);
  }
  // also detect explicit tickers like (AAPL), AAPL or $AAPL but only from a known whitelist
  const ALLOWED_TICKERS = new Set(['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','NFLX','NBIS']);
  const tickerRe = /(?:\(|\$)?\b([A-Z]{1,5})\b\)?/g;
  let m: RegExpExecArray | null;
  while((m = tickerRe.exec(text)) !== null){
    const t = String(m[1]).toUpperCase();
    if(ALLOWED_TICKERS.has(t)) found.add(t);
  }
  return Array.from(found);
}

// Step 7: Importance scoring (0-100) - mock heuristic
export function scoreImportance(normalized: NormalizedItem, classification: Classification, sentiment: Sentiment): number {
  let score = 10;
  // longer content -> more substance
  const len = Math.min(2000, normalized.content.length);
  score += Math.round((len / 2000) * 40);
  // classification weight
  if (classification === 'report' || classification === 'sec') score += 20;
  if (classification === 'macro') score += 8;
  if (sentiment.label === 'negative' || sentiment.label === 'positive') score += 10;
  return Math.max(0, Math.min(100, score));
}

// Step 8: Create analysis object (small internal id generator, avoids new deps)
function generateId(prefix = 'a') {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`;
}

export function createAnalysis(normalized: NormalizedItem, summary: Summary, classification: Classification, sentiment: Sentiment, affectedCompanies: string[], importance: number): Analysis {
  return {
    id: generateId('analysis'),
    source: normalized.source,
    title: normalized.title,
    summary,
    classification,
    sentiment,
    affectedCompanies,
    importance,
    createdAt: new Date().toISOString(),
    raw: normalized,
  };
}

// Step 9: Enqueue
export function enqueueAnalysis(analysis: Analysis) {
  victorsAnalysisQueue.push(analysis);
}

// Full pipeline runner (composed steps) - accepts optional real summarizer
export async function processIncomingItem(item: IncomingItem, opts?: { summarizer?: Summarizer }): Promise<Analysis> {
  const normalized = normalize(item);
  const summarizer = opts?.summarizer ?? mockSummarizer;
  const summary = await summarizer(normalized.content, { maxTokens: 256 });
  const classification = classify(summary.text + ' ' + (normalized.title || ''));
  const sentiment = analyzeSentiment(summary.text + ' ' + (normalized.title || ''));
  const affectedCompanies = extractAffectedCompanies(normalized.content + ' ' + (normalized.title || ''));
  const importance = scoreImportance(normalized, classification, sentiment);
  const analysis = createAnalysis(normalized, summary, classification, sentiment, affectedCompanies, importance);
  enqueueAnalysis(analysis);
  return analysis;
}

// Export module default convenience
export default {
  processIncomingItem,
  victorsAnalysisQueue,
};

// ------------------------------------------------------------------
// Public simplified input/output model requested
// ------------------------------------------------------------------

export type InputSourceType = 'news' | 'report' | 'document' | 'macro';

export type InputItem = {
  id: string;
  sourceType: InputSourceType;
  title?: string;
  content: string;
  receivedAt?: string;
  meta?: Record<string, any>;
};

export type AnalysisResult = {
  id: string;
  sourceType: InputSourceType;
  title?: string;
  summary: string;
  sentiment: Sentiment;
  importanceScore: number; // 0-100
  primarySymbols: string[];
  relatedSymbols: string[];
  affectedSymbols: string[];
  category: Classification;
  createdAt: string; // ISO
};

// Map internal classification to the broader source types
function mapClassificationToSourceType(c: Classification): InputSourceType {
  if (c === 'news') return 'news';
  if (c === 'report' || c === 'sec') return 'report';
  if (c === 'macro') return 'macro';
  return 'document';
}

// Clean function that follows the requested pipeline: normalize -> mock analysis -> return AnalysisResult
export async function analyzeInput(input: InputItem, deps?: { summarizer?: Summarizer }): Promise<AnalysisResult> {
  // Build a compatible IncomingItem for existing pipeline
  const incoming: IncomingItem = {
    id: input.id,
    source: input.sourceType,
    title: input.title,
    content: input.content,
    receivedAt: input.receivedAt,
    meta: input.meta,
  };

  const analysis = await processIncomingItem(incoming, { summarizer: deps?.summarizer });

  // NAME -> TICKER mapping (authoritative list)
  const NAME_TO_TICKER: Record<string,string> = {
    'APPLE': 'AAPL',
    'MICROSOFT': 'MSFT',
    'NVIDIA': 'NVDA',
    'NV': 'NVDA',
    'ALPHABET': 'GOOGL',
    'GOOGLE': 'GOOGL',
    'AMAZON': 'AMZN',
    'META': 'META',
    'META PLATFORMS': 'META',
    'TESLA': 'TSLA',
    'NETFLIX': 'NFLX',
    'NEBIUS': 'NBIS'
  };

  // Helper: validate ticker format (1-5 uppercase letters)
  function isValidTicker(t?: string){
    if(!t) return false;
    return /^[A-Z]{1,5}$/.test(t);
  }

  // Build searchable text (title + summary + content) and helpers
  const rawText = ((analysis.title || '') + '\n' + (analysis.summary && analysis.summary.text ? analysis.summary.text : '') + '\n' + (analysis.raw && (analysis.raw as any).content ? (analysis.raw as any).content : ''));

  function escapeRegex(s: string){ return s.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&'); }
  function tokenRegex(token: string){
    const esc = escapeRegex(token);
    // match as standalone token or inside parentheses like (NBIS)
    return new RegExp('(?:\\b' + esc + '\\b|\\(' + esc + '\\))','i');
  }

  const detectedFromAnalysis = new Set<string>();
  for(const found of (analysis.affectedCompanies || [])){
    if(!found) continue;
    const raw = String(found).trim();
    const up = raw.toUpperCase();
    if(isValidTicker(up)){
      if(tokenRegex(up).test(rawText)) detectedFromAnalysis.add(up);
      continue;
    }
    const mapped = NAME_TO_TICKER[up];
    if(mapped && tokenRegex(up).test(rawText)) detectedFromAnalysis.add(mapped);
  }

  const detectedFromText = new Set<string>();
  // check tickers (explicit tokens or $TICKER)
  const knownTickers = Array.from(new Set(Object.values(NAME_TO_TICKER)));
  for(const t of knownTickers){
    if(tokenRegex(t).test(rawText)) detectedFromText.add(t);
    const reDollar = new RegExp('\\$' + escapeRegex(t) + '(?:\\b|$)','i');
    if(reDollar.test(rawText)) detectedFromText.add(t);
  }
  // check company names
  for(const name of Object.keys(NAME_TO_TICKER)){
    if(tokenRegex(name).test(rawText)) detectedFromText.add(NAME_TO_TICKER[name]);
  }

  // sourceSymbols: tickers that the provider was asked for
  const sourceSymbols: string[] = (input.meta && Array.isArray((input.meta as any).sourceSymbols)) ? (input.meta as any).sourceSymbols.map((s:any)=>String(s).toUpperCase()) : [];

  const finalSet = new Set<string>();
  // Add detected symbols from analysis and text
  for(const s of detectedFromAnalysis) if(isValidTicker(s)) finalSet.add(s);
  for(const s of detectedFromText) if(isValidTicker(s)) finalSet.add(s);

  // Only include a sourceSymbol if it's actually present in text (as ticker or name)
  for(const src of sourceSymbols){
    if(!isValidTicker(src)) continue;
    const presentAsTicker = tokenRegex(src).test(rawText);
    let presentAsName = false;
    // check if mapped company name appears
    for(const [name, tick] of Object.entries(NAME_TO_TICKER)){
      if(tick !== src) continue;
      const re = tokenRegex(name);
      if(re.test(rawText)) { presentAsName = true; break; }
    }
    if(presentAsTicker || presentAsName) finalSet.add(src);
  }

  // Final affectedSymbols: array, uppercase, unique, valid tickers only
  const finalAffected = Array.from(finalSet).filter(isValidTicker).map(s=>s.toUpperCase());

  // Determine primary vs related according to rules:
  const titleText = (analysis.title || '');
  const summaryText = (analysis.summary && analysis.summary.text) ? analysis.summary.text : '';
  const contentText = (analysis.raw && (analysis.raw as any).content) ? (analysis.raw as any).content : summaryText || '';

  const primarySet = new Set<string>();
  const relatedSet = new Set<string>();

  // helper to find company names that map to a ticker
  function namesForTicker(tick: string){
    return Object.entries(NAME_TO_TICKER).filter(([,v])=>v===tick).map(([k])=>k);
  }

  for(const t of finalAffected){
    if(!isValidTicker(t)) continue;
    let isPrimary = false;
    // explicit ticker in title
    if(tokenRegex(t).test(titleText)) isPrimary = true;
    // company name in title
    if(!isPrimary){
      for(const name of namesForTicker(t)){
        if(tokenRegex(name).test(titleText)){ isPrimary = true; break; }
      }
    }
    // sourceSymbol AND verified in title
    if(!isPrimary && sourceSymbols.includes(t)){
      if(tokenRegex(t).test(titleText)) isPrimary = true;
      if(!isPrimary){
        for(const name of namesForTicker(t)){
          if(tokenRegex(name).test(titleText)){ isPrimary = true; break; }
        }
      }
    }

    if(isPrimary) primarySet.add(t);
    else {
      // related if appears in summary or content (but not primary)
      let related = false;
      if(tokenRegex(t).test(summaryText) || tokenRegex(t).test(contentText)) related = true;
      if(!related){
        for(const name of namesForTicker(t)){
          if(tokenRegex(name).test(summaryText) || tokenRegex(name).test(contentText)){ related = true; break; }
        }
      }
      if(related) relatedSet.add(t);
    }
  }

  const primarySymbols = Array.from(primarySet).filter(isValidTicker).map(s=>s.toUpperCase()).sort();
  const relatedSymbols = Array.from(relatedSet).filter(isValidTicker).map(s=>s.toUpperCase()).sort();
  const finalAffectedOrdered = Array.from(new Set([...primarySymbols, ...relatedSymbols]));

  const result: AnalysisResult = {
    id: analysis.id,
    sourceType: mapClassificationToSourceType(analysis.classification),
    title: analysis.title,
    summary: analysis.summary.text,
    sentiment: analysis.sentiment,
    importanceScore: analysis.importance,
    primarySymbols,
    relatedSymbols,
    affectedSymbols: finalAffectedOrdered,
    category: analysis.classification,
    createdAt: analysis.createdAt,
  };

  return result;
}

// Small example helper (not a test) — can be used by other modules or tests
export async function exampleRun() {
  const input: InputItem = {
    id: 'example-1',
    sourceType: 'report',
    title: 'NVIDIA Q2 results',
    content: 'NVIDIA reported strong growth this quarter. Earnings beat expectations and revenue increased significantly.',
  };
  return analyzeInput(input);
}
