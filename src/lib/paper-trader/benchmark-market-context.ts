import type { IntradayMarketContext } from './intraday-market-context';
import { sanitizeIntradayMarketContextForState } from './intraday-market-context';

export type BenchmarkAlignment = 'OUTPERFORMING' | 'UNDERPERFORMING' | 'ALIGNED' | 'DIVERGING' | 'UNKNOWN';

export type BenchmarkMarketContext = {
  schemaVersion: 1;
  source: 'VICTOR_BENCHMARK_CONTEXT';

  symbol: string;
  benchmarkSymbol: string | null;
  observedAt: string | null;
  generatedAt: string;

  symbolChangePercent: number | null;
  benchmarkChangePercent: number | null;
  relativeStrengthPercent: number | null;

  symbolDirection: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
  benchmarkDirection: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';

  alignment: BenchmarkAlignment;

  symbolFresh: boolean;
  benchmarkFresh: boolean;
  isFresh: boolean;

  warnings: readonly string[];
};

export type BuildBenchmarkInput = {
  symbolContext: IntradayMarketContext | null | undefined;
  benchmarkContext: IntradayMarketContext | null | undefined;
  benchmarkSymbol: string | null;
  now?: Date;
};

function round4(n: number){ return Number(Number(n).toFixed(4)); }
function isFiniteNum(v: any): v is number { return typeof v === 'number' && Number.isFinite(v); }

// Conservative mapping: default STOCK -> SPY; only map to QQQ for clearly tech leaders
const QQQ_WHITELIST = new Set(['AAPL','MSFT','NVDA','AMD','NVDA','AMZN','GOOGL','META','TSLA','NFLX','AVGO']);

export function resolveBenchmarkSymbol(instrument: { providerSymbol?: string; assetType?: string; name?: string } | string | null | undefined): string | null {
  try{
    if (!instrument) return null;
    const sym = typeof instrument === 'string' ? instrument : String(instrument.providerSymbol || '').toUpperCase();
    const asset = typeof instrument === 'string' ? undefined : (instrument && (instrument as any).assetType);
    const at = asset ? String(asset).toUpperCase() : undefined;
    if (at === 'FOREX') return null;
    // If symbol explicitly appears in tech whitelist map to QQQ
    if (sym && QQQ_WHITELIST.has(sym)) return 'QQQ';
    // default for STOCK: SPY
    if (!at || at === 'STOCK') return 'SPY';
    return null;
  }catch(e){ return null; }
}

export function buildBenchmarkMarketContext(input: BuildBenchmarkInput): BenchmarkMarketContext {
  const now = input.now || new Date();
  const generatedAt = now.toISOString();
  const symbol = String((input.symbolContext && input.symbolContext.symbol) || '').toUpperCase() || (typeof input.benchmarkSymbol === 'string' ? String(input.benchmarkSymbol).toUpperCase() : '') || '';
  const benchmarkSymbol = input.benchmarkSymbol ? String(input.benchmarkSymbol).toUpperCase() : null;

  const sc = input.symbolContext || null;
  const bc = input.benchmarkContext || null;

  const symbolChangePercent = sc && isFiniteNum((sc as any).session?.changePercent) ? round4((sc as any).session.changePercent) : null;
  const benchmarkChangePercent = bc && isFiniteNum((bc as any).session?.changePercent) ? round4((bc as any).session.changePercent) : null;

  const relative = (isFiniteNum(symbolChangePercent) && isFiniteNum(benchmarkChangePercent)) ? round4(symbolChangePercent - benchmarkChangePercent) : null;

  const toDir = (v: number | null) => { if (v === null) return 'UNKNOWN' as const; if (v > 0.15) return 'UP' as const; if (v < -0.15) return 'DOWN' as const; return 'FLAT' as const; };
  const symbolDirection = toDir(symbolChangePercent);
  const benchmarkDirection = toDir(benchmarkChangePercent);

  const symbolFresh = !!(sc && sc.isFresh);
  const benchmarkFresh = !!(bc && bc.isFresh);
  const isFresh = symbolFresh && (benchmarkSymbol ? benchmarkFresh : true);

  // Alignment rules priority: UNKNOWN, DIVERGING, OUTPERFORMING, UNDERPERFORMING, ALIGNED
  let alignment: BenchmarkAlignment = 'UNKNOWN';
  // If freshness insufficient or missing data -> UNKNOWN
  if (!isFresh || symbolChangePercent === null || benchmarkChangePercent === null || benchmarkSymbol === null) alignment = 'UNKNOWN';
  else if (symbolDirection !== 'UNKNOWN' && benchmarkDirection !== 'UNKNOWN' && symbolDirection !== benchmarkDirection && symbolDirection !== 'FLAT' && benchmarkDirection !== 'FLAT') alignment = 'DIVERGING';
  else if (relative !== null && relative > 0.30) alignment = 'OUTPERFORMING';
  else if (relative !== null && relative < -0.30) alignment = 'UNDERPERFORMING';
  else alignment = 'ALIGNED';

  const warningsSet = new Set<string>();
  if (!benchmarkSymbol) warningsSet.add('BENCHMARK_MAPPING_UNAVAILABLE');
  if (!sc || sc.coverage === 'UNAVAILABLE') warningsSet.add('SYMBOL_INTRADAY_UNAVAILABLE');
  if (sc && !symbolFresh) warningsSet.add('SYMBOL_INTRADAY_STALE');
  if (benchmarkSymbol && (!bc || bc.coverage === 'UNAVAILABLE')) warningsSet.add('BENCHMARK_UNAVAILABLE');
  if (benchmarkSymbol && bc && !benchmarkFresh) warningsSet.add('BENCHMARK_DATA_STALE');
  if (relative === null) warningsSet.add('RELATIVE_STRENGTH_UNAVAILABLE');

  const warnings = Array.from(warningsSet).sort().slice(0,10);

  const out: BenchmarkMarketContext = {
    schemaVersion: 1,
    source: 'VICTOR_BENCHMARK_CONTEXT',
    symbol: symbol || (input.symbolContext && input.symbolContext.symbol) || '',
    benchmarkSymbol,
    observedAt: sc && sc.observedAt ? sc.observedAt : (bc && bc.observedAt ? bc.observedAt : null),
    generatedAt,
    symbolChangePercent: isFiniteNum(symbolChangePercent) ? symbolChangePercent : null,
    benchmarkChangePercent: isFiniteNum(benchmarkChangePercent) ? benchmarkChangePercent : null,
    relativeStrengthPercent: isFiniteNum(relative) ? relative : null,
    symbolDirection,
    benchmarkDirection,
    alignment,
    symbolFresh,
    benchmarkFresh,
    isFresh,
    warnings
  };

  return out;
}

