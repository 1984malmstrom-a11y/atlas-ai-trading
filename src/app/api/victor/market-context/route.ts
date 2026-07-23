import { NextResponse } from 'next/server';
import { getNormalizedQuotes } from '../../market-data/quotes/route';
import analyzeMarket from '../../../../lib/market-analysis';
import buildMarketSignals from '../../../../lib/victor-signals';
import buildPortfolioContext from '../../../../lib/victor-portfolio-context';
import { getMarketSnapshot, refreshMarketSnapshot, getMarketSnapshotStatus } from '../../../../lib/victor-market-snapshot';

async function buildVictorMarketContext(){
  // build the same response as previous implementation
  const { quotes, errors, disabledInstruments, fetchedAt } = await getNormalizedQuotes();
  type Instrument = {
    instrumentId: string;
    symbol?: string;
    name?: string;
    price: number | null;
    change?: number | null;
    changePercent?: number | null;
    dataStatus?: string | null;
    isStale?: boolean;
    marketTimestamp?: string | number | null;
  };

  const instruments: Instrument[] = (quotes || []).map((q:any) => ({
    instrumentId: q.instrumentId,
    symbol: q.symbol,
    name: q.name,
    price: q.price,
    change: q.change,
    changePercent: q.changePercent,
    dataStatus: q.dataStatus,
    isStale: q.isStale,
    marketTimestamp: q.marketTimestamp,
  }));

  instruments.sort((a,b)=>{
    const A = (a.changePercent === null || a.changePercent === undefined) ? -Infinity : a.changePercent;
    const B = (b.changePercent === null || b.changePercent === undefined) ? -Infinity : b.changePercent;
    return B - A;
  });

  const validInstruments = instruments.filter(i => i.price !== null && i.changePercent !== null && i.dataStatus !== 'UNAVAILABLE');

  const instrumentCount = instruments.length;
  const advancing = instruments.filter(i => typeof i.changePercent === 'number' && i.changePercent > 0).length;
  const declining = instruments.filter(i => typeof i.changePercent === 'number' && i.changePercent < 0).length;
  const unchanged = instruments.filter(i => typeof i.changePercent === 'number' && i.changePercent === 0).length;
  const unavailable = instruments.filter(i => i.price === null || i.changePercent === null).length;

  const avg = validInstruments.length > 0 ? Number((validInstruments.reduce((s,n)=>s + (Number(n.changePercent)||0),0)/validInstruments.length).toFixed(2)) : 0;

  const strongest = validInstruments.length > 0 ? validInstruments.reduce((best,cur)=> (cur.changePercent! > best.changePercent! ? cur : best)) : null;
  const weakest = validInstruments.length > 0 ? validInstruments.reduce((worst,cur)=> (cur.changePercent! < worst.changePercent! ? cur : worst)) : null;

  const warnings: string[] = [];
  if ((quotes || []).some((q:any)=> q.dataStatus === 'DELAYED')) warnings.push('Marknadsdata är fördröjd.');
  const staleSymbols = (quotes || []).filter((q:any)=> q.dataStatus === 'STALE').map((q:any)=> q.symbol).filter(Boolean);
  if (staleSymbols.length) warnings.push('STALE data för: ' + staleSymbols.join(', '));

  let marketDataStatus: 'READY'|'PARTIAL'|'UNAVAILABLE' = 'UNAVAILABLE';
  if (validInstruments.length === instruments.length && instruments.length > 0 && errors.length === 0) marketDataStatus = 'READY';
  else if (validInstruments.length > 0) marketDataStatus = 'PARTIAL';
  else marketDataStatus = 'UNAVAILABLE';

  const summary = {
    instrumentCount,
    advancing,
    declining,
    unchanged,
    unavailable,
    averageChangePercent: avg,
  };

  const resp: any = {
    generatedAt: new Date().toISOString(),
    marketDataStatus,
    summary,
    strongest: strongest ? { instrumentId: strongest.instrumentId, symbol: strongest.symbol, name: strongest.name, price: strongest.price, changePercent: strongest.changePercent } : null,
    weakest: weakest ? { instrumentId: weakest.instrumentId, symbol: weakest.symbol, name: weakest.name, price: weakest.price, changePercent: weakest.changePercent } : null,
    instruments,
    warnings,
  };

  try{
    const marketAnalysis = analyzeMarket(resp as any);
    resp.marketAnalysis = marketAnalysis;
    try{ resp.marketSignals = buildMarketSignals(resp as any, marketAnalysis as any); }catch(e){}

    try{
      const mockPortfolio = {
        cash: 10000,
        holdings: [
          { instrumentId: 'microsoft', symbol: 'MSFT', name: 'Microsoft Corp.', quantity: 10, averagePrice: 300, sector: 'Technology' },
          { instrumentId: 'apple', symbol: 'AAPL', name: 'Apple Inc.', quantity: 5, averagePrice: 150, sector: 'Technology' },
          { instrumentId: 'nvidia', symbol: 'NVDA', name: 'NVIDIA Corporation', quantity: 8, averagePrice: 250, sector: 'Technology' },
          { instrumentId: 'amazon', symbol: 'AMZN', name: 'Amazon.com, Inc.', quantity: 3, averagePrice: 200, sector: 'Consumer Discretionary' },
          { instrumentId: 'alphabet', symbol: 'GOOGL', name: 'Alphabet Inc.', quantity: 4, averagePrice: 280, sector: 'Communication Services' },
        ],
      };
      resp.portfolioContext = buildPortfolioContext(mockPortfolio, quotes || []);
    }catch(e){}

    try{ const buildPortfolioInsights = (await import('../../../../lib/victor-portfolio-insights')).default; resp.portfolioInsights = buildPortfolioInsights({ marketAnalysis: marketAnalysis as any, marketSignals: resp.marketSignals as any, portfolioContext: resp.portfolioContext as any }); }catch(e){}

    try{ const buildVictorDecision = (await import('../../../../lib/victor-decision-engine')).default; resp.victorDecision = buildVictorDecision({ marketAnalysis: marketAnalysis as any, marketSignals: resp.marketSignals as any, portfolioContext: resp.portfolioContext as any }); }catch(e){}
    try{ const newsLib = await import('../../../../lib/news-intelligence'); const newsInt = newsLib.buildNewsIntelligence([], { nowMs: Date.now() }); const vnews = await import('../../../../lib/victor-news-context'); resp.victorNewsContext = vnews.buildVictorNewsContext(newsInt as any); }catch(e){}
  }catch(e){ /* non-fatal */ }

  return resp;
}

