// Fundamental data normalizer and quality scoring
import { detectFundamentalCapabilities, fetchCompanyProfile, fetchCompanyStatistics, fetchIncomeStatement, fetchBalanceSheet, fetchCashFlow, fetchEarnings, parseTwelveTimestamp } from '../market-data/twelve-data';

export type FundamentalDataStatus = 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT' | 'UNAVAILABLE';

export type FundamentalCompanySnapshot = {
  schemaVersion: 1;
  source: 'TWELVE_DATA_FUNDAMENTALS';

  symbol: string;
  fetchedAt: string;
  fiscalCurrency?: string;
  latestFiscalDate?: string;

  company?: { name?: string; sector?: string; industry?: string; country?: string; exchange?: string };

  profitability: { revenue?: number; revenueGrowthPercent?: number; netIncome?: number; netIncomeGrowthPercent?: number; grossMarginPercent?: number; operatingMarginPercent?: number; netMarginPercent?: number; returnOnEquityPercent?: number };

  financialHealth: { totalDebt?: number; cashAndEquivalents?: number; debtToEquity?: number; currentRatio?: number; interestCoverage?: number };

  cashFlow: { operatingCashFlow?: number; freeCashFlow?: number; capitalExpenditure?: number; freeCashFlowMarginPercent?: number };

  valuation: { marketCapitalization?: number; trailingPe?: number; forwardPe?: number; priceToSales?: number; priceToBook?: number; enterpriseValueToEbitda?: number };

  earnings: { eps?: number; epsGrowthPercent?: number; nextEarningsDate?: string };

  dataStatus: FundamentalDataStatus;
  availableCategories: string[];
  missingCapabilities: string[];
  warnings: string[];
};

export type FundamentalQualityLevel = 'STRONG' | 'MIXED' | 'WEAK' | 'INSUFFICIENT';
export type FundamentalQualitySummary = { level: FundamentalQualityLevel; score: number; positiveFactors: string[]; negativeFactors: string[]; warnings: string[] };

export type FundamentalQualitySignal = { id: string; type: 'FUNDAMENTAL_QUALITY'; origin: 'COMPANY_FINANCIAL_STATEMENTS'; direction: 'BULLISH'|'BEARISH'|'NEUTRAL'; strength: number; symbols: string[]; generatedAt: string };

function clamp01(n: number){ if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(1, n)); }

function safeNum(v: any): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export async function buildFundamentalSnapshot(symbol: string){
  // Delegate to fetch-and-build pipeline to ensure consistent behavior
  const res = await fetchAndBuildFundamentalIntelligence({ symbol });
  return (res && res.snapshot) ? res.snapshot : ({} as FundamentalCompanySnapshot);
}

// --- Period / growth helpers ---
function parseFiscalDate(v: any): string | null {
  try{ if (!v) return null; const d = parseTwelveTimestamp(v); if (!d) return null; return d.toISOString().slice(0,10); }catch(e){ return null; }
}

// Normalize a single row into { date, type, currency }
function normalizeFiscalPeriod(row: any){
  try{
    if (!row) return null;
    const raw = row.fiscalDate || row.date || row.datetime || row.year || row.fiscal_date || row.reportDate;
    const ds = parseFiscalDate(raw);
    if (!ds) return null;
    const d = new Date(ds + 'T00:00:00Z');
    if (isNaN(d.getTime())) return null;
    const month = d.getUTCMonth(); // 0-11
    const day = d.getUTCDate();
    // Determine period type: year-end (Dec 31) => ANNUAL, else quarter => QUARTER
    const type = (month === 11 && day === 31) ? 'ANNUAL' : 'QUARTER';
    const currency = row.currency || row.reportedCurrency || row.fiscalCurrency || null;
    return { date: ds, type, currency };
  }catch(e){ return null; }
}

// Select two comparable periods from an array without mutating input.
function selectComparablePeriods(values: any[] | null){
  if (!Array.isArray(values) || values.length === 0) return [null, null];
  const now = new Date();
  // build list of normalized entries
  const entries = values.map(v=> ({ row: v, norm: normalizeFiscalPeriod(v) })).filter(x=> x.norm !== null) as any[];
  if (entries.length === 0) return [null, null];
  // filter out future periods
  const filtered = entries.filter(e=> { try{ const d = new Date(e.norm.date + 'T00:00:00Z'); return d.getTime() <= now.getTime(); }catch(_){ return false; } });
  if (filtered.length === 0) return [null, null];
  // group by type
  const byType: Record<string, any[]> = {};
  for (const e of filtered){ byType[e.norm.type] = byType[e.norm.type] || []; byType[e.norm.type].push(e); }
  const pickFrom = (list:any[])=>{
    // sort desc by date
    const sorted = list.slice().sort((a:any,b:any)=> a.norm.date < b.norm.date ? 1 : a.norm.date > b.norm.date ? -1 : 0);
    for (let i=0;i<sorted.length-1;i++){
      const a = sorted[i]; const b = sorted[i+1];
      // ensure same currency if both specify one
      const ca = a.norm.currency; const cb = b.norm.currency;
      if (ca && cb && String(ca) !== String(cb)) continue;
      return [a.row, b.row];
    }
    return [null, null];
  };
  // prefer QUARTER
  if (byType['QUARTER'] && byType['QUARTER'].length >= 2){ const p = pickFrom(byType['QUARTER']); if (p[0]) return p; }
  if (byType['ANNUAL'] && byType['ANNUAL'].length >= 2){ const p = pickFrom(byType['ANNUAL']); if (p[0]) return p; }
  return [null, null];
}