export function sanitizeBenchmarkMarketContextForState(ctx: BenchmarkMarketContext | null | undefined): BenchmarkMarketContext | null {
  if (!ctx) return null;
  // copy and keep JSON-safe primitives
  const copy: BenchmarkMarketContext = JSON.parse(JSON.stringify(ctx));
  copy.warnings = Array.isArray(copy.warnings) ? copy.warnings.slice(0,10) : [];
  return copy;
}

export type BenchmarkDataReadiness = {
  checkedAt: string;
  symbolCount: number;

  readyCount: number;
  limitedCount: number;
  unavailableCount: number;
  staleCount: number;

  benchmarkUsage: readonly { benchmarkSymbol: string; symbolCount: number }[];

  topBlockingReasons: readonly { reason: string; count: number }[];
};

export function buildBenchmarkDataReadiness(contexts: (BenchmarkMarketContext | null | undefined)[] | null | undefined, now?: Date): BenchmarkDataReadiness {
  const checkedAt = (now || new Date()).toISOString();
  const arr = Array.isArray(contexts) ? contexts : [];
  const symbolCount = arr.length;
  let readyCount = 0, limitedCount = 0, unavailableCount = 0, staleCount = 0;
  const reasonCounts: Record<string, number> = {};
  const usageMap = new Map<string, number>();
  for (const c of arr){ if (!c){ unavailableCount++; reasonCounts['SYMBOL_INTRADAY_UNAVAILABLE'] = (reasonCounts['SYMBOL_INTRADAY_UNAVAILABLE']||0)+1; continue; }
    if (c.isFresh && c.relativeStrengthPercent !== null) readyCount++; else if (!c.isFresh) staleCount++; else unavailableCount++;
    for (const w of c.warnings || []) reasonCounts[w] = (reasonCounts[w]||0)+1;
    const b = c.benchmarkSymbol || 'NONE'; usageMap.set(b, (usageMap.get(b) || 0) + 1);
  }
  const benchmarkUsage = Array.from(usageMap.entries()).map(([k,v])=> ({ benchmarkSymbol: k, symbolCount: v })).sort((a,b)=> b.symbolCount - a.symbolCount || a.benchmarkSymbol.localeCompare(b.benchmarkSymbol));
  const top = Object.keys(reasonCounts).map(k=> ({ reason: k, count: reasonCounts[k] })).sort((a,b)=> b.count - a.count || a.reason.localeCompare(b.reason)).slice(0,10);
  return { checkedAt, symbolCount, readyCount, limitedCount, unavailableCount, staleCount, benchmarkUsage, topBlockingReasons: top };
}

export default { resolveBenchmarkSymbol, buildBenchmarkMarketContext, sanitizeBenchmarkMarketContextForState, buildBenchmarkDataReadiness };
