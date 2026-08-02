// Context-aware Shadow Decision - pure, deterministic, typed
import type { MarketContextDiagnostics } from './signal-confluence';

export type ShadowDecisionAction = 'BUY' | 'SELL' | 'HOLD';

export type ShadowDecisionIntervention =
  | 'NONE'
  | 'CONFIDENCE_BOOST'
  | 'CONFIDENCE_REDUCTION'
  | 'ACTION_TO_HOLD';

export type ContextAwareShadowDecision = {
  schemaVersion: 1;
  source: 'VICTOR_CONTEXT_AWARE_SHADOW';

  symbol: string;
  observedAt: string | null;
  generatedAt: string;

  actualAction: ShadowDecisionAction;
  actualConfidence: number;

  shadowAction: ShadowDecisionAction;
  shadowConfidence: number;

  actionChanged: boolean;
  confidenceDelta: number;

  contextAlignment: 'SUPPORTIVE' | 'CONFLICTING' | 'NEUTRAL' | 'INSUFFICIENT';

  intervention: ShadowDecisionIntervention;

  supportingReasons: readonly string[];
  conflictingReasons: readonly string[];
  warnings: readonly string[];
};

export type ContextAwareShadowDecisionInput = {
  symbol: string;
  actualAction: ShadowDecisionAction;
  actualConfidence: number;
  marketContextDiagnostics: MarketContextDiagnostics | null | undefined;
  now?: Date;
};

// Helpers
function normalizeConfidenceToPercent(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // If in 0..1, assume fraction and convert
  if (n >= 0 && n <= 1) return Math.round(n * 100);
  return Math.round(n);
}

function clampConfidence(v: number): number { return Math.max(0, Math.min(100, Number(v) || 0)); }
function roundConfidence(v: number): number { return Math.round(Number(v) || 0); }

function stableSliceStrings(arr: any[] | undefined, max = 5){
  if (!Array.isArray(arr)) return [] as string[];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of arr){ try{ const s = String(a || '').trim(); if (!s) continue; if (!seen.has(s)){ seen.add(s); out.push(s); if (out.length >= max) break; } }catch(_){ continue; } }
  return out;
}

