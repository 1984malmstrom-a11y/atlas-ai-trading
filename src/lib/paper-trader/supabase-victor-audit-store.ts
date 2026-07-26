// Supabase REST-backed Victor audit store

export type VictorAuditRecord = {
  id: string;
  portfolioId: string | null;
  source: string;
  kind: string | null;
  executionId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  createdAt: string;
};

export type AppendVictorAuditInput = Omit<VictorAuditRecord, 'createdAt'>;

export type AppendVictorAuditResult =
  | { status: 'INSERTED'; record: VictorAuditRecord }
  | { status: 'DUPLICATE'; record: null };

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function isPlainObject(v: any): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateNonEmptyTrimmed(v: any, name: string) {
  if (typeof v !== 'string') throw new Error(`${name} must be a string`);
  if (v.trim() === '') throw new Error(`${name} must not be empty`);
}

export async function appendVictorAudit(input: AppendVictorAuditInput): Promise<AppendVictorAuditResult> {
  if (!input || typeof input !== 'object') throw new Error('invalid input');

  const SUPABASE_URL = requiredEnv('SUPABASE_URL');
  const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');

  const { id, portfolioId, source, kind, executionId, occurredAt, payload, idempotencyKey } = input as any;

  validateNonEmptyTrimmed(id, 'id');
  validateNonEmptyTrimmed(source, 'source');

  if (portfolioId !== null && portfolioId !== undefined) {
    if (typeof portfolioId !== 'string') throw new Error('portfolioId must be string or null');
    if (portfolioId.trim() === '') throw new Error('portfolioId must not be empty string');
  }
  if (kind !== null && kind !== undefined) {
    if (typeof kind !== 'string') throw new Error('kind must be string or null');
    if (kind.trim() === '') throw new Error('kind must not be empty string');
  }
  if (executionId !== null && executionId !== undefined) {
    if (typeof executionId !== 'string') throw new Error('executionId must be string or null');
    if (executionId.trim() === '') throw new Error('executionId must not be empty string');
  }
  if (idempotencyKey !== null && idempotencyKey !== undefined) {
    if (typeof idempotencyKey !== 'string') throw new Error('idempotencyKey must be string or null');
    if (idempotencyKey.trim() === '') throw new Error('idempotencyKey must not be empty string');
  }

  // occurredAt must be valid date
  const d = new Date(occurredAt);
  if (isNaN(d.getTime())) throw new Error('occurredAt must be valid date');

  if (!isPlainObject(payload)) throw new Error('payload must be a non-null JSON object');

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/victor_audit`;
  const body = {
    id,
    portfolio_id: portfolioId === undefined ? null : portfolioId,
    source,
    kind: kind === undefined ? null : kind,
    execution_id: executionId === undefined ? null : executionId,
    occurred_at: occurredAt,
    payload,
    idempotency_key: idempotencyKey === undefined ? null : idempotencyKey,
  } as any;

  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  } as any;

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e: any) {
    throw new Error(String(e && e.message ? e.message : e));
  }

  if (res.status === 409) return { status: 'DUPLICATE', record: null };
  if (!res.ok) throw new Error(`http error ${res.status}`);

  let data: any;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('invalid json');
  }

  if (!Array.isArray(data) || data.length !== 1) throw new Error('unexpected row count');
  const row = data[0];

  // map snake_case to VictorAuditRecord
  const rec: VictorAuditRecord = {
    id: String(row.id),
    portfolioId: row.portfolio_id === null ? null : String(row.portfolio_id),
    source: String(row.source),
    kind: row.kind === null ? null : String(row.kind),
    executionId: row.execution_id === null ? null : String(row.execution_id),
    occurredAt: String(row.occurred_at),
    payload: isPlainObject(row.payload) ? (row.payload as Record<string, unknown>) : {},
    idempotencyKey: row.idempotency_key === null ? null : String(row.idempotency_key),
    createdAt: String(row.created_at),
  };

  return { status: 'INSERTED', record: rec };
}

export async function listVictorAuditPage(input?: { portfolioId?: string; limit?: number; offset?: number; }): Promise<VictorAuditRecord[]> {
  const SUPABASE_URL = requiredEnv('SUPABASE_URL');
  const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');

  const limit = input && typeof input.limit === 'number' ? input.limit : 100;
  const offset = input && typeof input.offset === 'number' ? input.offset : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be integer 1..1000');
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be integer >= 0');

  const params: string[] = [];
  const select = 'select=id,portfolio_id,source,kind,execution_id,occurred_at,payload,idempotency_key,created_at';
  params.push(select);
  params.push('order=occurred_at.desc,created_at.desc');
  params.push(`limit=${limit}`);
  params.push(`offset=${offset}`);

  if (input && typeof input.portfolioId === 'string'){
    const t = input.portfolioId.trim();
    if (t === '') throw new Error('portfolioId must not be empty when provided');
    params.push(`portfolio_id=eq.${encodeURIComponent(t)}`);
  }

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/victor_audit?${params.join('&')}`;
  const headers = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, Accept: 'application/json' } as any;

  let res: Response;
  try { res = await fetch(url, { method: 'GET', headers }); } catch (e:any){ throw new Error(String(e && e.message ? e.message : e)); }
  if (!res.ok) throw new Error(`http error ${res.status}`);
  let data: any;
  try { data = await res.json(); } catch (e){ throw new Error('invalid json'); }
  if (!Array.isArray(data)) throw new Error('unexpected rows');

  const out: VictorAuditRecord[] = data.map((r:any) => {
    if (!r || typeof r.id !== 'string') throw new Error('invalid row id');
    if (!r.source || typeof r.source !== 'string') throw new Error('invalid row source');
    const occurred = String(r.occurred_at);
    if (isNaN(new Date(occurred).getTime())) throw new Error('invalid occurred_at');
    if (!isPlainObject(r.payload)) throw new Error('invalid payload');
    return {
      id: String(r.id),
      portfolioId: r.portfolio_id === null ? null : String(r.portfolio_id),
      source: String(r.source),
      kind: r.kind === null ? null : String(r.kind),
      executionId: r.execution_id === null ? null : String(r.execution_id),
      occurredAt: occurred,
      payload: r.payload as Record<string, unknown>,
      idempotencyKey: r.idempotency_key === null ? null : String(r.idempotency_key),
      createdAt: String(r.created_at),
    };
  });

  return out;
}

export default { appendVictorAudit, listVictorAuditPage };
