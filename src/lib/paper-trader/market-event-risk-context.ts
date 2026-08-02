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

export function buildMarketEventRiskContext(opts: { symbol: string; earnings: EarningsEventContext | null; macro?: any | null; now?: Date }): MarketEventRiskContext{
  const now = opts.now ? opts.now : new Date();
  const sym = String(opts.symbol || '').toUpperCase();
  const earnings = opts.earnings || null;
  const macro = opts.macro || null;

  // determine overall risk primarily from earnings then macro
  let overall: MarketEventRiskLevel = 'UNKNOWN';
  let reason: string | null = null;
  const summary: string[] = [];
  const warnings = new Set<string>();

  if (earnings && earnings.riskLevel){
    overall = earnings.riskLevel as MarketEventRiskLevel;
    reason = 'EARNINGS';
    summary.push(`Earnings: ${earnings.riskLevel}`);
  }

  // macro not implemented: leave macro null and UNKNOWN
  if (!earnings){ overall = 'UNKNOWN'; reason = null; warnings.add('MACRO_CALENDAR_UNAVAILABLE'); }

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
    macro: null,
    overallRisk: ctx.overallRisk,
    primaryRiskReason: ctx.primaryRiskReason || null,
    summary: Array.isArray(ctx.summary) ? ctx.summary.slice(0,5) : [],
    warnings: Array.isArray(ctx.warnings) ? ctx.warnings.slice(0,10) : [],
  } as MarketEventRiskContext;
}

export default { buildMarketEventRiskContext, sanitizeMarketEventRiskContextForState };