export function buildContextAwareShadowDecision(input: ContextAwareShadowDecisionInput): ContextAwareShadowDecision {
  const now = input.now instanceof Date ? input.now : new Date();
  const generatedAt = now.toISOString();
  const symbol = String(input.symbol || '').toUpperCase();

  const actualConfidenceRaw = normalizeConfidenceToPercent(input.actualConfidence);
  const actualConfidence = clampConfidence(actualConfidenceRaw);

  const diag = input.marketContextDiagnostics || null;
  const alignment = diag && typeof diag.contextAlignment === 'string' ? diag.contextAlignment : 'INSUFFICIENT';

  // default shadow mirrors actual
  let shadowAction: ShadowDecisionAction = input.actualAction;
  let shadowConfidence = actualConfidence;
  let intervention: ShadowDecisionIntervention = 'NONE';

  const supportingReasons: string[] = [];
  const conflictingReasons: string[] = [];
  const warnings: string[] = [];

  // Helper to push reason (swedish) with dedupe later
  function pushSupporting(s: string){ supportingReasons.push(s); }
  function pushConflicting(s: string){ conflictingReasons.push(s); }
  function pushWarning(s: string){ warnings.push(s); }

  if (alignment === 'INSUFFICIENT'){
    pushWarning('Marknadskontexten är otillräcklig för en shadow-justering.');
    // mirror
  } else if (alignment === 'NEUTRAL'){
    // mirror
  } else if (alignment === 'SUPPORTIVE'){
    // Boost confidence conservatively by up to +5
    const boost = 5; // deterministic choice for tydligt stöd
    shadowConfidence = clampConfidence(shadowConfidence + boost);
    if (shadowConfidence > actualConfidence) intervention = 'CONFIDENCE_BOOST';
    // Add supporting reasons based on diagnostics
    try{
      if (diag && diag.marketRegime && diag.marketRegime.primaryRegime === 'BULL_TREND' && input.actualAction === 'BUY') pushSupporting('Bulltrenden stödjer det aktuella köpläget.');
      if (diag && diag.marketRegime && diag.marketRegime.primaryRegime === 'BEAR_TREND' && input.actualAction === 'SELL') pushSupporting('Beartrenden stödjer det aktuella säljläget.');
      if (diag && diag.historicalContext && diag.historicalContext.longTrend && ((input.actualAction === 'BUY' && diag.historicalContext.longTrend === 'UP') || (input.actualAction === 'SELL' && diag.historicalContext.longTrend === 'DOWN'))) pushSupporting('Den historiska trenden ligger i linje med beslutet.');
      if (diag && diag.marketRegime && diag.marketRegime.riskRegime && ((input.actualAction === 'BUY' && diag.marketRegime.riskRegime !== 'RISK_OFF') || (input.actualAction === 'SELL' && diag.marketRegime.riskRegime !== 'RISK_ON'))) pushSupporting('Riskläget stödjer beslutet.');
      if (supportingReasons.length === 0) pushSupporting('Marknadskontexten stödjer det aktuella beslutet.');
    }catch(_){ }
  } else if (alignment === 'CONFLICTING'){
    // Count independent conflict categories
    let categories = 0;
    try{
      const mr = diag && diag.marketRegime ? diag.marketRegime : null;
      const hc = diag && diag.historicalContext ? diag.historicalContext : null;
      // Regime conflict
      if (input.actualAction === 'BUY' && mr && mr.primaryRegime === 'BEAR_TREND'){ categories++; pushConflicting('Beartrenden står i konflikt med köpläget.'); }
      if (input.actualAction === 'SELL' && mr && mr.primaryRegime === 'BULL_TREND'){ categories++; pushConflicting('Bulltrenden står i konflikt med säljläget.'); }
      // Risk conflict
      if (input.actualAction === 'BUY' && mr && mr.riskRegime === 'RISK_OFF'){ categories++; pushConflicting('Riskläget är risk-off.'); }
      if (input.actualAction === 'SELL' && mr && mr.riskRegime === 'RISK_ON'){ categories++; pushConflicting('Riskläget är risk-on.'); }
      // Long trend
      if (input.actualAction === 'BUY' && hc && hc.longTrend === 'DOWN'){ categories++; pushConflicting('Den långa trenden pekar nedåt.'); }
      if (input.actualAction === 'SELL' && hc && hc.longTrend === 'UP'){ categories++; pushConflicting('Den långa trenden pekar uppåt.'); }
      // Momentum
      if (input.actualAction === 'BUY' && hc && hc.momentumPersistence === 'REVERSING'){ categories++; pushConflicting('Momentum visar tecken på omslag.'); }
      // Volatility
      if (input.actualAction === 'BUY' && hc && (hc.volatilityState === 'HIGH' || hc.volatilityState === 'EXPANDING')){ categories++; pushConflicting('Volatiliteten expanderar.'); }
      // Explicit alignment already implied
      if (diag && diag.contextAlignment === 'CONFLICTING'){ categories++; }
      // generic fallback
      if (categories === 0) { categories = 1; pushConflicting('Marknadskontexten motsäger det aktuella beslutet.'); }
    }catch(_){ categories = 1; pushConflicting('Marknadskontexten motsäger det aktuella beslutet.'); }

    // Determine reduction
    let reduction = 10;
    if (categories === 1) reduction = 10;
    else if (categories === 2) reduction = 15;
    else if (categories >= 3) reduction = 20;
    shadowConfidence = clampConfidence(shadowConfidence - reduction);
    intervention = 'CONFIDENCE_REDUCTION';

    // Check action->HOLD rule
    const meetsActionToHold = (input.actualAction === 'BUY' || input.actualAction === 'SELL') && diag && diag.contextAlignment === 'CONFLICTING' && categories >= 2 && shadowConfidence < 60;
    if (meetsActionToHold){ shadowAction = 'HOLD'; intervention = 'ACTION_TO_HOLD'; }
  }

  // HOLD remains HOLD
  if (input.actualAction === 'HOLD'){
    shadowAction = 'HOLD';
    shadowConfidence = actualConfidence;
    intervention = 'NONE';
  }

  // Ensure we never flip BUY<->SELL directly
  if ((input.actualAction === 'BUY' && shadowAction === 'SELL') || (input.actualAction === 'SELL' && shadowAction === 'BUY')){
    shadowAction = input.actualAction; // force keep
  }

  // Defensive dedupe + limits
  const finalSupporting = stableSliceStrings(supportingReasons, 5);
  const finalConflicting = stableSliceStrings(conflictingReasons, 5);
  const finalWarnings = stableSliceStrings(warnings, 5);

  const roundedShadow = clampConfidence(roundConfidence(shadowConfidence));
  const roundedActual = clampConfidence(roundConfidence(actualConfidence));

  const out: ContextAwareShadowDecision = {
    schemaVersion: 1,
    source: 'VICTOR_CONTEXT_AWARE_SHADOW',
    symbol,
    observedAt: diag && diag.historicalContext && (diag.historicalContext as any).observedAt ? (diag.historicalContext as any).observedAt : null,
    generatedAt,
    actualAction: input.actualAction,
    actualConfidence: roundedActual,
    shadowAction,
    shadowConfidence: roundedShadow,
    actionChanged: shadowAction !== input.actualAction,
    confidenceDelta: roundConfidence(roundedShadow - roundedActual),
    contextAlignment: alignment as any,
    intervention,
    supportingReasons: finalSupporting,
    conflictingReasons: finalConflicting,
    warnings: finalWarnings
  };
  return out;
}

