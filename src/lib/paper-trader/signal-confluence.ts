export type ConfluenceDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'CONFLICTED';

export type ConfluenceSignalItem = {
  id: string;
  type: string;
  origin: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength?: number;
  isPlaceholder: boolean;
};

export type SignalConfluenceSummary = {
  symbol: string;
  generatedAt: string;
  direction: ConfluenceDirection;
  bullishScore: number;
  bearishScore: number;
  neutralCount: number;
  bullishSignalCount: number;
  bearishSignalCount: number;
  usableSignalCount: number;
  placeholderCount: number;
  distinctTypes: number;
  distinctOrigins: number;
  hasIndependentBullishSupport: boolean;
  hasIndependentBearishSupport: boolean;
  hasConflict: boolean;
  strongestBullish?: ConfluenceSignalItem;
  strongestBearish?: ConfluenceSignalItem;
  bullishSignals: ConfluenceSignalItem[];
  bearishSignals: ConfluenceSignalItem[];
  neutralSignals: ConfluenceSignalItem[];
  warnings: string[];
};

function clamp01(v: number){ return Math.max(0, Math.min(1, Number(v) || 0)); }

export type MarketSignalsPackage = { signals?: unknown[] } & Record<string, unknown>;

export function normalizeSignalForConfluence(s: unknown): ConfluenceSignalItem | null {
  try{
    if (s === null || typeof s !== 'object') return null;
    const sig = s as Record<string, unknown>;
    if (!('id' in sig) || !('type' in sig) || !('origin' in sig)) return null;
    const id = String(sig['id']);
    const type = String(sig['type']);
    const origin = String(sig['origin']);
    const dirRaw = ('direction' in sig && typeof sig['direction'] !== 'undefined') ? String(sig['direction']).toUpperCase() : null;
    const direction = (dirRaw === 'BULLISH' ? 'BULLISH' : (dirRaw === 'BEARISH' ? 'BEARISH' : 'NEUTRAL')) as ConfluenceSignalItem['direction'];
    let strength: number | undefined;
    const rawStrength = sig['strength'];
    if (typeof rawStrength === 'number' || (typeof rawStrength === 'string' && !isNaN(Number(rawStrength)))){
      strength = clamp01(Number(rawStrength));
    } else {
      strength = 0.5;
    }
    const isPlaceholder = (type.toUpperCase() === 'MACRO_PLACEHOLDER') || (origin.toUpperCase().includes('MACRO') && (!rawStrength || direction === 'NEUTRAL'));
    return { id, type, origin, direction, strength, isPlaceholder };
  }catch(_){ return null; }
}

