import { fetchEarnings } from '../market-data/twelve-data';

export type EarningsEventStatus = 'UPCOMING' | 'RECENT' | 'NONE' | 'UNKNOWN';
export type EarningsTiming = 'BEFORE_MARKET' | 'AFTER_MARKET' | 'DURING_MARKET' | 'UNKNOWN';

export type EarningsEventContext = {
  schemaVersion: 1;
  source: 'TWELVE_DATA_EARNINGS' | string;

  symbol: string;
  observedAt: string | null;
  generatedAt: string;

  status: EarningsEventStatus;
  timing: EarningsTiming;

  nextEarningsAt: string | null;
  previousEarningsAt: string | null;
  hoursUntilEarnings: number | null;
  hoursSinceEarnings: number | null;

  estimatedEps: number | null;
  reportedEps: number | null;
  epsSurprisePercent: number | null;

  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';

  warnings: readonly string[];
};

function safeNum(v: any): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }

function clampHours(v: number | null){ if (v === null) return null; return Number(Number(v).toFixed(2)); }

export function buildEarningsEventContext(opts: { symbol: string; records?: any[]; now?: Date }): EarningsEventContext{
  const now = opts.now ? opts.now : new Date();
  const nowMs = now.getTime();
  const sym = String(opts.symbol || '').toUpperCase();
  const recs = Array.isArray(opts.records) ? opts.records.slice() : [];
  const warnings = new Set<string>();

  // find candidate next/previous by dates in records
  const parsed = recs.map(r => {
    const next = r.next_earnings_date || r.earnings_date || r.nextEarningsDate || null;
    const reported = r.reported_at || r.published_at || r.reportedDate || null;
    const eps = r.eps ?? r.actual_eps ?? r.reported_eps ?? null;
    const est = r.estimated ?? r.estimate ?? r.estimated_eps ?? null;
    return { raw: r, next, reported, eps: safeNum(eps), est: safeNum(est) };
  }).filter(Boolean);

  let nextDate: Date | null = null; let prevDate: Date | null = null;
  for (const p of parsed){
    if (p.next){ const d = new Date(String(p.next)); if (!isNaN(d.getTime())){ if (!nextDate || d.getTime() < nextDate.getTime()) nextDate = d; } }
    if (p.reported){ const d = new Date(String(p.reported)); if (!isNaN(d.getTime())){ if (!prevDate || d.getTime() > prevDate.getTime()) prevDate = d; } }
  }

  // compute hours until/since
  const hoursUntil = nextDate ? (nextDate.getTime() - nowMs) / (1000*60*60) : null;
  const hoursSince = prevDate ? (nowMs - prevDate.getTime()) / (1000*60*60) : null;

  // pick eps values from closest records
  let estimatedEps: number | null = null; let reportedEps: number | null = null;
  if (parsed.length){
    const byNext = parsed.filter(p=>p.next).sort((a,b)=> new Date(String(a.next)).getTime() - new Date(String(b.next)).getTime());
    if (byNext.length) estimatedEps = byNext[0].est ?? null;
    const byReported = parsed.filter(p=>p.reported).sort((a,b)=> new Date(String(b.reported)).getTime() - new Date(String(a.reported)).getTime());
    if (byReported.length) reportedEps = byReported[0].eps ?? null;
  }

  // compute surprise
  const epsSurprisePercent = (reportedEps !== null && estimatedEps !== null) ? Number((((reportedEps - estimatedEps) / Math.abs(estimatedEps || 1)) * 100).toFixed(2)) : null;

  // status rules: upcoming within 72h considered UPCOMING
  let status: EarningsEventStatus = 'NONE';
  if (hoursUntil !== null && hoursUntil >= -0.0001 && hoursUntil <= 72) status = 'UPCOMING';
  else if (hoursSince !== null && hoursSince <= 48 && hoursSince >= 0) status = 'RECENT';
  else if (nextDate || prevDate) status = 'NONE';
  else status = 'UNKNOWN';

  // timing best-effort unknown (no market hours data in provider)
  const timing: EarningsTiming = 'UNKNOWN';

  // risk mapping
  let risk: EarningsEventContext['riskLevel'] = 'UNKNOWN';
  if (status === 'UPCOMING' && hoursUntil !== null){ if (hoursUntil <= 24) risk = 'HIGH'; else if (hoursUntil <= 72) risk = 'MODERATE'; else risk = 'LOW'; }
  else if (status === 'RECENT' && hoursSince !== null){ if (hoursSince <= 12) risk = 'HIGH'; else if (hoursSince <= 48) risk = 'MODERATE'; else risk = 'LOW'; }
  else if (status === 'NONE' && (reportedEps !== null || estimatedEps !== null)) risk = 'LOW';
  else risk = 'UNKNOWN';

  if (parsed.length === 0) warnings.add('EARNINGS_DATA_UNAVAILABLE');

  const out: EarningsEventContext = {
    schemaVersion: 1,
    source: 'TWELVE_DATA_EARNINGS',
    symbol: sym,
    observedAt: parsed.length ? new Date().toISOString() : null,
    generatedAt: new Date(nowMs).toISOString(),
    status,
    timing,
    nextEarningsAt: nextDate ? nextDate.toISOString() : null,
    previousEarningsAt: prevDate ? prevDate.toISOString() : null,
    hoursUntilEarnings: clampHours(hoursUntil),
    hoursSinceEarnings: clampHours(hoursSince),
    estimatedEps: estimatedEps === null ? null : Number(Number(estimatedEps).toFixed(4)),
    reportedEps: reportedEps === null ? null : Number(Number(reportedEps).toFixed(4)),
    epsSurprisePercent,
    riskLevel: risk,
    warnings: Array.from(warnings).slice(0,10),
  };

  return JSON.parse(JSON.stringify(out));
}