export async function GET(){
  try{
    const status = getMarketSnapshotStatus();
    const snap = getMarketSnapshot();

    if(status === 'READY' && snap){
      const out = { ...snap.data };
      out.snapshotStatus = snap.status || 'READY';
      out.snapshotGeneratedAt = snap.generatedAt;
      out.snapshotRefreshedAt = snap.refreshedAt;
      out.snapshotExpiresAt = snap.expiresAt;
      return NextResponse.json(out);
    }

    if(status === 'EMPTY'){
      const newSnap = await refreshMarketSnapshot(buildVictorMarketContext);
      const out = { ...(newSnap.data || {} ) };
      out.snapshotStatus = newSnap.status || getMarketSnapshotStatus();
      out.snapshotGeneratedAt = newSnap.generatedAt;
      out.snapshotRefreshedAt = newSnap.refreshedAt;
      out.snapshotExpiresAt = newSnap.expiresAt;
      return NextResponse.json(out);
    }

    if(status === 'STALE' && snap){
      // return existing stale snapshot and refresh in background
      const out = { ...snap.data };
      out.snapshotStatus = snap.status || 'STALE';
      out.snapshotGeneratedAt = snap.generatedAt;
      out.snapshotRefreshedAt = snap.refreshedAt;
      out.snapshotExpiresAt = snap.expiresAt;
      // fire-and-forget refresh
      refreshMarketSnapshot(buildVictorMarketContext).catch(()=>{});
      return NextResponse.json(out);
    }

    // REFRESHING or fallback
    const newSnap = await refreshMarketSnapshot(buildVictorMarketContext);
    const out = { ...(newSnap.data || {} ) };
    out.snapshotStatus = newSnap.status || getMarketSnapshotStatus();
    out.snapshotGeneratedAt = newSnap.generatedAt;
    out.snapshotRefreshedAt = newSnap.refreshedAt;
    out.snapshotExpiresAt = newSnap.expiresAt;
    return NextResponse.json(out);
  }catch(err:any){
    return new NextResponse(JSON.stringify({ error: 'internal' }), { status: 500 });
  }
}

export async function POST(req:any){
  try{
    const secret = req.headers.get('x-atlas-refresh-secret');
    if(!secret || secret !== process.env.ATLAS_REFRESH_SECRET){
      return new NextResponse(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }
    const snap = await refreshMarketSnapshot(buildVictorMarketContext);
    const out = { status: snap.status || getMarketSnapshotStatus(), generatedAt: snap.generatedAt, refreshedAt: snap.refreshedAt, expiresAt: snap.expiresAt };
    return NextResponse.json(out);
  }catch(e:any){
    return new NextResponse(JSON.stringify({ error: 'internal' }), { status: 500 });
  }
}
