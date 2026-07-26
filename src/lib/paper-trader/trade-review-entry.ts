import type { AuditStoreItem, AuditEntry } from './types';

export type TradeReviewEntry = {
  executionId: string;
  entryPrice: number;
  entryTimestamp: string;
  confidenceAtEntry: number | null;
};

function asAudit(entry: AuditStoreItem): AuditEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const obj: any = entry as any;
  return ('raw' in obj && obj.raw && typeof obj.raw === 'object') ? (obj.raw as AuditEntry) : (entry as AuditEntry);
}

function isFiniteNumber(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }

export function resolveSingleEntryForReview(args: {
  audits: AuditStoreItem[];
  portfolioId: string;
  symbol: string;
  soldQuantity: number;
}): TradeReviewEntry | null {
  if (!args || !Array.isArray(args.audits)) return null;
  const { audits, portfolioId, symbol, soldQuantity } = args;

  const candidates: AuditEntry[] = [];

  for (const it of audits){
    const a = asAudit(it);
    if (!a) continue;
    try{
      if (a.kind !== 'EXECUTION') continue;
      // portfolioId may be present on envelope only; skip if mismatch when provided on envelope
      // Use permissive check: if audit has no portfolioId info, accept (spec says filter by portfolioId if matches)
      const env = it as any;
      if (typeof env.portfolioId === 'string' && env.portfolioId !== portfolioId) continue;
      const exec = a.execution;
      if (!exec) continue;
      if (String(exec.side || '').toUpperCase() !== 'BUY') continue;
      if (String(exec.symbol || '') !== String(symbol)) continue;
      if (!isFiniteNumber(exec.quantity) || exec.quantity <= 0) continue;
      if (!isFiniteNumber(exec.executedPrice) || exec.executedPrice <= 0) continue;
      if (typeof a.timestamp !== 'string' || a.timestamp.trim() === '') continue;
      const t = new Date(a.timestamp);
      if (Number.isNaN(t.getTime())) continue;
      candidates.push(a);
    }catch(_){ continue; }
  }

  if (candidates.length !== 1) return null;

  const chosen = candidates[0];
  const exec = chosen.execution!;
  if (exec.quantity !== soldQuantity) return null;

  const confidence = chosen.decision && typeof chosen.decision.confidence === 'number' && Number.isFinite(chosen.decision.confidence) ? Number(chosen.decision.confidence) : null;

  return {
    executionId: String(exec.id),
    entryPrice: Number(exec.executedPrice),
    entryTimestamp: String(chosen.timestamp),
    confidenceAtEntry: confidence,
  };
}

export default { resolveSingleEntryForReview };