export default { buildContextAwareShadowDecision };

// Sanitize for runtime state (defensive copy)
export function sanitizeContextAwareShadowDecisionForState(value: any): ContextAwareShadowDecision | null {
  try{
    if (!value || typeof value !== 'object') return null;
    const v = value as any;
    const allowedAction = (a: any) => (a === 'BUY' || a === 'SELL' || a === 'HOLD') ? a : 'HOLD';
    const allowedIntervention = (i: any) => (i === 'NONE' || i === 'CONFIDENCE_BOOST' || i === 'CONFIDENCE_REDUCTION' || i === 'ACTION_TO_HOLD') ? i : 'NONE';
    const out: ContextAwareShadowDecision = {
      schemaVersion: 1,
      source: 'VICTOR_CONTEXT_AWARE_SHADOW',
      symbol: String(v.symbol || '').toUpperCase(),
      observedAt: v.observedAt || null,
      generatedAt: v.generatedAt || new Date().toISOString(),
      actualAction: allowedAction(v.actualAction),
      actualConfidence: Number.isFinite(Number(v.actualConfidence)) ? Math.max(0, Math.min(100, Math.round(Number(v.actualConfidence)))) : 0,
      shadowAction: allowedAction(v.shadowAction),
      shadowConfidence: Number.isFinite(Number(v.shadowConfidence)) ? Math.max(0, Math.min(100, Math.round(Number(v.shadowConfidence)))) : 0,
      actionChanged: !!v.actionChanged,
      confidenceDelta: Number.isFinite(Number(v.confidenceDelta)) ? Math.round(Number(v.confidenceDelta)) : Math.round((Number(v.shadowConfidence)||0) - (Number(v.actualConfidence)||0)),
      contextAlignment: (v.contextAlignment === 'SUPPORTIVE' || v.contextAlignment === 'CONFLICTING' || v.contextAlignment === 'NEUTRAL') ? v.contextAlignment : 'INSUFFICIENT',
      intervention: allowedIntervention(v.intervention),
      supportingReasons: Array.isArray(v.supportingReasons) ? v.supportingReasons.map((x:any)=> String(x)).filter(Boolean).slice(0,5) : [],
      conflictingReasons: Array.isArray(v.conflictingReasons) ? v.conflictingReasons.map((x:any)=> String(x)).filter(Boolean).slice(0,5) : [],
      warnings: Array.isArray(v.warnings) ? v.warnings.map((x:any)=> String(x)).filter(Boolean).slice(0,5) : []
    };
    return out;
  }catch(_){ return null; }
}

export function createPerCycleContextAwareShadowResolver(opts?: {
  getHistoricalSnapshot?: (symbol: string) => Promise<any> | null | undefined,
  getMarketRegimeSnapshot?: (symbol: string) => Promise<any> | null | undefined,
  buildDiagnostics?: (opts: { action: 'BUY'|'SELL'|'HOLD'|'UNKNOWN'; confidence?: number | null; historicalContext?: any; marketRegime?: any }) => any
}){
  const map = new Map<string, Promise<ContextAwareShadowDecision | null>>();
  function normalize(sym: string){ return String(sym||'').trim().toUpperCase(); }

  return {
    async resolve(opts2: { symbol: string; actualAction: ShadowDecisionAction; actualConfidence: number }){
      const sym = normalize(opts2.symbol);
      if (!sym) return null;
      const key = `${sym}|${String(opts2.actualAction||'').toUpperCase()}|${Math.round(Number(opts2.actualConfidence)||0)}`;
      if (map.has(key)) return map.get(key) as Promise<ContextAwareShadowDecision | null>;
      const p = (async ()=>{
        try{
          // Acquire per-cycle snapshots via injected getters (do not fallback to runtime.latest*)
          let hist: any = null; let mr: any = null;
          try{ if (typeof opts?.getHistoricalSnapshot === 'function') hist = await opts!.getHistoricalSnapshot!(sym); }catch(_){ hist = null; }
          try{ if (typeof opts?.getMarketRegimeSnapshot === 'function') mr = await opts!.getMarketRegimeSnapshot!(sym); }catch(_){ mr = null; }
          let diag: any = null;
          try{ if (typeof opts?.buildDiagnostics === 'function') diag = opts!.buildDiagnostics!({ action: opts2.actualAction || 'UNKNOWN', confidence: Number.isFinite(Number(opts2.actualConfidence)) ? Number(opts2.actualConfidence) : null, historicalContext: hist || null, marketRegime: mr || null }); }catch(_){ diag = null; }
          const res = buildContextAwareShadowDecision({ symbol: sym, actualAction: opts2.actualAction, actualConfidence: opts2.actualConfidence, marketContextDiagnostics: diag, now: new Date() });
          return res;
        }catch(_){ return null; }
      })();
      map.set(key, p);
      return p;
    },
    // expose for tests
    _map: map
  };
}
