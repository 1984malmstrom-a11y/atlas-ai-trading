import { describe, it, expect } from 'vitest';
import { resolveSingleEntryForReview, type TradeReviewEntry } from './trade-review-entry';
import type { AuditEntry, AuditStoreEnvelope } from './types';

function envelope(e: any): AuditStoreEnvelope { return { id: e.id || 'x', timestamp: e.timestamp || new Date().toISOString(), summary: {}, raw: e } as any; }

describe('resolveSingleEntryForReview', () => {
  const portfolioId = 'demo';
  const symbol = 'AAA';

  it('returnerar entry för exakt en matchande BUY', () => {
    const buy: AuditEntry = { id: 'a1', timestamp: '2026-01-01T00:00:00Z', kind: 'EXECUTION', execution: { id: 'e1', decisionId: 'd1', symbol, side: 'BUY', quantity: 10, executedPrice: 100, notional: 1000, fee: 1, generatedAt: '2026-01-01T00:00:00Z' }, decision: { id: 'd1', symbol, action: 'BUY', confidence: 80, referencePrice: 100, generatedAt: '2026-01-01T00:00:00Z' } };
    const res = resolveSingleEntryForReview({ audits: [envelope(buy) as any], portfolioId, symbol, soldQuantity: 10 });
    expect(res).toEqual({ executionId: 'e1', entryPrice: 100, entryTimestamp: '2026-01-01T00:00:00Z', confidenceAtEntry: 80 });
  });

  it('läser AuditStoreEnvelope korrekt', () => {
    const buy: AuditEntry = { id: 'a2', timestamp: '2026-02-01T00:00:00Z', kind: 'EXECUTION', execution: { id: 'e2', decisionId: 'd2', symbol, side: 'BUY', quantity: 5, executedPrice: 50, notional: 250, fee: 1, generatedAt: '2026-02-01T00:00:00Z' }, decision: { id: 'd2', symbol, action: 'BUY', confidence: 60, referencePrice: 50, generatedAt: '2026-02-01T00:00:00Z' } };
    const env = envelope(buy);
    (env as any).portfolioId = portfolioId;
    const res = resolveSingleEntryForReview({ audits: [env], portfolioId, symbol, soldQuantity: 5 });
    expect(res && res.executionId).toBe('e2');
  });

  it('confidence saknas → null', () => {
    const buy: AuditEntry = { id: 'a3', timestamp: '2026-03-01T00:00:00Z', kind: 'EXECUTION', execution: { id: 'e3', decisionId: 'd3', symbol, side: 'BUY', quantity: 2, executedPrice: 10, notional: 20, fee: 0, generatedAt: '2026-03-01T00:00:00Z' } };
    const res = resolveSingleEntryForReview({ audits: [envelope(buy)], portfolioId, symbol, soldQuantity: 2 });
    expect(res && res.confidenceAtEntry).toBeNull();
  });

  it('flera matchande BUYs → null', () => {
    const b1: AuditEntry = { id: 'b1', timestamp: '2026-01-01T00:00:00Z', kind: 'EXECUTION', execution: { id: 'x1', decisionId: 'd1', symbol, side: 'BUY', quantity: 1, executedPrice: 1, notional: 1, fee: 0, generatedAt: '2026-01-01T00:00:00Z' } };
    const b2: AuditEntry = { id: 'b2', timestamp: '2026-01-02T00:00:00Z', kind: 'EXECUTION', execution: { id: 'x2', decisionId: 'd2', symbol, side: 'BUY', quantity: 1, executedPrice: 1, notional: 1, fee: 0, generatedAt: '2026-01-02T00:00:00Z' } };
    const res = resolveSingleEntryForReview({ audits: [envelope(b1), envelope(b2)], portfolioId, symbol, soldQuantity: 1 });
    expect(res).toBeNull();
  });

  it('BUY quantity skiljer sig från soldQuantity → null', () => {
    const buy: AuditEntry = { id: 'a4', timestamp: '2026-04-01T00:00:00Z', kind: 'EXECUTION', execution: { id: 'e4', decisionId: 'd4', symbol, side: 'BUY', quantity: 5, executedPrice: 10, notional: 50, fee: 0, generatedAt: '2026-04-01T00:00:00Z' } };
    const res = resolveSingleEntryForReview({ audits: [envelope(buy)], portfolioId, symbol, soldQuantity: 3 });
    expect(res).toBeNull();
  });

  it('fel portfolio eller symbol ignoreras', () => {
    const buy: AuditEntry = { id: 'a5', timestamp: '2026-05-01T00:00:00Z', kind: 'EXECUTION', execution: { id: 'e5', decisionId: 'd5', symbol: 'BBB', side: 'BUY', quantity: 1, executedPrice: 1, notional: 1, fee: 0, generatedAt: '2026-05-01T00:00:00Z' } };
    const res = resolveSingleEntryForReview({ audits: [envelope(buy)], portfolioId, symbol, soldQuantity: 1 });
    expect(res).toBeNull();
  });

  it('ogiltig BUY execution/timestamp → null', () => {
    const buy: any = { id: 'a6', timestamp: 'not-a-time', kind: 'EXECUTION', execution: { id: 'e6', decisionId: 'd6', symbol, side: 'BUY', quantity: 2, executedPrice: 10, notional: 20, fee: 0, generatedAt: '2026-06-01T00:00:00Z' } };
    const res = resolveSingleEntryForReview({ audits: [envelope(buy)], portfolioId, symbol, soldQuantity: 2 });
    expect(res).toBeNull();
  });
});
