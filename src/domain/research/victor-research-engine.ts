import mockAnalysis from '../../data/mock-analysis-data';
import { getMockPortfolio } from '../../data/mock-portfolio';
import dataHub from '../datahub/victor-data-hub';
import { VictorEvidence } from '../datahub/types';
import validator from '../datahub/victor-evidence-validator';
import type { MarketQuote } from '../../lib/market-data/types';

export type ResearchModuleResult = {
  title: string;
  status: 'ok' | 'warn' | 'error';
  summary: string;
  confidence: number; // 0-100
  updatedAt: string;
};

function marketDataModule(): ResearchModuleResult {
  const bullish = mockAnalysis.mockTechnical.filter(t => t.momentumScore >= 60).length;
  const neutral = mockAnalysis.mockTechnical.filter(t => t.momentumScore >= 45 && t.momentumScore < 60).length;
  const summary = bullish > neutral ? 'Marknaden visar svag positivitet med fler tillgångar i momentum.' : 'Marknaden är relativt lugn/neutral.';
  return { title: 'Market Data', status: 'ok', summary, confidence: Math.min(90, 40 + bullish * 10), updatedAt: new Date().toISOString() };
}

function fundamentalsModule(symbol?: string): ResearchModuleResult {
  const f = mockAnalysis.mockFundamental.find(x => x.symbol === symbol) || mockAnalysis.mockFundamental[0];
  const summary = symbol ? `Fundamenta för ${f.symbol}: ${f.summary}` : `Generell fundamental översikt: ${f.summary}`;
  const confidence = Math.round((f.qualityScore + f.valuationScore) / 2);
  return { title: 'Company Fundamentals', status: 'ok', summary, confidence, updatedAt: new Date().toISOString() };
}

function newsModule(symbol?: string): ResearchModuleResult {
  const n = mockAnalysis.mockNews.find(x => x.symbol === symbol) || { summary: 'Inga större nyheter', sentiment: 'NEUTRAL', importanceScore: 20 } as any;
  const summary = `${n.summary}`;
  const confidence = Math.min(90, n.importanceScore + 30);
  return { title: 'Financial News', status: 'ok', summary, confidence, updatedAt: new Date().toISOString() };
}

function technicalModule(symbol?: string): ResearchModuleResult {
  const t = mockAnalysis.mockTechnical.find(x => x.symbol === symbol) || mockAnalysis.mockTechnical[0];
  const summary = `${t.summary}`;
  const confidence = Math.min(95, t.momentumScore + 20);
  return { title: 'Technical Analysis', status: 'ok', summary, confidence, updatedAt: new Date().toISOString() };
}

function macroModule(): ResearchModuleResult {
  // Simple mock: no negative macro events
  const summary = 'Inga negativa makrohändelser identifierade.';
  return { title: 'Macro Economy', status: 'ok', summary, confidence: 80, updatedAt: new Date().toISOString() };
}

function portfolioContextModule(portfolio?: any, symbol?: string): ResearchModuleResult {
  const p = portfolio || getMockPortfolio();
  const holdings = p?.holdings || [];
  const total = p?.totalValue || 0;
  const concentration = holdings.reduce((acc:any,h:any)=> acc + (h.marketValue||0), 0) / Math.max(1,total);
  const hasSymbol = holdings.some((h:any)=> h.symbol === symbol);
  const summary = hasSymbol ? `Portföljen innehåller redan ${symbol}.` : (concentration > 0.2 ? 'Portföljen är tungt koncentrerad.' : 'Portföljen är diversifierad.');
  const confidence = 75;
  return { title: 'Portfolio Context', status: 'ok', summary, confidence, updatedAt: new Date().toISOString() };
}

export type VictorResearchReport = {
  summaryBullets: string[];
  confidence: number;
  modules: ResearchModuleResult[];
  updatedAt: string;
  evidence?: VictorEvidence[];
  sourcesUsed?: string[];
  providerErrors?: any[];
  staleEvidenceCount?: number;
  collectedAt?: string | null;
  // validation metadata
  validationScore?: number;
  corroboratedFacts?: string[];
  contradictions?: any[];
  unconfirmedEvidenceCount?: number;
  rejectedEvidenceCount?: number;
  sourceCoverage?: number;
};