function calculateGrowthPercent(values: any[] | null, fieldNames: string[]): number | undefined {
  try{
    const [current, previous] = selectComparablePeriods(values);
    if (!current || !previous) return undefined;
    let cur: any = null; let prev: any = null;
    for (const f of fieldNames){ if (cur === null && (current[f] !== undefined)) cur = current[f]; if (prev === null && (previous[f] !== undefined)) prev = previous[f]; }
    const curN = safeNum(cur); const prevN = safeNum(prev);
    if (curN === undefined || prevN === undefined) return undefined;
    if (prevN === 0) return undefined;
    if (prevN < 0) return undefined;
    const pct = ((curN - prevN) / Math.abs(prevN)) * 100;
    if (!Number.isFinite(pct)) return undefined;
    return Number(Number(pct).toFixed(3));
  }catch(e){ return undefined; }
}

function calculateMarginPercent(valuesNum: any[] | null, fieldNumNames: string[], valuesDenom: any[] | null, fieldDenomNames: string[]): number | undefined {
  try{
    const curNum = ((): number | undefined => { try{ return pickLatestNumeric(valuesNum, fieldNumNames); }catch{return undefined;} })();
    const curDen = ((): number | undefined => { try{ return pickLatestNumeric(valuesDenom, fieldDenomNames); }catch{return undefined;} })();
    if (typeof curNum !== 'number' || typeof curDen !== 'number') return undefined;
    if (curDen === 0) return undefined;
    const pct = (curNum / Math.abs(curDen)) * 100;
    if (!Number.isFinite(pct)) return undefined;
    return Number(Number(pct).toFixed(3));
  }catch(e){ return undefined; }
}

// Safe selection of last completed fiscal period value for numeric field
function pickLatestNumeric(values: any[] | null, fieldNames: string[]){
  try{
    if (!Array.isArray(values) || values.length === 0) return undefined;
    const [current] = selectComparablePeriods(values);
    if (!current) return undefined;
    for (const f of fieldNames){ const v = current[f]; if (v !== undefined && v !== null && v !== ''){ const n = safeNum(v); if (typeof n === 'number') return n; } }
    return undefined;
  }catch(e){ return undefined; }
}

// --- Fetch-and-build pipeline ---
export type FundamentalIntelligenceResult = {
  capabilities: any;
  snapshot: FundamentalCompanySnapshot;
  quality: FundamentalQualitySummary;
  signal: FundamentalQualitySignal;
};

