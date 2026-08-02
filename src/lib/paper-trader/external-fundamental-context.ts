import { createPerCycleFundamentalResolver } from './demo-runtime';
import { buildAnalystConsensusContext } from './analyst-consensus-context';
import { buildFinancialHealthContext } from './financial-health-context';

export type ExternalFundamentalContext = {
  schemaVersion: 1;
  source: string;
  symbol: string;
  generatedAt: string;
  analystConsensus: any | null;
  financialHealth: any | null;
  warnings: string[];
};

export async function buildExternalFundamentalContext(opts: { symbol: string; fetchFundamental: (o:{ symbol: string })=>Promise<any>, now?: Date }){
  const sym = String(opts.symbol || '').toUpperCase();
  const now = opts.now || new Date();
  const generatedAt = (now instanceof Date ? now : new Date()).toISOString();
  try{
    const fund = await opts.fetchFundamental({ symbol: sym }).catch(()=>null);
    const analyst = buildAnalystConsensusContext({ symbol: sym, fundamental: fund, now });
    const health = buildFinancialHealthContext({ symbol: sym, fundamental: fund, now });

    // Determine alignment summary in Swedish. Conflict takes precedence.
    const summaryLines: string[] = [];
    const warnings: string[] = [];

    const cons = analyst && analyst.consensus ? analyst.consensus : 'UNKNOWN';
    const assess = health && health.assessment ? health.assessment : 'UNKNOWN';

    // Primary alignment
    try{
      // For BUY alignment
      if (cons === 'STRONG_BUY' || cons === 'BUY'){
        if (assess === 'STRONG' || assess === 'HEALTHY') summaryLines.push('Analytiker och finansiell hälsa stödjer köp');
        else if (assess === 'WEAK' || assess === 'MIXED') summaryLines.push('Analytiker stödjer köp men finansiell hälsa är svag');
        else summaryLines.push('Analytiker stödjer köp');
      } else if (cons === 'STRONG_SELL' || cons === 'SELL'){
        if (assess === 'WEAK' || assess === 'MIXED') summaryLines.push('Analytiker och finansiell hälsa stödjer sälj');
        else summaryLines.push('Analytiker stödjer sälj');
      } else if (cons === 'HOLD'){
        summaryLines.push('Rekommendation: Behåll');
      } else if (cons === 'UNKNOWN'){
        if (assess !== 'UNKNOWN') summaryLines.push('Analytiker saknas; bedömning endast från finansiell hälsa');
        else summaryLines.push('Otillräcklig analystdata');
      }
    }catch(_){}

    // Implied upside when available
    try{ if (analyst && typeof analyst.impliedUpsidePercent === 'number'){ const v = analyst.impliedUpsidePercent; summaryLines.push(`Implicerad uppsida: ${v}%`); } }catch(_){ }

    // Supporting/conflicting factors from financial health
    const factors: string[] = [];
    try{ if (health && Array.isArray(health.supportingFactors)) factors.push(...health.supportingFactors); if (health && Array.isArray(health.conflictingFactors)) factors.push(...health.conflictingFactors.map((f:any)=> `Konflikt: ${f}`)); }catch(_){ }
    // Append up to 3 factor lines
    for (const f of (Array.isArray(factors) ? Array.from(new Set(factors)) : []).slice(0,3)){ try{ if (typeof f === 'string' && f) summaryLines.push(f); }catch(_){ } }

    // Warnings dedupe, max 10
    try{ const wset = new Set<string>(); if (analyst && Array.isArray((analyst as any).warnings)) (analyst as any).warnings.forEach((w:any)=> w && wset.add(String(w))); if (health && Array.isArray((health as any).warnings)) (health as any).warnings.forEach((w:any)=> w && wset.add(String(w))); for (const w of Array.from(wset).slice(0,10)) warnings.push(w); }catch(_){ }

    // Ensure max 5 summary lines and stable order
    const finalSummary = (Array.isArray(summaryLines) ? summaryLines : []).slice(0,5).map(s=> String(s));

    const out = { schemaVersion: 1, source: 'VICTOR_EXTERNAL_FUNDAMENTALS', symbol: sym, generatedAt, analystConsensus: analyst, financialHealth: health, summary: finalSummary, warnings: warnings } as any;
    return JSON.parse(JSON.stringify(out));
  }catch(e){ return { schemaVersion: 1, source: 'VICTOR_EXTERNAL_FUNDAMENTALS', symbol: sym, generatedAt, analystConsensus: null, financialHealth: null, summary: [], warnings: ['EXTERNAL_FUNDAMENTAL_BUILD_FAILED'] }; }
}

export function sanitizeExternalFundamentalContextForState(ctx: ExternalFundamentalContext | null){ if (!ctx) return null; return JSON.parse(JSON.stringify(ctx)); }

export default { buildExternalFundamentalContext, sanitizeExternalFundamentalContextForState };
