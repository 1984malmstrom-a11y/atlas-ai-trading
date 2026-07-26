import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as store from './supabase-victor-audit-store';

const REAL_FETCH = global.fetch;
const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...OLD_ENV };
});
afterEach(() => {
  global.fetch = REAL_FETCH;
  process.env = { ...OLD_ENV };
});

describe('supabase-victor-audit-store', () => {
  it('throws when env missing and does not call fetch', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    const f = vi.fn(); global.fetch = f as any;
    await expect(store.appendVictorAudit as any) .rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it('append returns INSERTED on success and calls POST with snake_case body', async () => {
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SECRET_KEY = 'sk.test';
    const fakeRow = { id: 'a1', portfolio_id: 'p', source: 'svc', kind: 'K', execution_id: 'e1', occurred_at: '2026-01-01T00:00:00Z', payload: { x: 1 }, idempotency_key: null, created_at: '2026-01-01T00:00:00Z' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => [fakeRow] });
    global.fetch = fetchMock as any;

    const input = { id: 'a1', portfolioId: 'p', source: 'svc', kind: 'K', executionId: 'e1', occurredAt: '2026-01-01T00:00:00Z', payload: { x: 1 }, idempotencyKey: null };
    const res = await store.appendVictorAudit(input as any);
    expect(res.status).toBe('INSERTED');
    expect(res.record && res.record.id).toBe('a1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://supabase.test/rest/v1/victor_audit');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body).toHaveProperty('id', 'a1');
    expect(body).toHaveProperty('portfolio_id', 'p');
    expect(body).toHaveProperty('occurred_at', '2026-01-01T00:00:00Z');
  });

  it('append returns DUPLICATE on 409', async () => {
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SECRET_KEY = 'sk.test';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    global.fetch = fetchMock as any;
    const input = { id: 'dup1', portfolioId: null, source: 'svc', kind: null, executionId: null, occurredAt: new Date().toISOString(), payload: { a: 1 }, idempotencyKey: 'k' };
    const res = await store.appendVictorAudit(input as any);
    expect(res.status).toBe('DUPLICATE');
    expect(res.record).toBeNull();
  });

  it('list queries with paging and portfolio filter', async () => {
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SECRET_KEY = 'sk.test';
    const row = { id: 'r1', portfolio_id: 'demo', source: 'svc', kind: 'K', execution_id: null, occurred_at: '2026-01-02T00:00:00Z', payload: { ok: true }, idempotency_key: null, created_at: '2026-01-02T00:00:00Z' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [row] });
    global.fetch = fetchMock as any;

    const res = await store.listVictorAuditPage({ portfolioId: ' demo ', limit: 10, offset: 0 });
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('r1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('select=id,portfolio_id,source,kind,execution_id,occurred_at,payload,idempotency_key,created_at');
    expect(String(url)).toContain('order=occurred_at.desc,created_at.desc');
    expect(String(url)).toContain('portfolio_id=eq.demo');
  });

  it('invalid occurredAt throws and does not call fetch', async () => {
    delete process.env.SUPABASE_URL; process.env.SUPABASE_URL = 'https://supabase.test'; process.env.SUPABASE_SECRET_KEY = 'sk';
    const f = vi.fn(); global.fetch = f as any;
    await expect(store.appendVictorAudit({ id: 'x', portfolioId: null, source: 's', kind: null, executionId: null, occurredAt: 'not-a-date', payload: { a: 1 }, idempotencyKey: null } as any)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
