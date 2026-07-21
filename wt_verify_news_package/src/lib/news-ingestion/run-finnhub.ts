import { fetchFinnhubCompanyNews } from '../news-providers/finnhub';
import { NewsIngestionService } from './index';
// (no extra imports needed)

export type RunOptions = {
  symbols?: string[];
  from?: string; // ISO date
  to?: string; // ISO date
};

export async function runFinnhubNewsIngestion(opts?: RunOptions) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if(!apiKey) throw new Error('Missing FINNHUB_API_KEY environment variable. Set FINNHUB_API_KEY to run Finnhub ingestion.');

  const symbols = opts?.symbols && opts.symbols.length ? opts.symbols : ['NVDA','MSFT','AAPL'];

  // provider adapter that NewsIngestionService expects
  const provider = async (_opts?: any) => {
    // fetchFinnhubCompanyNews expects { symbols, from, to, apiKey, fetchImpl }
    // Finnhub requires YYYY-MM-DD dates for from/to
    function fmtDate(d: Date){
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth()+1).padStart(2,'0');
      const day = String(d.getUTCDate()).padStart(2,'0');
      return `${y}-${m}-${day}`;
    }

    const toIso = opts?.to ? new Date(opts.to) : new Date();
    const fromIso = opts?.from ? new Date(opts.from) : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const from = fmtDate(fromIso);
    const to = fmtDate(toIso);

    const res = await fetchFinnhubCompanyNews({ symbols, from, to, apiKey, fetchImpl: (globalThis as any).fetch });
    return res;
  };

  const report = await NewsIngestionService({ provider });

  // compute aggregated metrics from the full results array
  const allResults = report.results || [];
  const analysesWithAffectedSymbols = allResults.filter(r=>Array.isArray(r.affectedSymbols) && r.affectedSymbols.length>0).length;
  const analysesWithoutAffectedSymbols = allResults.length - analysesWithAffectedSymbols;
  const percentWithAffectedSymbols = allResults.length ? Math.round((analysesWithAffectedSymbols / allResults.length) * 100) : 0;

  // Build a compact recentAnalyses slice (last 10)
  const recentAnalyses = allResults.slice(-10);

  // No temporary diagnostic fetches here. Return aggregated metrics and recent analyses only.
  return {
    fetched: report.fetched,
    duplicatesRemoved: report.duplicatesRemoved,
    filtered: report.filtered,
    analysesCreated: report.analysesCreated,
    analysesWithAffectedSymbols,
    analysesWithoutAffectedSymbols,
    affectedSymbolsPercentage: percentWithAffectedSymbols,
    warnings: report.warnings,
    recentAnalyses,
  };
}

export default runFinnhubNewsIngestion;
