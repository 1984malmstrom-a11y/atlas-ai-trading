export type AnalystConsensus = 'STRONG_BUY'|'BUY'|'HOLD'|'SELL'|'STRONG_SELL'|'MIXED'|'UNKNOWN';

export type AnalystConsensusContext = {
  schemaVersion: 1;
  source: string;

  symbol: string;
  observedAt: string | null;
  generatedAt: string;

  consensus: AnalystConsensus;

  strongBuyCount: number | null;
  buyCount: number | null;
  holdCount: number | null;
  sellCount: number | null;
  strongSellCount: number | null;
  analystCount: number | null;

  priceTargetLow: number | null;
  priceTargetMean: number | null;
  priceTargetHigh: number | null;
  referencePrice: number | null;
  impliedUpsidePercent: number | null;

  revisionTrend: 'IMPROVING'|'DETERIORATING'|'STABLE'|'UNKNOWN';

  dataQuality: 'COMPLETE'|'LIMITED'|'INSUFFICIENT';

  warnings: readonly string[];
};

function nowIso(d?: Date){ return (d instanceof Date ? d : new Date()).toISOString(); }
function toFiniteOrNull(v:any){ const n = Number(v); return Number.isFinite(n) ? n : null; }

// Build a conservative analyst consensus context from fundamental intelligence snapshot.
// Since Twelve Data typically does not provide analyst recommendation payloads in this codebase,
// return an explicit UNKNOWN/INSUFFICIENT context when no verified analyst fields exist.
export function buildAnalystConsensusContext(opts: { symbol: string; fundamental?: any; now?: Date }) : AnalystConsensusContext{
  const sym = String(opts.symbol || '').toUpperCase();
  const now = opts.now ? opts.now : new Date();
  const fund = opts.fundamental || null;
  const generatedAt = nowIso(now);

  // Conservative default: insufficient
  const out: AnalystConsensusContext = {
    schemaVersion: 1,
    source: 'VICTOR_ANALYST_CONSENSUS',
    symbol: sym,
    observedAt: null,
    generatedAt,
    consensus: 'UNKNOWN',
    strongBuyCount: null,
    buyCount: null,
    holdCount: null,
    sellCount: null,
    strongSellCount: null,
    analystCount: null,
    priceTargetLow: null,
    priceTargetMean: null,
    priceTargetHigh: null,
    referencePrice: null,
    impliedUpsidePercent: null,
    revisionTrend: 'UNKNOWN',
    dataQuality: 'INSUFFICIENT',
    warnings: ['ANALYST_DATA_UNAVAILABLE']
  };

  // If provider snapshot contains explicit analyst-like fields, map conservatively.
  try{
    const snap = fund && fund.snapshot ? fund.snapshot : fund;
    if (snap && snap.analyst && typeof snap.analyst === 'object'){
      const a = snap.analyst;
      out.observedAt = snap.fetchedAt || null;
      out.strongBuyCount = Number.isFinite(Number(a.strongBuyCount)) ? Math.max(0, Math.floor(Number(a.strongBuyCount))) : null;
      out.buyCount = Number.isFinite(Number(a.buyCount)) ? Math.max(0, Math.floor(Number(a.buyCount))) : null;
      out.holdCount = Number.isFinite(Number(a.holdCount)) ? Math.max(0, Math.floor(Number(a.holdCount))) : null;
      out.sellCount = Number.isFinite(Number(a.sellCount)) ? Math.max(0, Math.floor(Number(a.sellCount))) : null;
      out.strongSellCount = Number.isFinite(Number(a.strongSellCount)) ? Math.max(0, Math.floor(Number(a.strongSellCount))) : null;
      out.analystCount = Number.isFinite(Number(a.analystCount)) ? Math.max(0, Math.floor(Number(a.analystCount))) : null;
      out.priceTargetLow = toFiniteOrNull(a.priceTargetLow);
      out.priceTargetMean = toFiniteOrNull(a.priceTargetMean);
      out.priceTargetHigh = toFiniteOrNull(a.priceTargetHigh);
      out.referencePrice = toFiniteOrNull(a.referencePrice);
      if (out.priceTargetMean !== null && out.referencePrice !== null && out.referencePrice !== 0){ out.impliedUpsidePercent = Number((((out.priceTargetMean - out.referencePrice)/Math.abs(out.referencePrice))*100).toFixed(2)); }
      out.revisionTrend = (a.revisionTrend as any) || 'UNKNOWN';
      out.dataQuality = a.dataQuality || 'LIMITED';
      out.warnings = Array.isArray(a.warnings) ? Array.from(new Set(a.warnings.map((x:any)=> String(x)))) .slice(0,10) as string[] : [];

      // derive consensus from counts if present
      const counts = [out.strongBuyCount||0, out.buyCount||0, out.holdCount||0, out.sellCount||0, out.strongSellCount||0];
      const total = (out.analystCount || counts.reduce((s,n)=>s+n,0) || 0);
      if (total > 0){
        const score = ((out.strongBuyCount||0)*2 + (out.buyCount||0)*1 + (out.holdCount||0)*0 + (out.sellCount||0)*-1 + (out.strongSellCount||0)*-2) / Math.max(1,total);
        if (score >= 1.2) out.consensus = 'STRONG_BUY';
        else if (score >= 0.5) out.consensus = 'BUY';
        else if (score > -0.5 && score < 0.5) out.consensus = 'HOLD';
        else if (score <= -1.2) out.consensus = 'STRONG_SELL';
        else out.consensus = 'SELL';
      }
    }
  }catch(e){ /* ignore and keep defaults */ }

  return JSON.parse(JSON.stringify(out));
}

export function sanitizeAnalystConsensusContextForState(ctx: AnalystConsensusContext | null){ if (!ctx) return null; return JSON.parse(JSON.stringify(ctx)); }

export default { buildAnalystConsensusContext, sanitizeAnalystConsensusContextForState };
