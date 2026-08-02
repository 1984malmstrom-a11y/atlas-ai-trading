export type FinancialHealthAssessment = 'STRONG'|'HEALTHY'|'MIXED'|'WEAK'|'UNKNOWN';

export type FinancialHealthContext = {
  schemaVersion: 1;
  source: string;
  symbol: string;
  observedAt: string | null;
  generatedAt: string;

  assessment: FinancialHealthAssessment;
  confidence: number; // 0..1

  supportingFactors: string[];
  conflictingFactors: string[];

  score: number | null; // normalized 0..100
  warnings: readonly string[];
};

function nowIso(d?: Date){ return (d instanceof Date ? d : new Date()).toISOString(); }
function clamp01(n:number){ if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(1, n)); }

// Build a conservative financial health context using normalized fundamental snapshot
export function buildFinancialHealthContext(opts: { symbol: string; fundamental?: any; now?: Date }) : FinancialHealthContext{
  const sym = String(opts.symbol || '').toUpperCase();
  const now = opts.now ? opts.now : new Date();
  const fund = opts.fundamental || null;
  const generatedAt = nowIso(now);

  const base: FinancialHealthContext = { schemaVersion: 1, source: 'VICTOR_FINANCIAL_HEALTH', symbol: sym, observedAt: null, generatedAt, assessment: 'UNKNOWN', confidence: 0, supportingFactors: [], conflictingFactors: [], score: null, warnings: ['FINANCIAL_HEALTH_INSUFFICIENT'] };

  try{
    const snap = fund && fund.snapshot ? fund.snapshot : fund;
    if (!snap || typeof snap !== 'object') return base;
    base.observedAt = snap.fetchedAt || null;
    // extract conservative metrics when present
    const revenueGrowth = typeof (snap.revenue && snap.revenue.yearOverYearPercent) === 'number' ? snap.revenue.yearOverYearPercent : null;
    const operatingMargin = typeof (snap.profitability && snap.profitability.operatingMarginPercent) === 'number' ? snap.profitability.operatingMarginPercent : null;
    const fcf = typeof (snap.cashFlow && snap.cashFlow.freeCashFlow) === 'number' ? snap.cashFlow.freeCashFlow : null;
    const netDebt = typeof (snap.balance && snap.balance.netDebt) === 'number' ? snap.balance.netDebt : null;
    const roe = typeof (snap.returns && snap.returns.roePercent) === 'number' ? snap.returns.roePercent : null;

    let score = 50; let conf = 0.2; const supports: string[] = []; const conflicts: string[] = [];
    // simple heuristic scoring
    if (typeof revenueGrowth === 'number'){ score += Math.max(-20, Math.min(20, revenueGrowth)); conf += 0.15; if (revenueGrowth > 10) supports.push('Revenue growth strong'); else if (revenueGrowth < 0) conflicts.push('Revenue declining'); }
    if (typeof operatingMargin === 'number'){ score += Math.max(-15, Math.min(15, operatingMargin/2)); conf += 0.12; if (operatingMargin > 15) supports.push('High margins'); if (operatingMargin < 5) conflicts.push('Low operating margin'); }
    if (typeof fcf === 'number'){ score += fcf > 0 ? 10 : -10; conf += 0.12; if (fcf > 0) supports.push('Positive FCF'); else conflicts.push('Negative FCF'); }
    if (typeof netDebt === 'number'){ score += netDebt < 0 ? 8 : (netDebt > 0 ? -8 : 0); conf += 0.12; if (netDebt < 0) supports.push('Net cash position'); if (netDebt > 0 && Math.abs(netDebt) > 0) conflicts.push('Net debt'); }
    if (typeof roe === 'number'){ score += Math.max(-10, Math.min(10, roe/2)); conf += 0.1; if (roe > 10) supports.push('Strong ROE'); if (roe < 5) conflicts.push('Weak ROE'); }

    // normalize
    score = Math.round(Math.max(0, Math.min(100, score)));
    conf = clamp01(conf);
    base.score = score;
    base.confidence = conf;
    base.supportingFactors = supports.slice(0,5);
    base.conflictingFactors = conflicts.slice(0,5);
    base.warnings = [];

    if (score >= 70) base.assessment = 'STRONG'; else if (score >= 55) base.assessment = 'HEALTHY'; else if (score >= 40) base.assessment = 'MIXED'; else base.assessment = 'WEAK';
    return JSON.parse(JSON.stringify(base));
  }catch(e){ return base; }
}

export function sanitizeFinancialHealthContextForState(ctx: FinancialHealthContext | null){ if (!ctx) return null; return JSON.parse(JSON.stringify(ctx)); }

export default { buildFinancialHealthContext, sanitizeFinancialHealthContextForState };
