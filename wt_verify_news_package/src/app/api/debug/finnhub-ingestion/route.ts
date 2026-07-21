import { NextResponse } from 'next/server';
import runFinnhubNewsIngestion from '../../../../lib/news-ingestion/run-finnhub';

// Server-only route: runs a one-off Finnhub ingestion using server env vars
export async function GET() {
  try {
    const apiConnected = !!process.env.FINNHUB_API_KEY;
    if (!apiConnected) {
      return NextResponse.json({ apiConnected: 'NO', message: 'FINNHUB_API_KEY is not set on the server.' }, { status: 400 });
    }

    // use YYYY-MM-DD for Finnhub 'from'/'to' per provider requirements
    const fmt = (d: Date) => d.toISOString().slice(0,10);
    const to = fmt(new Date());
    const from = fmt(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));

    const report = await runFinnhubNewsIngestion({ symbols: ['AAPL', 'MSFT', 'NVDA'], from, to });

    const payload = {
      apiConnected: 'YES',
      fetched: report.fetched,
      duplicatesRemoved: report.duplicatesRemoved,
      filtered: report.filtered,
      analysesCreated: report.analysesCreated,
      analysesWithAffectedSymbols: report.analysesWithAffectedSymbols,
      analysesWithoutAffectedSymbols: report.analysesWithoutAffectedSymbols,
      affectedSymbolsPercentage: report.affectedSymbolsPercentage,
      warnings: report.warnings || [],
      // no permanent per-article diagnostic here; rely on topAnalyses for classification
      topAnalyses: (report.recentAnalyses || []).slice(-5).reverse().map(a => ({
        title: a.title,
        sentiment: a.sentiment,
        importanceScore: a.importanceScore ?? 0,
        primarySymbols: a.primarySymbols || [],
        relatedSymbols: a.relatedSymbols || [],
        affectedSymbols: a.affectedSymbols || [],
        category: a.category,
      })),
    };

    return NextResponse.json(payload);
  } catch (err: any) {
    const message = err && err.message ? String(err.message) : 'Unknown error';
    // Do not expose secrets in responses or logs
    return NextResponse.json({ error: `Finnhub ingestion failed: ${message}` }, { status: 500 });
  }
}

export const runtime = 'nodejs';
