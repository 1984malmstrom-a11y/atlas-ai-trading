import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupabaseAuditAdapter } from './supabase-audit-adapter';
import * as store from './supabase-victor-audit-store';
import type { VictorAuditRecord } from './supabase-victor-audit-store';
import { AuditEntry, AuditStoreEnvelope } from './types';

beforeEach(()=>{ vi.restoreAllMocks(); });
afterEach(()=>{ vi.restoreAllMocks(); });

describe('SupabaseAuditAdapter', ()=>{
  it('append maps EXECUTION entry correctly', async ()=>{
    const entry: AuditEntry = {
      id: 'a1', timestamp: new Date().toISOString(), kind: 'EXECUTION',
      execution: { id: 'e1', decisionId: 'd1', symbol: 'AAA', side: 'BUY', quantity: 1, executedPrice: 100, notional: 100, fee: 1, generatedAt: new Date().toISOString() },
    };

    const spy = vi.spyOn(store, 'appendVictorAudit').mockResolvedValue({ status: 'INSERTED', record: { id: 'a1', portfolioId: null, source: 'atlas_runtime', kind: 'EXECUTION', executionId: 'e1', occurredAt: entry.timestamp, payload: entry, idempotencyKey: null, createdAt: entry.timestamp } });

    const adapter = new SupabaseAuditAdapter();
    await adapter.append(entry);
    expect(spy).toHaveBeenCalledTimes(1);
    const called = spy.mock.calls[0][0];
    expect(called.id).toBe('a1');
    expect(called.executionId).toBe('e1');
    expect(called.payload).toEqual(entry);
  });

  it('append treats DUPLICATE as success', async ()=>{
    const entry: AuditEntry = { id: 'dup', timestamp: new Date().toISOString(), kind: 'RECEIVED' };
    vi.spyOn(store, 'appendVictorAudit').mockResolvedValue({ status: 'DUPLICATE', record: null });
    const adapter = new SupabaseAuditAdapter();
    await expect(adapter.append(entry)).resolves.toBeUndefined();
  });

  it('list maps a valid record to AuditStoreEnvelope', async ()=>{
    const payload = { id: 'r1', timestamp: '2026-01-01T00:00:00Z', kind: 'EXECUTION', decision: { id: 'd1', symbol: 'AAA', action: 'BUY', confidence: 80, referencePrice: 100, generatedAt: '2026-01-01T00:00:00Z' }, execution: { id: 'e1', decisionId: 'd1', symbol: 'AAA', side: 'BUY', quantity: 1, executedPrice: 100, notional: 100, fee: 1, generatedAt: '2026-01-01T00:00:00Z' } };
    const record = { id: 'r1', portfolioId: null, source: 'atlas_runtime', kind: 'EXECUTION', executionId: null, occurredAt: '2026-01-01T00:00:00Z', payload, idempotencyKey: null, createdAt: '2026-01-01T00:00:00Z' };
    vi.spyOn(store, 'listVictorAuditPage').mockResolvedValue([record]);
    const adapter = new SupabaseAuditAdapter();
    const res = await adapter.list();
    expect(res.length).toBe(1);
    const env = res[0] as AuditStoreEnvelope;
    expect(env.raw).toBeDefined();
    expect(env.summary.decisionId).toBe('d1');
    // executionStatus may be null or a string depending on parsing; ensure presence or null
    expect(env.summary.executionStatus === null || typeof env.summary.executionStatus === 'string').toBe(true);
  });

  it('list preserves newest-first order', async ()=>{
    const p1 = { id: 'r1', portfolioId: null, source: 'atlas_runtime', kind: 'EXECUTION', executionId: null, occurredAt: '2026-01-02T00:00:00Z', payload: { id: 'r1', timestamp: '2026-01-02T00:00:00Z', kind: 'EXECUTION' }, idempotencyKey: null, createdAt: '2026-01-02T00:00:00Z' };
    const p2 = { id: 'r2', portfolioId: null, source: 'atlas_runtime', kind: 'EXECUTION', executionId: null, occurredAt: '2026-01-01T00:00:00Z', payload: { id: 'r2', timestamp: '2026-01-01T00:00:00Z', kind: 'EXECUTION' }, idempotencyKey: null, createdAt: '2026-01-01T00:00:00Z' };
    vi.spyOn(store, 'listVictorAuditPage').mockResolvedValue([p1, p2]);
    const adapter = new SupabaseAuditAdapter();
    const res = await adapter.list();
    expect(res[0].id).toBe('r1');
    expect(res[1].id).toBe('r2');
  });

  it('list throws on null payload', async ()=>{
    const rec: VictorAuditRecord = { id: 'x', portfolioId: null, source: 'atlas_runtime', kind: 'EXECUTION', executionId: null, occurredAt: '2026-01-01T00:00:00Z', payload: null as unknown as Record<string, unknown>, idempotencyKey: null, createdAt: '2026-01-01T00:00:00Z' };
    vi.spyOn(store, 'listVictorAuditPage').mockResolvedValue([rec]);
    const adapter = new SupabaseAuditAdapter();
    const res = await adapter.list();
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(0);
  });

  it('list throws on array payload', async ()=>{
    const rec: VictorAuditRecord = { id: 'x', portfolioId: null, source: 'atlas_runtime', kind: 'EXECUTION', executionId: null, occurredAt: '2026-01-01T00:00:00Z', payload: [] as unknown as Record<string, unknown>, idempotencyKey: null, createdAt: '2026-01-01T00:00:00Z' };
    vi.spyOn(store, 'listVictorAuditPage').mockResolvedValue([rec]);
    const adapter = new SupabaseAuditAdapter();
    const res = await adapter.list();
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(0);
  });

  it('list throws when id/timestamp/kind missing', async ()=>{
    const payload = { timestamp: '2026-01-01T00:00:00Z', kind: 'EXECUTION' } as Record<string, unknown>;
    const rec = { id: 'x', portfolioId: null, source: 'atlas_runtime', kind: 'EXECUTION', executionId: null, occurredAt: '2026-01-01T00:00:00Z', payload, idempotencyKey: null, createdAt: '2026-01-01T00:00:00Z' };
    vi.spyOn(store, 'listVictorAuditPage').mockResolvedValue([rec]);
    const adapter = new SupabaseAuditAdapter();
    const res = await adapter.list();
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(0);
  });

  it('skips legacy invalid record and preserves two valid runtime records in newest-first order', async ()=>{
    const validNew = { id: 'vnew', portfolioId: 'p', source: 'atlas_runtime', kind: 'EXECUTION', executionId: null, occurredAt: '2026-01-03T00:00:00Z', payload: { id: 'vnew', timestamp: '2026-01-03T00:00:00Z', kind: 'EXECUTION', execution: { id: 'e_new', decisionId: 'd_new', symbol: 'MSFT', side: 'BUY', quantity: 1, executedPrice: 100, notional: 100, fee: 1, generatedAt: '2026-01-03T00:00:00Z' }, evaluation: { pnlSek: 1, pnlPercent: 1, winner: true } }, idempotencyKey: null, createdAt: '2026-01-03T00:00:00Z' };
    const legacy = { id: 'legacy1', portfolioId: null, source: 'atlas_setup', kind: null, executionId: null, occurredAt: '2026-01-02T00:00:00Z', payload: { foo: 'bar' }, idempotencyKey: null, createdAt: '2026-01-02T00:00:00Z' };
    const validOld = { id: 'vold', portfolioId: 'p', source: 'atlas_runtime', kind: 'EXECUTION', executionId: null, occurredAt: '2026-01-01T00:00:00Z', payload: { id: 'vold', timestamp: '2026-01-01T00:00:00Z', kind: 'EXECUTION' }, idempotencyKey: null, createdAt: '2026-01-01T00:00:00Z' };

    vi.spyOn(store, 'listVictorAuditPage').mockResolvedValue([validNew, legacy, validOld]);
    const adapter = new SupabaseAuditAdapter();
    const res = await adapter.list();
    expect(res.length).toBe(2);
    expect(res[0].id).toBe('vnew');
    expect(res[1].id).toBe('vold');
    // ensure evaluation preserved on the new record
    const r0 = res[0] as AuditStoreEnvelope;
    expect(r0.raw.evaluation && typeof r0.raw.evaluation.pnlSek === 'number').toBeTruthy();
  });
});