export async function fetchAndBuildFundamentalIntelligence(opts: { symbol: string; now?: string }) : Promise<FundamentalIntelligenceResult> {
  const symbol = String(opts && opts.symbol || '').toUpperCase();
  const now = opts && opts.now ? String(opts.now) : new Date().toISOString();
  const caps = await detectFundamentalCapabilities(symbol).catch(()=> null);
  // prefill minimal snapshot for failure modes
  const baseSnapshot = { schemaVersion: 1 as const, source: 'TWELVE_DATA_FUNDAMENTALS' as const, symbol, fetchedAt: now, company: {}, profitability: {}, financialHealth: {}, cashFlow: {}, valuation: {}, earnings: {}, dataStatus: 'UNAVAILABLE' as const, availableCategories: [], missingCapabilities: [], warnings: [] } as FundamentalCompanySnapshot;
  if (!caps) {
    const quality = buildFundamentalQualitySummary(baseSnapshot);
    const signal = createFundamentalQualitySignal(baseSnapshot, quality);
    return { capabilities: null, snapshot: baseSnapshot, quality, signal } as FundamentalIntelligenceResult;
  }

  // Only fetch endpoints classified as AVAILABLE
  const toFetch = {
    profile: caps.profile === 'AVAILABLE',
    statistics: caps.statistics === 'AVAILABLE',
    income: caps.incomeStatement === 'AVAILABLE',
    balance: caps.balanceSheet === 'AVAILABLE',
    cash: caps.cashFlow === 'AVAILABLE',
    earnings: caps.earnings === 'AVAILABLE'
  };

  // Fetch concurrently but isolate failures
  const [profile, statistics, incomeArr, balanceArr, cashArr, earningsArr] = await Promise.all([
    toFetch.profile ? fetchCompanyProfile(symbol).catch(()=>null) : Promise.resolve(null),
    toFetch.statistics ? fetchCompanyStatistics(symbol).catch(()=>null) : Promise.resolve(null),
    toFetch.income ? fetchIncomeStatement(symbol).catch(()=>null) : Promise.resolve(null),
    toFetch.balance ? fetchBalanceSheet(symbol).catch(()=>null) : Promise.resolve(null),
    toFetch.cash ? fetchCashFlow(symbol).catch(()=>null) : Promise.resolve(null),
    toFetch.earnings ? fetchEarnings(symbol).catch(()=>null) : Promise.resolve(null),
  ]);

  const available: string[] = [];
  const missing: string[] = [];
  if (profile) available.push('profile'); else if (caps.profile !== 'AVAILABLE') missing.push('profile');
  if (statistics) available.push('statistics'); else if (caps.statistics !== 'AVAILABLE') missing.push('statistics');
  if (incomeArr) available.push('incomeStatement'); else if (caps.incomeStatement !== 'AVAILABLE') missing.push('incomeStatement');
  if (balanceArr) available.push('balanceSheet'); else if (caps.balanceSheet !== 'AVAILABLE') missing.push('balanceSheet');
  if (cashArr) available.push('cashFlow'); else if (caps.cashFlow !== 'AVAILABLE') missing.push('cashFlow');
  if (earningsArr) available.push('earnings'); else if (caps.earnings !== 'AVAILABLE') missing.push('earnings');

  // Build snapshot with computed fields only (no raw provider payloads)
  const snapshot: FundamentalCompanySnapshot = {
    schemaVersion: 1,
    source: 'TWELVE_DATA_FUNDAMENTALS',
    symbol,
    fetchedAt: now,
    company: { name: profile?.name, sector: profile?.sector, industry: profile?.industry, country: profile?.country, exchange: profile?.exchange },
    fiscalCurrency: statistics && statistics.currency ? statistics.currency : undefined,
    latestFiscalDate: (incomeArr && incomeArr[0] && (parseFiscalDate(incomeArr[0].fiscalDate || incomeArr[0].date || incomeArr[0].year))) || undefined,
    profitability: {
      revenue: pickLatestNumeric(incomeArr as any, ['revenue','total_revenue','net_revenue','revenue_total']),
      revenueGrowthPercent: calculateGrowthPercent(incomeArr as any, ['revenue','total_revenue','net_revenue']),
      netIncome: pickLatestNumeric(incomeArr as any, ['net_income','netprofit','net_profit']),
      netIncomeGrowthPercent: calculateGrowthPercent(incomeArr as any, ['net_income','netprofit','net_profit']),
      grossMarginPercent: pickLatestNumeric(statistics as any, ['grossMarginPercent','gross_margin','gross_margin_percent','gross_margin_percent']),
      operatingMarginPercent: pickLatestNumeric(statistics as any, ['operatingMarginPercent','operating_margin','operating_margin_percent']),
      netMarginPercent: pickLatestNumeric(statistics as any, ['netMarginPercent','net_margin','net_margin_percent']),
      returnOnEquityPercent: pickLatestNumeric(statistics as any, ['returnOnEquityPercent','roe','return_on_equity']),
    },
    financialHealth: {
      totalDebt: pickLatestNumeric(balanceArr as any, ['total_debt','totalDebt','long_term_debt']),
      cashAndEquivalents: pickLatestNumeric(balanceArr as any, ['cash_and_equivalents','cashAndEquivalents','cash']),
      debtToEquity: pickLatestNumeric(statistics as any, ['debtToEquity','debt_to_equity']),
      currentRatio: pickLatestNumeric(balanceArr as any, ['current_ratio','currentRatio']),
      interestCoverage: pickLatestNumeric(statistics as any, ['interest_coverage','interestCoverage']),
    },
    cashFlow: {
      operatingCashFlow: pickLatestNumeric(cashArr as any, ['operating_cash_flow','operatingCashFlow','cash_from_operations']),
      freeCashFlow: pickLatestNumeric(cashArr as any, ['free_cash_flow','freeCashFlow']),
      capitalExpenditure: pickLatestNumeric(cashArr as any, ['capital_expenditure','capex','capitalExpenditure']),
      freeCashFlowMarginPercent: (function(){ const fcf = pickLatestNumeric(cashArr as any, ['free_cash_flow','freeCashFlow']); const rev = pickLatestNumeric(incomeArr as any, ['revenue','total_revenue']); if (typeof fcf === 'number' && typeof rev === 'number' && rev !== 0) return Number(((fcf / Math.abs(rev)) * 100).toFixed(3)); return undefined; })(),
    },
    valuation: {
      marketCapitalization: pickLatestNumeric(statistics as any, ['marketCapitalization','market_cap','market_capitalization']),
      trailingPe: pickLatestNumeric(statistics as any, ['trailingPe','pe','trailing_pe']),
      forwardPe: pickLatestNumeric(statistics as any, ['forwardPe','forward_pe']),
      priceToSales: pickLatestNumeric(statistics as any, ['priceToSales','price_to_sales']),
      priceToBook: pickLatestNumeric(statistics as any, ['priceToBook','price_to_book']),
      enterpriseValueToEbitda: pickLatestNumeric(statistics as any, ['enterpriseValueToEbitda','ev_to_ebitda']),
    },
    earnings: {
      eps: pickLatestNumeric(earningsArr as any, ['eps','earnings_per_share','eps_basic']),
      epsGrowthPercent: calculateGrowthPercent(earningsArr as any, ['eps','earnings_per_share']),
      nextEarningsDate: (earningsArr && earningsArr[0] && (earningsArr[0].next_earnings_date || earningsArr[0].nextEarningsDate)) || undefined,
    },
    dataStatus: available.length === 0 ? 'UNAVAILABLE' : (available.length >= 4 ? 'COMPLETE' : 'PARTIAL'),
    availableCategories: available.slice(),
    missingCapabilities: missing.slice(),
    warnings: [],
  };

  const quality = buildFundamentalQualitySummary(snapshot);
  const signal = createFundamentalQualitySignal(snapshot, quality);
  return { capabilities: caps, snapshot, quality, signal } as FundamentalIntelligenceResult;
}

