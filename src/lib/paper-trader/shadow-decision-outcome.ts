import evaluateShadowDecisionOutcome from './shadow-decision-outcome-evaluator';
import { createTradeReview, TradeReview } from './trade-review';

export type ShadowOutcomeVerdict =
  | 'SHADOW_IMPROVED'
  | 'SHADOW_WORSENED'
  | 'SAME_OUTCOME'
  | 'SHADOW_AVOIDED_LOSS'
  | 'SHADOW_MISSED_GAIN'
  | 'NOT_COMPARABLE'
  | 'INSUFFICIENT_DATA';

export type ShadowDecisionOutcome = {
  schemaVersion: 1;
  source: 'VICTOR_SHADOW_DECISION_OUTCOME';

  id: string;
  cycleId: string | null;
  symbol: string;

  decisionObservedAt: string | null;
  outcomeObservedAt: string | null;
  evaluatedAt: string;

  actualAction: 'BUY' | 'SELL' | 'HOLD';
  shadowAction: 'BUY' | 'SELL' | 'HOLD';

  actualConfidence: number | null;
  shadowConfidence: number | null;

  actualReturnPercent: number | null;
  shadowReturnPercent: number | null;

  actualPnLSek: number | null;
  shadowPnLSek: number | null;

  outcomeDifferenceSek: number | null;
  outcomeDifferencePercent: number | null;

  verdict: ShadowOutcomeVerdict;

  actualWasBetter: boolean | null;
  shadowWasBetter: boolean | null;

  reasoning: readonly string[];
  warnings: readonly string[];
};

const EPSILON_SEK = 0.01;
const EPSILON_PERCENT = 0.001;

function finiteOrNull(n: number | undefined | null): number | null{
  return (typeof n === 'number' && Number.isFinite(n)) ? n : null;
}

function normalizeAction(a: string | null | undefined): 'BUY'|'SELL'|'HOLD' {
  try{ const s = String(a||'').toUpperCase(); if (s === 'BUY' || s === 'SELL' || s === 'HOLD') return s as any; }catch(_){ }
  return 'HOLD';
}

function makeId(cycleId: string | null, symbol: string): string{
  const t = new Date().toISOString(); return `${symbol}:${cycleId||'none'}:${t}`;
}