function pickStrongest(items: ConfluenceSignalItem[] | undefined){
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const arr = items.slice();
  arr.sort((a,b)=>{
    const sa = clamp01(a.strength||0); const sb = clamp01(b.strength||0);
    if (sa !== sb) return sb - sa; // desc strength
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
  return arr[0];
}

export function buildConfluenceReasoning(summary: SignalConfluenceSummary): string[]{
  const out: string[] = [];
  try{
    if (!summary) return out;
    if (summary.usableSignalCount === 0) out.push('No usable signals');
    if (summary.hasIndependentBullishSupport) out.push(`${summary.bullishSignalCount} bullish signals from ${summary.distinctOrigins} independent sources`);
    else if (summary.bullishSignalCount > 0) out.push(`${summary.bullishSignalCount} bullish signals`);
    if (summary.hasIndependentBearishSupport) out.push(`${summary.bearishSignalCount} bearish signals from ${summary.distinctOrigins} independent sources`);
    else if (summary.bearishSignalCount > 0) out.push(`${summary.bearishSignalCount} bearish signals`);
    if (summary.hasConflict) out.push('Bullish and bearish evidence conflict');
    if (summary.warnings && summary.warnings.length) {
      for (const w of summary.warnings.slice(0,5)) out.push(w.replace(/_/g,' ').toLowerCase());
    }
  }catch(_){ }
  // stabilize order and limit to 5
  const unique = Array.from(new Set(out)).slice(0,5);
  return unique.map(s=> s.charAt(0).toUpperCase() + s.slice(1));
}

export function buildSignalConfluenceSummary(symbol: string, marketSignals: MarketSignalsPackage, generatedAt?: string): SignalConfluenceSummary {
  const sym = String(symbol || '').toUpperCase();
  const gen = generatedAt || new Date().toISOString();
  const all = Array.isArray(marketSignals && (marketSignals as MarketSignalsPackage).signals) ? (marketSignals as MarketSignalsPackage).signals as unknown[] : [];
  const relevant: unknown[] = [];
  for (const s of all){
    try{
      if (!s) continue;
      if (s !== null && typeof s === 'object'){
        const sRec = s as Record<string, unknown>;
        if (Array.isArray(sRec['symbols']) && (sRec['symbols'] as unknown[]).length){
          const upper = (sRec['symbols'] as unknown[]).map(x=> String(x).toUpperCase());
          if (upper.includes(sym)) relevant.push(s);
          else continue;
        } else { relevant.push(s); }
      } else { continue; }
    }catch(_){ }
  }

  const normed: ConfluenceSignalItem[] = [];
  for (const r of relevant){ const n = normalizeSignalForConfluence(r); if (n) normed.push(n); }

  const bullish = normed.filter(n=> n.direction === 'BULLISH' && !n.isPlaceholder);
  const bearish = normed.filter(n=> n.direction === 'BEARISH' && !n.isPlaceholder);
  const neutral = normed.filter(n=> n.direction === 'NEUTRAL' && !n.isPlaceholder);
  const placeholders = normed.filter(n=> n.isPlaceholder);

  const bullishScore = bullish.reduce((s,n)=> s + (n.strength||0), 0);
  const bearishScore = bearish.reduce((s,n)=> s + (n.strength||0), 0);

  const distinctTypes = new Set(normed.map(n=> n.type)).size;
  const distinctOrigins = new Set(normed.map(n=> n.origin)).size;

  const hasIndependentBullishSupport = (new Set(bullish.map(b=> b.type)).size >= 2) && (new Set(bullish.map(b=> b.origin)).size >= 2);
  const hasIndependentBearishSupport = (new Set(bearish.map(b=> b.type)).size >= 2) && (new Set(bearish.map(b=> b.origin)).size >= 2);

  const maxScore = Math.max(0, bullishScore, bearishScore);
  const minScore = Math.min(bullishScore, bearishScore);
  const hasConflict = (bullishScore > 0 && bearishScore > 0) && (minScore >= 0.4 * maxScore);

  let direction: ConfluenceDirection = 'NEUTRAL';
  if (hasConflict) direction = 'CONFLICTED';
  else if (bullishScore > bearishScore && bullishScore > 0) direction = 'BULLISH';
  else if (bearishScore > bullishScore && bearishScore > 0) direction = 'BEARISH';
  else direction = 'NEUTRAL';

  const strongestBullish = pickStrongest(bullish);
  const strongestBearish = pickStrongest(bearish);

  const warningsSet = new Set<string>();
  if ((bullish.length + bearish.length + neutral.length) === 0) warningsSet.add('NO_USABLE_SIGNALS');
  if (placeholders.length > 0 && (bullish.length + bearish.length + neutral.length) === 0) warningsSet.add('ONLY_PLACEHOLDERS');
  if (new Set(normed.map(n=> n.type)).size === 1 && normed.length > 0) warningsSet.add('SINGLE_SIGNAL_TYPE');
  if (new Set(normed.map(n=> n.origin)).size === 1 && normed.length > 0) warningsSet.add('SINGLE_SIGNAL_ORIGIN');
  if (hasConflict) warningsSet.add('BULLISH_BEARISH_CONFLICT');
  const hasTech = normed.some(n=> ['TECHNICAL_MOMENTUM','TREND_QUALITY','SUPPLY_DEMAND_ZONE','TECHNICAL_SIGNAL'].includes(String(n.type).toUpperCase()));
  if (!hasTech) warningsSet.add('MISSING_TECHNICAL_HISTORY');
  const hasVol = normed.some(n=> String(n.type).toUpperCase() === 'VOLUME_CONFIRMATION');
  if (!hasVol) warningsSet.add('MISSING_VOLUME_HISTORY');
  const macroSignals = normed.filter(n=> String(n.origin).toUpperCase().includes('MACRO'));
  if (macroSignals.length > 0 && macroSignals.every(m=> m.isPlaceholder)) warningsSet.add('MACRO_DATA_UNAVAILABLE');

  const warnings = Array.from(warningsSet).sort();

  const summary: SignalConfluenceSummary = {
    symbol: sym,
    generatedAt: gen,
    direction,
    bullishScore: Number(Number(bullishScore).toFixed(3)),
    bearishScore: Number(Number(bearishScore).toFixed(3)),
    neutralCount: neutral.length,
    bullishSignalCount: bullish.length,
    bearishSignalCount: bearish.length,
    usableSignalCount: bullish.length + bearish.length + neutral.length,
    placeholderCount: placeholders.length,
    distinctTypes,
    distinctOrigins,
    hasIndependentBullishSupport,
    hasIndependentBearishSupport,
    hasConflict,
    strongestBullish: strongestBullish ? { id: strongestBullish.id, type: strongestBullish.type, origin: strongestBullish.origin, direction: strongestBullish.direction, strength: clamp01(strongestBullish.strength||0), isPlaceholder: strongestBullish.isPlaceholder } : undefined,
    strongestBearish: strongestBearish ? { id: strongestBearish.id, type: strongestBearish.type, origin: strongestBearish.origin, direction: strongestBearish.direction, strength: clamp01(strongestBearish.strength||0), isPlaceholder: strongestBearish.isPlaceholder } : undefined,
    bullishSignals: bullish,
    bearishSignals: bearish,
    neutralSignals: neutral,
    warnings
  };
  return summary;
}

// Build sanitized audit payload containing only allowed fields.
export function buildConfluenceAuditPayload(cycleId: string, summary: SignalConfluenceSummary, reasoning?: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    kind: 'SIGNAL_CONFLUENCE_SNAPSHOT',
    cycleId,
    symbol: summary.symbol,
    generatedAt: summary.generatedAt,
    direction: summary.direction,
    bullishScore: summary.bullishScore,
    bearishScore: summary.bearishScore,
    neutralCount: summary.neutralCount,
    bullishSignalCount: summary.bullishSignalCount,
    bearishSignalCount: summary.bearishSignalCount,
    usableSignalCount: summary.usableSignalCount,
    placeholderCount: summary.placeholderCount,
    distinctTypes: summary.distinctTypes,
    distinctOrigins: summary.distinctOrigins,
    hasIndependentBullishSupport: summary.hasIndependentBullishSupport,
    hasIndependentBearishSupport: summary.hasIndependentBearishSupport,
    hasConflict: summary.hasConflict,
    warnings: Array.isArray(summary.warnings) ? summary.warnings.slice() : [],
    reasoning: Array.isArray(reasoning) ? reasoning.slice(0,5) : buildConfluenceReasoning(summary)
  };
  if (summary.strongestBullish) out['strongestBullish'] = { id: summary.strongestBullish.id, type: summary.strongestBullish.type, origin: summary.strongestBullish.origin, strength: summary.strongestBullish.strength };
  if (summary.strongestBearish) out['strongestBearish'] = { id: summary.strongestBearish.id, type: summary.strongestBearish.type, origin: summary.strongestBearish.origin, strength: summary.strongestBearish.strength };
  return out;
}

export type AnalysisQualityLevel = 'COMPLETE' | 'LIMITED' | 'INSUFFICIENT';

export type AnalysisQualitySummary = {
  level: AnalysisQualityLevel;
  score: number; // 0..1
  usableSignalCount: number;
  distinctTypes: number;
  distinctOrigins: number;
  missingCapabilities: string[];
};

const MISSING_CAP_ORDER = ['TECHNICAL_HISTORY','VOLUME_HISTORY','MACRO_DATA','SIGNAL_DIVERSITY','ORIGIN_DIVERSITY','USABLE_SIGNALS'];

export function buildAnalysisQualitySummary(summary: SignalConfluenceSummary): AnalysisQualitySummary {
  const usable = Number(summary.usableSignalCount || 0);
  const types = Number(summary.distinctTypes || 0);
  const origins = Number(summary.distinctOrigins || 0);
  const placeholders = Number(summary.placeholderCount || 0);
  const warnings = Array.isArray(summary.warnings) ? summary.warnings.slice() : [];

  const missing: string[] = [];
  if (warnings.indexOf('MISSING_TECHNICAL_HISTORY') !== -1) missing.push('TECHNICAL_HISTORY');
  if (warnings.indexOf('MISSING_VOLUME_HISTORY') !== -1) missing.push('VOLUME_HISTORY');
  if (warnings.indexOf('MACRO_DATA_UNAVAILABLE') !== -1) missing.push('MACRO_DATA');
  if (types < 3) missing.push('SIGNAL_DIVERSITY');
  if (origins < 3) missing.push('ORIGIN_DIVERSITY');
  if (usable === 0) missing.push('USABLE_SIGNALS');

  // score components normalized conservatively
  const compUsable = Math.min(1, usable / 4); // 4 or more -> 1
  const compTypes = Math.min(1, types / 3); // 3 or more -> 1
  const compOrigins = Math.min(1, origins / 3); // 3 or more -> 1
  const compPlaceholders = Math.max(0, 1 - (placeholders / Math.max(1, usable + placeholders)));
  const compWarnings = Math.max(0, 1 - (warnings.length / 6));

  // weighted aggregate (conservative weights)
  const score = clamp01(0.35 * compUsable + 0.25 * compTypes + 0.2 * compOrigins + 0.1 * compPlaceholders + 0.1 * compWarnings);

  let level: AnalysisQualityLevel = 'INSUFFICIENT';
  if (score >= 0.75 && usable >= 4 && types >= 3 && origins >= 3 && warnings.indexOf('NO_USABLE_SIGNALS') === -1 && !(usable === 0 && placeholders > 0)) level = 'COMPLETE';
  else if (score >= 0.35 && usable >= 2 && types >= 2 && origins >= 2) level = 'LIMITED';
  else level = 'INSUFFICIENT';

  // dedupe and stable order for missingCapabilities
  const dedup = Array.from(new Set(missing));
  const ordered = MISSING_CAP_ORDER.filter(x => dedup.includes(x));

  return { level, score: Number(score.toFixed(3)), usableSignalCount: usable, distinctTypes: types, distinctOrigins: origins, missingCapabilities: ordered };
}

export function buildConfluenceDiagnostics(summary: SignalConfluenceSummary, quality: AnalysisQualitySummary, reasoning?: string[]) {
  return {
    direction: summary.direction,
    bullishScore: summary.bullishScore,
    bearishScore: summary.bearishScore,
    hasConflict: summary.hasConflict,
    hasIndependentBullishSupport: summary.hasIndependentBullishSupport,
    hasIndependentBearishSupport: summary.hasIndependentBearishSupport,
    warnings: Array.isArray(summary.warnings) ? summary.warnings.slice() : [],
    reasoning: Array.isArray(reasoning) ? reasoning.slice(0,5) : buildConfluenceReasoning(summary),
    analysisQuality: quality
  };
}

export type DecisionIntelligenceSnapshot = {
  cycleId: string;
  symbol: string;
  generatedAt: string;
  direction: ConfluenceDirection;
  bullishScore: number;
  bearishScore: number;
  hasConflict: boolean;
  hasIndependentBullishSupport: boolean;
  hasIndependentBearishSupport: boolean;
  analysisQuality: AnalysisQualitySummary;
  strongestBullish?: { id: string; type: string; origin: string; strength: number };
  strongestBearish?: { id: string; type: string; origin: string; strength: number };
  selectedSupportingSignals: Array<{ id: string; type: string; origin: string }>;
  warnings: string[];
  reasoning: string[];
  schemaVersion?: number;
  source?: string;
  // Optional diagnostic-only shadow decision (sanitized)
  contextAwareShadowDecision?: import('./context-aware-shadow-decision').ContextAwareShadowDecision | null;
  companyNewsContext?: import('./company-news-context').CompanyNewsContext | null;
};

// Market context diagnostics block added for decision intelligence (diagnostic-only)
export type DecisionHistoricalContextDiagnostics = {
  dataQuality: import('./historical-market-context').HistoricalDataQuality | null;
  shortTrend: import('./historical-market-context').HistoricalTrendDirection | null;
  mediumTrend: import('./historical-market-context').HistoricalTrendDirection | null;
  longTrend: import('./historical-market-context').HistoricalTrendDirection | null;
  trendAgreement: number | null;
  volatilityState: import('./historical-market-context').HistoricalVolatilityState | null;
  momentumPersistence: import('./historical-market-context').HistoricalMomentumPersistence | null;
  currentDrawdownPercent: number | null;
  maxDrawdownPercent: number | null;
  recoveryPercent: number | null;
  rangePosition: number | null;
  volumeTrend: import('./historical-market-context').HistoricalMarketContext['volumeTrend'] | null;
  warnings: string[];
};

export type DecisionMarketRegimeDiagnostics = {
  primaryRegime: import('./market-regime-intelligence').MarketRegimeIntelligenceSnapshot['primaryRegime'] | null;
  volatilityRegime: import('./market-regime-intelligence').MarketRegimeIntelligenceSnapshot['volatilityRegime'] | null;
  riskRegime: import('./market-regime-intelligence').MarketRegimeIntelligenceSnapshot['riskRegime'] | null;
  confidence: number | null;
  strength: import('./market-regime-intelligence').MarketRegimeIntelligenceSnapshot['strength'] | null;
  quality: import('./market-regime-intelligence').MarketRegimeIntelligenceSnapshot['quality'] | null;
  supportingSignals: string[];
  conflictingSignals: string[];
  warnings: string[];
};

export type MarketContextDiagnostics = {
  historicalContext: DecisionHistoricalContextDiagnostics | null;
  marketRegime: DecisionMarketRegimeDiagnostics | null;
  contextAlignment: 'SUPPORTIVE'|'CONFLICTING'|'NEUTRAL'|'INSUFFICIENT';
  contextSummary: string[];
};

// Build typed diagnostics purely from inputs
export function buildDecisionMarketContextDiagnostics(opts: { action: 'BUY'|'SELL'|'HOLD'|'UNKNOWN'; confidence?: number | null; historicalContext?: import('./historical-market-context').HistoricalMarketContextSnapshot | null; marketRegime?: import('./market-regime-intelligence').MarketRegimeIntelligenceSnapshot | null }): MarketContextDiagnostics {
  const action = opts.action || 'UNKNOWN';
  const hist = opts.historicalContext || null;
  const mr = opts.marketRegime || null;

  const histDiag: DecisionHistoricalContextDiagnostics | null = hist ? {
    dataQuality: hist.dataQuality || null,
    shortTrend: hist.shortTrend || null,
    mediumTrend: hist.mediumTrend || null,
    longTrend: hist.longTrend || null,
    trendAgreement: typeof hist.trendAgreement === 'number' ? hist.trendAgreement : null,
    volatilityState: hist.volatilityState || null,
    momentumPersistence: hist.momentumPersistence || null,
    currentDrawdownPercent: typeof hist.currentDrawdownPercent === 'number' ? hist.currentDrawdownPercent : null,
    maxDrawdownPercent: typeof hist.maxDrawdownPercent === 'number' ? hist.maxDrawdownPercent : null,
    recoveryPercent: typeof hist.recoveryPercent === 'number' ? hist.recoveryPercent : null,
    rangePosition: typeof hist.rangePosition === 'number' ? hist.rangePosition : null,
    volumeTrend: hist.volumeTrend || null,
    warnings: Array.isArray(hist.warnings) ? Array.from(new Set(hist.warnings)).slice(0,10) : []
  } : null;

  const mrDiag: DecisionMarketRegimeDiagnostics | null = mr ? {
    primaryRegime: mr.primaryRegime || null,
    volatilityRegime: mr.volatilityRegime || null,
    riskRegime: mr.riskRegime || null,
    confidence: typeof mr.confidence === 'number' ? mr.confidence : null,
    strength: mr.strength || null,
    quality: mr.quality || null,
    supportingSignals: Array.isArray(mr.supportingSignals) ? mr.supportingSignals.slice(0,10) : [],
    conflictingSignals: Array.isArray(mr.conflictingSignals) ? mr.conflictingSignals.slice(0,10) : [],
    warnings: Array.isArray(mr.warnings) ? mr.warnings.slice(0,10) : []
  } : null;

  // Alignment rules
  let alignment: MarketContextDiagnostics['contextAlignment'] = 'INSUFFICIENT';
  if (!histDiag && !mrDiag) alignment = 'INSUFFICIENT';
  else if (action === 'HOLD' || action === 'UNKNOWN') alignment = (histDiag || mrDiag) ? 'NEUTRAL' : 'INSUFFICIENT';
  else {
    // derive from marketRegime primarily when present, else historical trends
    const primary = mrDiag && mrDiag.primaryRegime ? mrDiag.primaryRegime : null;
    const risk = mrDiag && mrDiag.riskRegime ? mrDiag.riskRegime : null;
    if (primary && ((action === 'BUY' && primary === 'BULL_TREND') || (action === 'SELL' && primary === 'BEAR_TREND')) && risk !== 'RISK_OFF') alignment = 'SUPPORTIVE';
    else if (primary && ((action === 'BUY' && primary === 'BEAR_TREND') || (action === 'SELL' && primary === 'BULL_TREND')) ) alignment = 'CONFLICTING';
    else if (risk === 'RISK_OFF' && action === 'BUY') alignment = 'CONFLICTING';
    else alignment = 'NEUTRAL';
  }

  // Build deterministic context summary (max 5 lines)
  const sums: string[] = [];
  try{
    if (histDiag){
      if (histDiag.shortTrend && histDiag.longTrend && histDiag.shortTrend === histDiag.longTrend) sums.push(`Den korta och långa trenden pekar ${histDiag.shortTrend === 'UP' ? 'uppåt' : histDiag.shortTrend === 'DOWN' ? 'nedåt' : 'sidoled'}.`);
      else if (histDiag.shortTrend && histDiag.longTrend && histDiag.shortTrend !== histDiag.longTrend) sums.push(`Kort trend ${histDiag.shortTrend === 'UP' ? 'uppåt' : histDiag.shortTrend === 'DOWN' ? 'nedåt' : 'sidoled'} mot lång trend ${histDiag.longTrend === 'UP' ? 'uppåt' : histDiag.longTrend === 'DOWN' ? 'nedåt' : 'sidoled'}.`);
      if (histDiag.volatilityState && histDiag.volatilityState !== 'INSUFFICIENT') sums.push(`Volatiliteten är ${histDiag.volatilityState.toLowerCase()}.`);
      if (typeof histDiag.currentDrawdownPercent === 'number' && typeof histDiag.maxDrawdownPercent === 'number') sums.push(`Instrumentet handlas ${Math.round((histDiag.rangePosition??0)*100)}% inuti senaste intervall.`);
      if (typeof histDiag.rangePosition === 'number') sums.push(`Range-position: ${Math.round(histDiag.rangePosition * 100)}% av intervall.`);
    }
    if (mrDiag){
      if (mrDiag.primaryRegime) sums.push(`Marknadsregimen är ${mrDiag.primaryRegime.toLowerCase().replace(/_/g,' ')}.`);
      if (mrDiag.riskRegime) sums.push(`Regimen är ${mrDiag.riskRegime.toLowerCase().replace(/_/g,' ')}.`);
    }
  }catch(_){ }
  // stable ordering and dedupe
  const deduped = Array.from(new Set(sums)).slice(0,5);

  return { historicalContext: histDiag, marketRegime: mrDiag, contextAlignment: alignment, contextSummary: deduped };
}


// Schema/versioning for Decision Intelligence primary snapshot
export const DECISION_INTELLIGENCE_SCHEMA_VERSION = 1;
export const DECISION_INTELLIGENCE_SOURCE = 'VICTOR_DECISION_INTELLIGENCE';

export function buildDecisionIntelligenceSnapshot(opts: { cycleId: string; summary: SignalConfluenceSummary; analysisQuality: AnalysisQualitySummary; selectedSupportingSignalIds?: string[]; reasoning?: string[] }): DecisionIntelligenceSnapshot {
  const { cycleId, summary, analysisQuality, selectedSupportingSignalIds, reasoning } = opts;
  const genAt = summary.generatedAt || new Date().toISOString();
  // Build selectedSupportingSignals metadata from summary arrays while preserving order and filtering duplicates
  const idSet = new Set<string>();
  const orderedIds = Array.isArray(selectedSupportingSignalIds) ? selectedSupportingSignalIds.map(id => String(id)) : [];
  const signalsPool = ([] as ConfluenceSignalItem[]).concat(summary.bullishSignals || [], summary.bearishSignals || [], summary.neutralSignals || []);
  const metadata: Array<{ id: string; type: string; origin: string }> = [];
  for (const id of orderedIds){
    if (!id) continue;
    const i = idSet.has(id) ? null : signalsPool.find(s => s && String(s.id) === String(id));
    if (i && !idSet.has(i.id) && i.id && i.type && i.origin){ idSet.add(i.id); metadata.push({ id: i.id, type: i.type, origin: i.origin }); }
  }
  // stable warnings copy
  const warnings = Array.isArray(summary.warnings) ? Array.from(new Set(summary.warnings)).sort() : [];
  const reason = Array.isArray(reasoning) ? reasoning.slice(0,5) : buildConfluenceReasoning(summary).slice(0,5);
  const snap: DecisionIntelligenceSnapshot = {
    cycleId,
    symbol: summary.symbol,
    generatedAt: genAt,
    direction: summary.direction,
    bullishScore: summary.bullishScore,
    bearishScore: summary.bearishScore,
    hasConflict: summary.hasConflict,
    hasIndependentBullishSupport: summary.hasIndependentBullishSupport,
    hasIndependentBearishSupport: summary.hasIndependentBearishSupport,
    analysisQuality,
    strongestBullish: summary.strongestBullish ? { id: summary.strongestBullish.id, type: summary.strongestBullish.type, origin: summary.strongestBullish.origin, strength: summary.strongestBullish.strength || 0 } : undefined,
    strongestBearish: summary.strongestBearish ? { id: summary.strongestBearish.id, type: summary.strongestBearish.type, origin: summary.strongestBearish.origin, strength: summary.strongestBearish.strength || 0 } : undefined,
    selectedSupportingSignals: metadata,
    warnings,
    reasoning: reason
    ,schemaVersion: DECISION_INTELLIGENCE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_SOURCE
  };
  return snap;
}

export function createPerCycleDecisionIntelligenceResolver(opts: { cycleId: string; generatedAt?: string; buildSummary: (symbol: string, marketSignals?: MarketSignalsPackage) => Promise<SignalConfluenceSummary | null>; buildQuality?: (summary: SignalConfluenceSummary) => AnalysisQualitySummary; buildReasoning?: (summary: SignalConfluenceSummary) => string[]; appendAudit?: (payload: DecisionIntelligenceSnapshot) => Promise<void> }){
  const cycleId = opts.cycleId;
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const buildQualityFn = opts.buildQuality || ((s)=> buildAnalysisQualitySummary(s));
  const buildReasoningFn = opts.buildReasoning || ((s)=> buildConfluenceReasoning(s));
  const buildSummaryFn = opts.buildSummary;
  const appendAuditFn = opts.appendAudit;

  const summaryBySymbol = new Map<string, SignalConfluenceSummary | null>();
  const qualityBySymbol = new Map<string, AnalysisQualitySummary>();
  const reasoningBySymbol = new Map<string, string[]>();
  const snapshotBySymbol = new Map<string, DecisionIntelligenceSnapshot>();
  const auditAppended = new Set<string>();

  function normalize(sym: string){ return String(sym||'').toUpperCase(); }

  return {
    async resolveAnalysis(opts2: { symbol: string; marketSignals?: MarketSignalsPackage }){
      const sym = normalize(opts2.symbol);
      if (!sym) return null;
      // ensure summary present
      let summary = summaryBySymbol.get(sym);
      if (typeof summary === 'undefined'){
        try{ summary = await buildSummaryFn(sym, opts2.marketSignals); }catch(_){ summary = null; }
        summaryBySymbol.set(sym, summary);
      }
      if (!summary){
        const neutral: SignalConfluenceSummary = {
          symbol: sym,
          generatedAt: generatedAt,
          direction: 'NEUTRAL',
          bullishScore: 0, bearishScore: 0, neutralCount: 0, bullishSignalCount: 0, bearishSignalCount: 0, usableSignalCount: 0, placeholderCount: 0, distinctTypes: 0, distinctOrigins: 0, hasIndependentBullishSupport: false, hasIndependentBearishSupport: false, hasConflict: false, strongestBullish: undefined, strongestBearish: undefined, bullishSignals: [], bearishSignals: [], neutralSignals: [], warnings: []
        };
        summary = neutral;
        summaryBySymbol.set(sym, summary);
      }
      let quality = qualityBySymbol.get(sym);
      if (!quality){ try{ quality = buildQualityFn(summary); }catch(_){ quality = buildAnalysisQualitySummary(summary); } qualityBySymbol.set(sym, quality); }
      let reasoning = reasoningBySymbol.get(sym);
      if (!reasoning){ try{ reasoning = buildReasoningFn(summary).slice(0,5); }catch(_){ reasoning = buildConfluenceReasoning(summary).slice(0,5); } reasoningBySymbol.set(sym, reasoning); }
      let snap = snapshotBySymbol.get(sym);
      if (!snap){ snap = buildDecisionIntelligenceSnapshot({ cycleId, summary, analysisQuality: quality, selectedSupportingSignalIds: [], reasoning }); snapshotBySymbol.set(sym, snap); }
      return snap;
    },
    async finalizeSnapshot(opts2: { symbol: string; selectedSupportingSignalIds?: string[] }){
      const sym = normalize(opts2.symbol);
      if (!sym) return null;
      const summary = summaryBySymbol.get(sym) || null;
      const quality = qualityBySymbol.get(sym) || (summary ? buildAnalysisQualitySummary(summary) : buildAnalysisQualitySummary({ symbol: sym, generatedAt: generatedAt, direction: 'NEUTRAL', bullishScore: 0, bearishScore: 0, neutralCount: 0, bullishSignalCount: 0, bearishSignalCount: 0, usableSignalCount: 0, placeholderCount: 0, distinctTypes: 0, distinctOrigins: 0, hasIndependentBullishSupport: false, hasIndependentBearishSupport: false, hasConflict: false, strongestBullish: undefined, strongestBearish: undefined, bullishSignals: [], bearishSignals: [], neutralSignals: [], warnings: [] } as any));
      const reasoning = reasoningBySymbol.get(sym) || [];
      let snap = snapshotBySymbol.get(sym);
      if (!snap){
        // build a base snapshot even if resolveAnalysis wasn't called explicitly
        const baseSummary = summary || ({ symbol: sym, generatedAt: generatedAt, direction: 'NEUTRAL', bullishScore: 0, bearishScore: 0, neutralCount: 0, bullishSignalCount: 0, bearishSignalCount: 0, usableSignalCount: 0, placeholderCount: 0, distinctTypes: 0, distinctOrigins: 0, hasIndependentBullishSupport: false, hasIndependentBearishSupport: false, hasConflict: false, strongestBullish: undefined, strongestBearish: undefined, bullishSignals: [], bearishSignals: [], neutralSignals: [], warnings: [] } as SignalConfluenceSummary);
        snap = buildDecisionIntelligenceSnapshot({ cycleId, summary: baseSummary, analysisQuality: quality, selectedSupportingSignalIds: opts2.selectedSupportingSignalIds || [], reasoning });
        snapshotBySymbol.set(sym, snap);
      } else {
        if (Array.isArray(opts2.selectedSupportingSignalIds) && opts2.selectedSupportingSignalIds.length > 0){
          const newSnap = buildDecisionIntelligenceSnapshot({ cycleId, summary: summary as any, analysisQuality: quality, selectedSupportingSignalIds: opts2.selectedSupportingSignalIds, reasoning });
          Object.keys(newSnap).forEach((k)=>{ (snap as any)[k] = (newSnap as any)[k]; });
        }
      }
      if (appendAuditFn && !auditAppended.has(sym)){
        try{ await appendAuditFn(snap); auditAppended.add(sym); }catch(_){ }
      }
      return snap;
    },
    // convenience: run analysis then finalize if selectedSupportingSignalIds provided
    async resolve(opts2: { symbol: string; marketSignals?: MarketSignalsPackage; selectedSupportingSignalIds?: string[] }){
      await this.resolveAnalysis({ symbol: opts2.symbol, marketSignals: opts2.marketSignals });
      if (Array.isArray(opts2.selectedSupportingSignalIds) && opts2.selectedSupportingSignalIds.length > 0) return await this.finalizeSnapshot({ symbol: opts2.symbol, selectedSupportingSignalIds: opts2.selectedSupportingSignalIds });
      return await this.resolveAnalysis({ symbol: opts2.symbol, marketSignals: opts2.marketSignals });
    },
    // read-only runtime stats and helpers (do not expose internal Maps)
    getStats(){
      try{
        return { analyzedSymbols: summaryBySymbol.size, finalizedSymbols: snapshotBySymbol.size, auditedSymbols: auditAppended.size };
      }catch(_){ return { analyzedSymbols: 0, finalizedSymbols: 0, auditedSymbols: 0 }; }
    },
    hasSymbol(sym: string){ try{ return summaryBySymbol.has(String(sym||'').toUpperCase()); }catch(_){ return false; } }
  };
}

export default { normalizeSignalForConfluence, buildSignalConfluenceSummary, buildConfluenceReasoning };
