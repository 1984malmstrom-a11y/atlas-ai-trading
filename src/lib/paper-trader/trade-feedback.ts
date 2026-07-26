export type TradeFeedbackVerdict =
  | "STRONG_WIN"
  | "WIN"
  | "BREAK_EVEN"
  | "LOSS"
  | "LARGE_LOSS";

export type TradeFeedback = {
  executionId: string;
  verdict: TradeFeedbackVerdict;
  pnlSek: number;
  pnlPercent: number;
  winner: boolean;
  summary: string;
  bySignal: SignalFeedbackSummary[];
};

export type SignalFeedbackSummary = {
  signalId: string;
  evaluatedCount: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlSek: number;
};

// Build a compact summary per signal from an array of audit-like entries.
// Uses existing fields found in audit entries in this order to discover signals:
//  - raw.decision.signals (array of strings)
//  - raw.meta.technicalAnalysis.technicalSignal (string)
//  - raw.meta.technicalSummary.signal (string)
// A trade with multiple signals will be counted under each signal. Empty/invalid
// signal values are ignored. Result is sorted by evaluatedCount desc, then
// signalId ascending.
import type { AuditStoreItem, AuditEntry, PaperTradeDecision, TradeEvaluation } from './types';
import type { TradeReview } from './trade-review';

export function summarizeFeedbackBySignal(audits: AuditStoreItem[] | undefined): SignalFeedbackSummary[] {
  // Only use the typed and persistent `decision.signals` field from audits.
  if (!Array.isArray(audits) || audits.length === 0) return [];

  type EvaluationMaybe = TradeEvaluation | { tradeReview?: TradeReview };

  const map = new Map<string, { count: number; wins: number; sumPnl: number }>();

  function asEntry(item: AuditStoreItem): AuditEntry | null {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if ('raw' in o && o.raw && typeof o.raw === 'object') return o.raw as AuditEntry;
    return item as AuditEntry;
  }

  for (const a of audits){
    const raw = asEntry(a);
    if (!raw) continue;

    const evaluation = raw.evaluation as EvaluationMaybe | undefined;
    if (!evaluation || typeof evaluation !== 'object') continue;

    // Extract pnl/winner from either a direct TradeEvaluation or nested tradeReview
    let pnlSek: number | null = null;
    let winner = false;
    if ('tradeReview' in evaluation && evaluation.tradeReview && typeof evaluation.tradeReview === 'object'){
      const tr = evaluation.tradeReview as TradeReview;
      pnlSek = typeof tr.pnlSek === 'number' ? tr.pnlSek : Number(tr.pnlSek);
      winner = Boolean(tr.winner);
    } else if (typeof (evaluation as TradeEvaluation).pnlSek === 'number'){
      const te = evaluation as TradeEvaluation;
      pnlSek = te.pnlSek;
      winner = Boolean(te.winner);
    } else {
      continue;
    }

    if (pnlSek === null) continue;

    const decision = raw.decision as PaperTradeDecision | undefined;
    if (!decision || !Array.isArray(decision.signals) || decision.signals.length === 0) continue;

    const seen = new Set<string>();
    for (const s of decision.signals){
      // signals are typed as `string[]` on `PaperTradeDecision`; guard anyway
      if (typeof s !== 'string') continue;
      const sig = s.trim();
      if (!sig) continue;
      if (seen.has(sig)) continue;
      seen.add(sig);
      const cur = map.get(sig) || { count: 0, wins: 0, sumPnl: 0 };
      cur.count += 1;
      cur.wins += winner ? 1 : 0;
      cur.sumPnl += Number.isFinite(Number(pnlSek)) ? Number(pnlSek) : 0;
      map.set(sig, cur);
    }
  }

  const out: SignalFeedbackSummary[] = Array.from(map.entries()).map(([signalId, v])=>({
    signalId,
    evaluatedCount: v.count,
    wins: v.wins,
    losses: v.count - v.wins,
    winRate: v.count > 0 ? v.wins / v.count : 0,
    avgPnlSek: v.count > 0 ? v.sumPnl / v.count : 0,
  }));

  out.sort((a,b)=> b.evaluatedCount - a.evaluatedCount || (a.signalId < b.signalId ? -1 : (a.signalId > b.signalId ? 1 : 0)));
  return out;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function createTradeFeedback(args: {
  executionId: string;
  pnlSek: number;
  pnlPercent: number;
  winner: boolean;
  audits?: unknown[];
}): TradeFeedback {
  if (!args || typeof args !== 'object') throw new Error('invalid args');
  const { executionId, pnlSek, pnlPercent, winner } = args;
  if (!executionId || String(executionId).trim().length === 0) throw new Error('executionId required');
  if (!isFiniteNumber(pnlSek)) throw new Error('pnlSek must be finite');
  if (!isFiniteNumber(pnlPercent)) throw new Error('pnlPercent must be finite');

  let verdict: TradeFeedbackVerdict;
  if (pnlPercent >= 10) verdict = 'STRONG_WIN';
  else if (pnlPercent > 0 && pnlPercent < 10) verdict = 'WIN';
  else if (pnlPercent === 0) verdict = 'BREAK_EVEN';
  else if (pnlPercent < 0 && pnlPercent > -10) verdict = 'LOSS';
  else verdict = 'LARGE_LOSS';

  const summaryMap: Record<TradeFeedbackVerdict, string> = {
    STRONG_WIN: 'Stark vinst',
    WIN: 'Vinst',
    BREAK_EVEN: 'Nollresultat',
    LOSS: 'Förlust',
    LARGE_LOSS: 'Stor förlust',
  };

  const feedback: TradeFeedback = {
    executionId: String(executionId),
    verdict,
    pnlSek,
    pnlPercent,
    winner,
    summary: summaryMap[verdict],
    bySignal: summarizeFeedbackBySignal(args && (args as any).audits ? (args as any).audits : undefined),
  };

  return Object.freeze(feedback);
}

export default createTradeFeedback;
