import { AuditEntry, AuditStore, AuditStoreEnvelope, AuditStoreItem } from './types';
import { appendVictorAudit, listVictorAuditPage } from './supabase-victor-audit-store';
import type { AppendVictorAuditInput } from './supabase-victor-audit-store';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidAuditPayload(payload: unknown): payload is AuditEntry {
  if (!isPlainObject(payload)) return false;
  const p = payload as Record<string, unknown>;
  if (typeof p['id'] !== 'string') return false;
  if (typeof p['timestamp'] !== 'string') return false;
  const kindField = p['kind'];
  if (typeof kindField !== 'string') return false;
  return true;
}

function buildSummary(raw: AuditEntry) {
  return {
    cycleId: raw.id,
    decisionId: raw.decision?.id ?? null,
    symbol: raw.decision?.symbol ?? null,
    action: raw.decision?.action ?? null,
    confidence: raw.decision?.confidence ?? null,
    referencePrice: raw.decision?.referencePrice ?? null,
    quoteTimestamp: ((): string | null => {
      const d = raw.decision as unknown as Record<string, unknown> | undefined;
      return d && typeof d['quoteTimestamp'] === 'string' ? (d['quoteTimestamp'] as string) : null;
    })(),
    executionStatus: ((): string | null => {
      const execRec = raw.execution as unknown as Record<string, unknown> | undefined;
      if (execRec && typeof execRec['status'] === 'string') return execRec['status'] as string;
      return raw.execution ? 'EXECUTED' : null;
    })(),
    executedPrice: raw.execution?.executedPrice ?? null,
    quantity: raw.execution?.quantity ?? null,
    notional: raw.execution?.notional ?? null,
    fee: raw.execution?.fee ?? null,
    cashBefore: raw.portfolioBefore?.availableCash ?? null,
    cashAfter: raw.portfolioAfter?.availableCash ?? null,
    holdingBefore: raw.portfolioBefore?.holdings ?? null,
    holdingAfter: raw.portfolioAfter?.holdings ?? null,
    createdAt: raw.timestamp,
  };
}

export class SupabaseAuditAdapter implements AuditStore {
  async append(entry: AuditEntry): Promise<void> {
    const payload = entry as unknown as Record<string, unknown>;

    // Ensure we always have a non-empty id for Supabase insertion. Tests and
    // the in-memory FileAuditStore may generate ids implicitly, but the
    // Supabase REST API layer requires an explicit id string. Generate a
    // stable-ish id when missing.
    const ensuredId = (typeof entry.id === 'string' && entry.id.trim() !== '') ? String(entry.id) : `audit_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
    const idempotency = (typeof entry.id === 'string' && entry.id.trim() !== '') ? String(entry.id) : null;

    const input: AppendVictorAuditInput = {
      id: ensuredId,
      portfolioId: entry.portfolioAfter?.id ?? entry.portfolioBefore?.id ?? null,
      source: 'atlas_runtime',
      kind: entry.kind,
      executionId: entry.execution?.id ?? null,
      occurredAt: entry.timestamp,
      payload,
      idempotencyKey: idempotency,
    };

    const res = await appendVictorAudit(input);
    if (res.status === 'INSERTED' || res.status === 'DUPLICATE') return;
    throw new Error('append failed');
  }

  async list(): Promise<AuditStoreItem[]> {
    const records = await listVictorAuditPage({ limit: 1000, offset: 0 });
    const out: AuditStoreEnvelope[] = [];
    for (const r of records) {
      // Only filter out records with invalid payload shapes. Network/HTTP errors
      // from listVictorAuditPage should still propagate up.
      if (!isPlainObject(r.payload)) continue;
      const p = r.payload as Record<string, unknown>;
      if (!isValidAuditPayload(p)) continue;

      const rawBase = p as Partial<AuditEntry>;
      const raw: AuditEntry = {
        id: r.id,
        timestamp: r.occurredAt,
        kind: (r.kind ?? (p['kind'] as string)) as AuditEntry['kind'],
        decision: rawBase.decision ?? undefined,
        reason: rawBase.reason ?? undefined,
        execution: rawBase.execution ?? undefined,
        portfolioBefore: rawBase.portfolioBefore ?? undefined,
        portfolioAfter: rawBase.portfolioAfter ?? undefined,
        evaluation: rawBase.evaluation ?? undefined,
      };

      // final validation (should pass given isValidAuditPayload)
      if (typeof raw.id !== 'string' || typeof raw.timestamp !== 'string' || typeof raw.kind !== 'string') continue;

      const envelope: AuditStoreEnvelope = {
        id: r.id,
        timestamp: r.occurredAt,
        summary: buildSummary(raw),
        raw,
      };
      out.push(envelope);
    }
    return out;
  }
}

export default SupabaseAuditAdapter;