export function sanitizeEarningsEventContextForState(ctx: EarningsEventContext | null){
  if (!ctx) return null;
  return {
    schemaVersion: ctx.schemaVersion,
    source: ctx.source,
    symbol: String(ctx.symbol || '').toUpperCase(),
    observedAt: ctx.observedAt || null,
    generatedAt: ctx.generatedAt,
    status: ctx.status,
    timing: ctx.timing,
    nextEarningsAt: ctx.nextEarningsAt || null,
    previousEarningsAt: ctx.previousEarningsAt || null,
    hoursUntilEarnings: ctx.hoursUntilEarnings === null ? null : Number(ctx.hoursUntilEarnings),
    hoursSinceEarnings: ctx.hoursSinceEarnings === null ? null : Number(ctx.hoursSinceEarnings),
    estimatedEps: ctx.estimatedEps === null ? null : Number(ctx.estimatedEps),
    reportedEps: ctx.reportedEps === null ? null : Number(ctx.reportedEps),
    epsSurprisePercent: ctx.epsSurprisePercent === null ? null : Number(ctx.epsSurprisePercent),
    riskLevel: ctx.riskLevel,
    warnings: Array.isArray(ctx.warnings) ? ctx.warnings.slice(0,10) : [],
  } as EarningsEventContext;
}

export function createPerCycleEarningsResolver(opts: { fetchEarnings: (o:{ symbol: string })=>Promise<any[]|null>, instruments?: any[], timeoutMs?: number, updateState?: (s:string,r:EarningsEventContext|null)=>void }){
  const map = new Map<string, Promise<EarningsEventContext | null>>();
  const fetcher = opts.fetchEarnings;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 5000;
  const instruments = Array.isArray(opts.instruments) ? opts.instruments : [];
  async function resolve({ symbol, analyzed, instrument } : { symbol: string; analyzed?: boolean; instrument?: any }){
    const sym = String(symbol || '').toUpperCase(); if(!sym) return null;
    let at = instrument && instrument.assetType ? String(instrument.assetType).toUpperCase() : undefined;
    if(!at){ try{ const inst = Array.isArray(instruments) ? instruments.find((i:any)=> String((i.providerSymbol||i.id||'')).toUpperCase() === sym) : null; at = inst && inst.assetType ? String(inst.assetType).toUpperCase() : undefined; }catch(_){ at = undefined; } }
    if(at && at !== 'STOCK') return null; // only STOCK
    if(analyzed === false) return null;
    if(map.has(sym)) return map.get(sym) as Promise<EarningsEventContext | null>;
    const p = (async ()=>{
      try{
        const res = await Promise.race([ fetcher({ symbol: sym }), new Promise<null>((resolve)=> setTimeout(()=> resolve(null), timeoutMs)) ]);
        const ctx = buildEarningsEventContext({ symbol: sym, records: Array.isArray(res) ? res : [], now: new Date() });
        try{ if(opts.updateState) opts.updateState(sym, sanitizeEarningsEventContextForState(ctx)); }catch(_){ }
        return ctx;
      }catch(_){ const u = buildEarningsEventContext({ symbol: sym, records: [], now: new Date() }); try{ if(opts.updateState) opts.updateState(sym, sanitizeEarningsEventContextForState(u)); }catch(_){ } return u; }
    })();
    map.set(sym, p);
    return p;
  }
  return { resolve };
}

export default { buildEarningsEventContext, sanitizeEarningsEventContextForState, createPerCycleEarningsResolver };