export function buildShadowDecisionOutcome(params: {
  id?: string;
  cycleId?: string | null;
  symbol: string;
  decisionObservedAt?: string | null;
  outcomeObservedAt?: string | null;
  actualAction: 'BUY'|'SELL'|'HOLD';
  shadowAction: 'BUY'|'SELL'|'HOLD';
  actualConfidence?: number | null;
  shadowConfidence?: number | null;
  tradeReview?: TradeReview | null; // preferred source for actual outcome
  referencePrice?: number | null; // fallback
  outcomePrice?: number | null; // fallback
}): ShadowDecisionOutcome{
  const symbol = String(params.symbol || '').toUpperCase();
  const cycleId = params.cycleId || null;
  const decisionObservedAt = params.decisionObservedAt || null;
  const outcomeObservedAt = params.outcomeObservedAt || null;
  const evaluatedAt = new Date().toISOString();

  const actualAction = normalizeAction(params.actualAction) as 'BUY'|'SELL'|'HOLD';
  const shadowAction = normalizeAction(params.shadowAction) as 'BUY'|'SELL'|'HOLD';

  const actualConfidence = finiteOrNull(typeof params.actualConfidence === 'number' ? params.actualConfidence : null);
  const shadowConfidence = finiteOrNull(typeof params.shadowConfidence === 'number' ? params.shadowConfidence : null);

  // Prefer tradeReview when available
  let referencePrice: number | null = null;
  let outcomePrice: number | null = null;
  let quantity: number | null = null;
  let actualPnL: number | null = null;
  let actualReturn: number | null = null;

  if (params.tradeReview){
    try{
      referencePrice = finiteOrNull(params.tradeReview.entryPrice);
      outcomePrice = finiteOrNull(params.tradeReview.exitPrice);
      quantity = finiteOrNull(params.tradeReview.quantity as unknown as number) ?? null;
      actualPnL = finiteOrNull(params.tradeReview.pnlSek);
      actualReturn = finiteOrNull(params.tradeReview.pnlPercent);
    }catch(_){ }
  }

  if (referencePrice === null) referencePrice = finiteOrNull(params.referencePrice ?? null);
  if (outcomePrice === null) outcomePrice = finiteOrNull(params.outcomePrice ?? null);

  // compute shadow/result
  let shadowPnL: number | null = null;
  let shadowReturn: number | null = null;

  const havePriceData = (referencePrice !== null && outcomePrice !== null && referencePrice > 0 && outcomePrice > 0);

  if (!havePriceData){
    // insufficient numeric data -> INSUFFICIENT
    const out: ShadowDecisionOutcome = Object.freeze({
      schemaVersion: 1,
      source: 'VICTOR_SHADOW_DECISION_OUTCOME',
      id: params.id || makeId(cycleId, symbol),
      cycleId,
      symbol,
      decisionObservedAt,
      outcomeObservedAt,
      evaluatedAt,
      actualAction,
      shadowAction,
      actualConfidence,
      shadowConfidence,
      actualReturnPercent: finiteOrNull(actualReturn ?? null),
      shadowReturnPercent: null,
      actualPnLSek: finiteOrNull(actualPnL ?? null),
      shadowPnLSek: null,
      outcomeDifferenceSek: null,
      outcomeDifferencePercent: null,
      verdict: 'INSUFFICIENT_DATA',
      actualWasBetter: null,
      shadowWasBetter: null,
      reasoning: Object.freeze(['Tillräcklig outcome-data saknas.']),
      warnings: Object.freeze([]),
    });
    return out;
  }

  // compute returns
  const ref = referencePrice as number;
  const outP = outcomePrice as number;

  // actual values if missing
  if (actualPnL === null || actualReturn === null){
    // attempt to compute actual from prices and quantity
    if (typeof quantity === 'number' && Number.isFinite(quantity)){
      if (actualAction === 'BUY'){
        actualPnL = Number(((outP - ref) * quantity).toFixed(2));
      }else if (actualAction === 'SELL'){
        actualPnL = Number(((ref - outP) * quantity).toFixed(2));
      }else{ // HOLD
        actualPnL = 0;
      }
      actualReturn = Number((((outP - ref) / ref) * 100).toFixed(6));
    }
  }

  // simulate shadow
  if (shadowAction === actualAction){
    shadowPnL = actualPnL;
    shadowReturn = actualReturn;
  }else if (shadowAction === 'HOLD'){
    shadowPnL = 0;
    shadowReturn = 0;
  }else{
    // simulate using same ref and outcomePrice
    if (shadowAction === 'BUY'){
      // buy at ref, exit at outcome
      if (typeof quantity === 'number' && Number.isFinite(quantity)) shadowPnL = Number(((outP - ref) * quantity).toFixed(2));
      else shadowPnL = Number(((outP - ref) * 1).toFixed(2));
      shadowReturn = Number((((outP - ref) / ref) * 100).toFixed(6));
    }else if (shadowAction === 'SELL'){
      if (typeof quantity === 'number' && Number.isFinite(quantity)) shadowPnL = Number(((ref - outP) * quantity).toFixed(2));
      else shadowPnL = Number(((ref - outP) * 1).toFixed(2));
      shadowReturn = Number((((ref - outP) / ref) * 100).toFixed(6));
    }
  }

  // normalize numbers
  actualPnL = finiteOrNull(actualPnL ?? null);
  actualReturn = finiteOrNull(actualReturn ?? null);
  shadowPnL = finiteOrNull(shadowPnL ?? null);
  shadowReturn = finiteOrNull(shadowReturn ?? null);

  const diffSek = (shadowPnL !== null && actualPnL !== null) ? Number((shadowPnL - actualPnL).toFixed(2)) : null;
  const diffPct = (shadowReturn !== null && actualReturn !== null) ? Number((shadowReturn - actualReturn).toFixed(6)) : null;

  // verdict logic
  let verdict: ShadowOutcomeVerdict = 'NOT_COMPARABLE';
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (actualAction === shadowAction){
    verdict = 'SAME_OUTCOME';
    reasons.push('Det verkliga beslutet och Shadow-beslutet hade gett samma utfall.');
  }else if (actualPnL === null || shadowPnL === null){
    verdict = 'INSUFFICIENT_DATA';
    reasons.push('Tillräcklig outcome-data saknas.');
  }else{
    // avoided loss
    if ((actualPnL as number) < 0 && (shadowPnL as number) === 0){
      verdict = 'SHADOW_AVOIDED_LOSS';
      reasons.push('Shadow-beslutet hade undvikit den realiserade förlusten.');
    }
    // missed gain
    else if ((actualPnL as number) > 0 && (shadowPnL as number) === 0){
      verdict = 'SHADOW_MISSED_GAIN';
      reasons.push('Shadow-beslutet hade missat en lönsam affär.');
    }
    // improved/worsened
    else if (diffSek !== null && Math.abs(diffSek) <= EPSILON_SEK){
      verdict = 'SAME_OUTCOME';
      reasons.push('Det verkliga beslutet och Shadow-beslutet hade gett samma utfall.');
    }
    else if (diffSek !== null && diffSek > EPSILON_SEK){
      verdict = 'SHADOW_IMPROVED';
      reasons.push(`Shadow-beslutet hade förbättrat utfallet med ${diffSek.toFixed(2)} kr.`);
    }
    else if (diffSek !== null && diffSek < -EPSILON_SEK){
      verdict = 'SHADOW_WORSENED';
      reasons.push(`Shadow-beslutet hade försämrat utfallet med ${Math.abs(diffSek).toFixed(2)} kr.`);
    }
    else {
      verdict = 'NOT_COMPARABLE';
      reasons.push('Utfallet kan inte jämföras med tillräcklig säkerhet.');
    }
  }

  // flags
  const actualWasBetter = (verdict === 'SHADOW_WORSENED' || verdict === 'SAME_OUTCOME' && diffSek !== null && diffSek < 0) ? true : (verdict === 'SHADOW_IMPROVED' || verdict === 'SHADOW_AVOIDED_LOSS' ? false : null);
  const shadowWasBetter = (verdict === 'SHADOW_IMPROVED' || verdict === 'SHADOW_AVOIDED_LOSS') ? true : (verdict === 'SHADOW_WORSENED' || verdict === 'SAME_OUTCOME' && diffSek !== null && diffSek > 0 ? false : null);

  // dedupe reasoning/warnings and limit
  const dedup = Array.from(new Set(reasons)).slice(0,5);
  const dedupWarnings = Array.from(new Set(warnings)).slice(0,5);

  const out: ShadowDecisionOutcome = Object.freeze({
    schemaVersion: 1,
    source: 'VICTOR_SHADOW_DECISION_OUTCOME',
    id: params.id || makeId(cycleId, symbol),
    cycleId,
    symbol,
    decisionObservedAt,
    outcomeObservedAt,
    evaluatedAt,
    actualAction,
    shadowAction,
    actualConfidence,
    shadowConfidence,
    actualReturnPercent: finiteOrNull(actualReturn ?? null),
    shadowReturnPercent: finiteOrNull(shadowReturn ?? null),
    actualPnLSek: finiteOrNull(actualPnL ?? null),
    shadowPnLSek: finiteOrNull(shadowPnL ?? null),
    outcomeDifferenceSek: diffSek,
    outcomeDifferencePercent: diffPct,
    verdict,
    actualWasBetter: actualWasBetter === null ? null : Boolean(actualWasBetter),
    shadowWasBetter: shadowWasBetter === null ? null : Boolean(shadowWasBetter),
    reasoning: Object.freeze(dedup),
    warnings: Object.freeze(dedupWarnings),
  });

  return out;
}

