import { EarningsEventContext } from './earnings-event-context';

export type MarketEventRiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';

export type MarketEventRiskContext = {
  schemaVersion: 1;
  source: 'VICTOR_MARKET_EVENT_RISK';

  symbol: string;
  generatedAt: string;

  earnings: EarningsEventContext | null;
  macro: any | null; // placeholder for MacroEventContext

  overallRisk: MarketEventRiskLevel;
  primaryRiskReason: string | null;
  summary: readonly string[];
  warnings: readonly string[];
};

function capitalizeRisk(r: any){ try{ if (!r) return 'Okänd'; const m = String(r).toUpperCase(); if (m === 'HIGH') return 'Hög'; if (m === 'MODERATE') return 'Måttlig'; if (m === 'LOW') return 'Låg'; return 'Okänd'; }catch(_){ return 'Okänd'; } }

export function buildMarketEventRiskContext(opts: { symbol: string; earnings: EarningsEventContext | null; macro?: any | null; now?: Date }): MarketEventRiskContext{
  const now = opts.now ? opts.now : new Date();
  const sym = String(opts.symbol || '').toUpperCase();
  const earnings = opts.earnings || null;
  const macro = opts.macro || null;
  // combine earnings and macro risks deterministically
  let overall: MarketEventRiskLevel = 'UNKNOWN';
  let reason: string | null = null;
  const summary: string[] = [];
  const warnings = new Set<string>();

  const ers = earnings && earnings.riskLevel ? earnings.riskLevel : null;
  const mrs = macro && macro.riskLevel ? macro.riskLevel : null;

  // helper rank: HIGH > MODERATE > LOW > UNKNOWN
  const rank = (r: MarketEventRiskLevel|'UNKNOWN'|null) => { if (r === 'HIGH') return 3; if (r === 'MODERATE') return 2; if (r === 'LOW') return 1; return 0; };
  const erRank = rank(ers as any);
  const mrRank = rank(mrs as any);
  const top = Math.max(erRank, mrRank);
  if (top === 3) overall = 'HIGH'; else if (top === 2) overall = 'MODERATE'; else if (top === 1) overall = 'LOW'; else overall = 'UNKNOWN';

  // prefer earnings as primary reason when tied or present
  if (ers && erRank === top) reason = 'EARNINGS';
  else if (mrs && mrRank === top) reason = 'MACRO';

  // Build deterministic Swedish summary lines (stable order)
  try{ if (earnings){ summary.push(`Resultat: ${capitalizeRisk(earnings.riskLevel)}`); } }catch(_){ }
  try{ if (macro){ summary.push(`Makro: ${capitalizeRisk(macro.riskLevel)}`); } }catch(_){ }
  // helper to ensure at least one summary line
  if (summary.length === 0) summary.push('Inga händelser');

  // add warning when macro explicitly unavailable
  if (!macro) warnings.add('MACRO_CALENDAR_UNAVAILABLE');

  const out: MarketEventRiskContext = {
    schemaVersion: 1,
    source: 'VICTOR_MARKET_EVENT_RISK',
    symbol: sym,
    generatedAt: now.toISOString(),
    earnings,
    macro,
    overallRisk: overall,
    primaryRiskReason: reason,
    summary: summary.slice(0,5),
    warnings: Array.from(warnings).slice(0,10),
  };
  return JSON.parse(JSON.stringify(out));
}

export function sanitizeMarketEventRiskContextForState(ctx: MarketEventRiskContext | null){
  if (!ctx) return null;
  return {
    schemaVersion: ctx.schemaVersion,
    source: ctx.source,
    symbol: ctx.symbol,
    generatedAt: ctx.generatedAt,
    earnings: ctx.earnings ? require('./earnings-event-context').sanitizeEarningsEventContextForState(ctx.earnings) : null,
    macro: ctx.macro ? require('./macro-event-context').sanitizeMacroEventContextForState(ctx.macro) : null,
    overallRisk: ctx.overallRisk,
    primaryRiskReason: ctx.primaryRiskReason || null,
    summary: Array.isArray(ctx.summary) ? ctx.summary.slice(0,5) : [],
    warnings: Array.isArray(ctx.warnings) ? ctx.warnings.slice(0,10) : [],
  } as MarketEventRiskContext;
}

export default { buildMarketEventRiskContext, sanitizeMarketEventRiskContextForState };