export function buildFundamentalQualitySummary(snapshot: FundamentalCompanySnapshot): FundamentalQualitySummary{
  const factorsPos: string[] = [];
  const factorsNeg: string[] = [];
  const warn: string[] = [];
  let score = 0;
  // simple heuristics: revenue and net income growth positive add score; FCF positive adds score; debt ratios subtract
  const rev = snapshot.profitability.revenue;
  const ni = snapshot.profitability.netIncome;
  const fcf = snapshot.cashFlow.freeCashFlow;
  const roe = snapshot.profitability.returnOnEquityPercent;
  if (typeof rev === 'number' && rev > 0){ score += 0.25; factorsPos.push('positive_revenue'); }
  if (typeof ni === 'number' && ni > 0){ score += 0.25; factorsPos.push('positive_net_income'); }
  if (typeof fcf === 'number' && fcf > 0){ score += 0.2; factorsPos.push('positive_free_cash_flow'); }
  if (typeof roe === 'number' && roe > 0) { score += 0.15; factorsPos.push('positive_roe'); }
  const debt = snapshot.financialHealth.totalDebt; const cash = snapshot.financialHealth.cashAndEquivalents;
  if (typeof debt === 'number' && typeof cash === 'number' && debt > cash * 4){ score -= 0.3; factorsNeg.push('high_leverage'); }

  score = clamp01(score);
  let level: FundamentalQualityLevel = 'INSUFFICIENT';
  const availableCount = (snapshot.availableCategories || []).length;
  if (availableCount >= 4 && score >= 0.70) level = 'STRONG';
  else if (availableCount >= 3 && score >= 0.40) level = 'MIXED';
  else if (availableCount >= 3 && score < 0.40) level = 'WEAK';
  else level = 'INSUFFICIENT';

  return { level, score: Number(score.toFixed(3)), positiveFactors: factorsPos, negativeFactors: factorsNeg, warnings: warn };
}

export function createFundamentalQualitySignal(snapshot: FundamentalCompanySnapshot, quality: FundamentalQualitySummary): FundamentalQualitySignal{
  const norm = String(snapshot.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g,'_');
  const id = `fundamental_quality_${norm}`;
  const dir = (quality.level === 'STRONG') ? 'BULLISH' : (quality.level === 'WEAK' ? 'BEARISH' : 'NEUTRAL');
  const strength = clamp01(quality.score);
  return { id, type: 'FUNDAMENTAL_QUALITY', origin: 'COMPANY_FINANCIAL_STATEMENTS', direction: dir, strength, symbols: [snapshot.symbol], generatedAt: new Date().toISOString() };
}

export default { buildFundamentalSnapshot, buildFundamentalQualitySummary, createFundamentalQualitySignal };