// Aggregator
export type ShadowDecisionOutcomeSummary = {
  schemaVersion: 1;
  evaluatedCount: number;
  comparableCount: number;
  insufficientCount: number;
  improvedCount: number;
  worsenedCount: number;
  sameCount: number;
  avoidedLossCount: number;
  missedGainCount: number;
  netShadowDifferenceSek: number | null;
  averageShadowDifferenceSek: number | null;
  improvementRatePercent: number | null;
  warnings: readonly string[];
};

export function buildShadowDecisionOutcomeSummary(outcomes: readonly ShadowDecisionOutcome[] | undefined): ShadowDecisionOutcomeSummary{
  const list = Array.isArray(outcomes) ? outcomes : [];
  let evaluatedCount = 0;
  let comparableCount = 0;
  let insufficientCount = 0;
  let improvedCount = 0;
  let worsenedCount = 0;
  let sameCount = 0;
  let avoidedLossCount = 0;
  let missedGainCount = 0;
  let netDiff = 0;

  for (const o of list){
    if (!o || typeof o !== 'object') continue;
    evaluatedCount++;
    if (o.verdict === 'INSUFFICIENT_DATA'){ insufficientCount++; continue; }
    comparableCount++;
    if (o.verdict === 'SHADOW_IMPROVED') improvedCount++;
    else if (o.verdict === 'SHADOW_WORSENED') worsenedCount++;
    else if (o.verdict === 'SAME_OUTCOME') sameCount++;
    else if (o.verdict === 'SHADOW_AVOIDED_LOSS') avoidedLossCount++;
    else if (o.verdict === 'SHADOW_MISSED_GAIN') missedGainCount++;
    if (typeof o.outcomeDifferenceSek === 'number' && Number.isFinite(o.outcomeDifferenceSek)) netDiff += o.outcomeDifferenceSek;
  }

  const average = comparableCount === 0 ? null : Number((netDiff / comparableCount).toFixed(2));
  const improvementRate = comparableCount === 0 ? null : Math.round((improvedCount / comparableCount) * 100);

  const allWarnings = Array.from(new Set((list.flatMap(l => (l && l.warnings) ? Array.from(l.warnings) : []) as string[]))).slice(0,5);

  return Object.freeze({
    schemaVersion: 1,
    evaluatedCount,
    comparableCount,
    insufficientCount,
    improvedCount,
    worsenedCount,
    sameCount,
    avoidedLossCount,
    missedGainCount,
    netShadowDifferenceSek: Number.isFinite(netDiff) ? Number(netDiff.toFixed(2)) : null,
    averageShadowDifferenceSek: average,
    improvementRatePercent: improvementRate,
    warnings: Object.freeze(allWarnings),
  });
}

export default { buildShadowDecisionOutcome, buildShadowDecisionOutcomeSummary };
