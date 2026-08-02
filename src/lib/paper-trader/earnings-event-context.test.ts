import { test, expect } from 'vitest';
import { buildEarningsEventContext } from './earnings-event-context';

test('upcoming within 24h -> HIGH risk', ()=>{
  const now = new Date('2026-08-01T12:00:00Z');
  const next = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const ctx = buildEarningsEventContext({ symbol: 'AAPL', records: [{ next_earnings_date: next, estimated_eps: '1.2' }], now });
  expect(ctx.status).toBe('UPCOMING');
  expect(ctx.riskLevel).toBe('HIGH');
});

test('upcoming 24-72h -> MODERATE risk', ()=>{
  const now = new Date('2026-08-01T12:00:00Z');
  const next = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const ctx = buildEarningsEventContext({ symbol: 'MSFT', records: [{ next_earnings_date: next, estimated_eps: '2.5' }], now });
  expect(ctx.status).toBe('UPCOMING');
  expect(ctx.riskLevel).toBe('MODERATE');
});

test('recent reported <12h -> HIGH risk', ()=>{
  const now = new Date('2026-08-01T12:00:00Z');
  const reported = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const ctx = buildEarningsEventContext({ symbol: 'TSLA', records: [{ reported_at: reported, eps: '0.5' }], now });
  expect(ctx.status).toBe('RECENT');
  expect(ctx.riskLevel).toBe('HIGH');
});

test('invalid or missing data -> UNKNOWN', ()=>{
  const now = new Date('2026-08-01T12:00:00Z');
  const ctx = buildEarningsEventContext({ symbol: 'NOPE', records: [], now });
  expect(ctx.status).toBe('UNKNOWN');
  expect(ctx.riskLevel).toBe('UNKNOWN');
});