export async function runVictorResearch(opts?: { symbol?: string; portfolio?: any; normalizedQuotes?: Array<Partial<MarketQuote> & { marketTimestamp?: string; fetchedAt?: string; dataStatus?: 'LIVE'|'DELAYED'|'STALE'|'UNAVAILABLE'; isStale?: boolean; provider?: string; change?: number | null; changePercent?: number | null; currency?: string | null }>; getNormalizedQuotes?: () => Promise<any> }): Promise<VictorResearchReport> {
  const symbol = opts?.symbol;
  const portfolio = opts?.portfolio;

  // collect evidence via Data Hub (async)
  let hubResult: any = { evidence: [], providerErrors: [], collectedAt: null, evidenceCount: 0, staleEvidenceCount: 0 };
  try{ hubResult = await dataHub.collectEvidence(symbol); }catch(e){ hubResult = { evidence: [], providerErrors: [{ providerId: 'hub', error: String(e) }], collectedAt: new Date().toISOString(), evidenceCount: 0, staleEvidenceCount: 0 }; }

  const rawEvidence = hubResult.evidence as VictorEvidence[];

  // validate evidence
  let validationResult: any = { validatedEvidence: rawEvidence, rejectedEvidence: [], corroboratedFacts: [], contradictions: [], lowConfidenceClaims: [], sourceCoverage: 0, averageReliability: 0, averageConfidence: 0, validationScore: 0 };
  try{ validationResult = validator.validateEvidence(rawEvidence || []); }catch(e){ /* fallback */ }

  const evidence = validationResult.validatedEvidence as VictorEvidence[];

  // If Data Hub returned no Market Data evidence, reuse provided normalizedQuotes
  // so research doesn't report "Ingen data" when a valid LIVE quote exists.
  try{
    const hasMarket = (evidence || []).some((ev: VictorEvidence) => ev && ev.category === 'Market Data');
    // Support legacy injectable `getNormalizedQuotes` for tests: call it and extract quotes
    let injectedQuotes: any[] | undefined = undefined;
    try{
      if (opts && typeof (opts as any).getNormalizedQuotes === 'function'){
        const got = await (opts as any).getNormalizedQuotes();
        injectedQuotes = Array.isArray(got?.quotes) ? got.quotes : (Array.isArray(got) ? got : undefined);
      }
    }catch(e){ /* ignore injectable failure */ }

    if (!hasMarket && opts && opts.symbol && (Array.isArray(opts.normalizedQuotes) || Array.isArray(injectedQuotes))){
      const quotes = Array.isArray(opts.normalizedQuotes) ? opts.normalizedQuotes as any[] : injectedQuotes as any[];
      const sym = String(opts.symbol).toUpperCase();
      const q = quotes.find((x:any) => x && x.symbol && String(x.symbol).toUpperCase() === sym);
      if (q && q.dataStatus === 'LIVE' && q.isStale === false && q.price !== null && q.price !== undefined){
        const ve: VictorEvidence = {
          evidenceId: `md-quote-${q.instrumentId || q.symbol}-${q.fetchedAt || new Date().toISOString()}`,
          category: 'Market Data',
          symbol: q.symbol,
          title: `Live quote ${q.symbol}`,
          summary: `Price ${q.price}${q.currency ? ' ' + q.currency : ''} at ${q.marketTimestamp || q.fetchedAt}`,
          facts: [ `price:${q.price}`, `timestamp:${q.marketTimestamp || q.fetchedAt}` ],
          provider: q.provider || 'market-data',
          sourceName: 'market-data-normalized',
          publishedAt: q.marketTimestamp || q.fetchedAt || new Date().toISOString(),
          fetchedAt: q.fetchedAt || new Date().toISOString(),
          freshnessStatus: q.isStale ? 'Stale' : 'Fresh',
          reliabilityScore: 60,
          confidence: 55,
        } as VictorEvidence;
        evidence.unshift(ve);
      }
    }
  }catch(e){ /* non-fatal: keep original evidence */ }

  // build modules from evidence groups
  const group = (cat:string) => evidence.filter(e=> e.category === cat);
  const buildModule = (title:string, cat:string, fn?: any) => {
    const items = group(cat);
    if (!items.length) return { title, status: 'warn', summary: 'Ingen data', confidence: 50, updatedAt: new Date().toISOString() } as any;
    const summary = items.slice(0,3).map(i=> i.summary).join(' | ');
    const confidence = Math.round(items.reduce((s,i)=> s + (i.confidence||50),0)/items.length);
    return { title, status: 'ok', summary, confidence, updatedAt: new Date().toISOString() };
  };

  const modules = [
    buildModule('Market Data','Market Data'),
    buildModule('Company Fundamentals','Company Fundamentals'),
    buildModule('Financial News','Financial News'),
    buildModule('Technical Analysis','Technical Analysis'),
    buildModule('Macro Economy','Macro Economy'),
    portfolioContextModule(portfolio, symbol),
  ];

  const bullets = modules.map(m => m.summary.replace(/\s+/g,' ').trim());
  const avg = Math.round(modules.reduce((s:any,m:any)=> s + (m.confidence||50),0) / modules.length);
  return {
    summaryBullets: bullets,
    confidence: avg,
    modules,
    updatedAt: new Date().toISOString(),
    evidence: evidence,
    sourcesUsed: Array.from(new Set((rawEvidence||[]).map(e=> e.provider))),
    providerErrors: hubResult.providerErrors || [],
    staleEvidenceCount: hubResult.staleEvidenceCount || 0,
    collectedAt: hubResult.collectedAt,
    validationScore: validationResult.validationScore,
    corroboratedFacts: validationResult.corroboratedFacts,
    contradictions: validationResult.contradictions,
    unconfirmedEvidenceCount: (validationResult.validatedEvidence || []).filter((v:any)=> v.validationStatus === 'Unconfirmed').length,
    rejectedEvidenceCount: (validationResult.rejectedEvidence || []).length,
    sourceCoverage: validationResult.sourceCoverage,
  };
}

export default runVictorResearch;
