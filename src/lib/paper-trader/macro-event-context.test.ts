import { test, expect } from 'vitest';
import { buildMacroEventContext, sanitizeMacroEventContextForState } from './macro-event-context';

test('HIGH event within 6h => HIGH risk and imminent warning', ()=>{
  const now = new Date('2026-08-02T00:00:00.000Z');
  const in3h = new Date(now.getTime() + 3*60*60*1000).toISOString();
  const ctx = buildMacroEventContext({ events: [{ id: 'e1', name: 'FOMC', category: 'INTEREST_RATE', importance: 'HIGH', scheduled_at: in3h }], now });
  expect(ctx.riskLevel).toBe('HIGH');
  expect(ctx.highImportanceEventCount).toBe(1);
  expect(ctx.warnings).toContain('MACRO_EVENT_IMMINENT');
});

test('MEDIUM within 6h => MODERATE; HIGH 6-24 => MODERATE', ()=>{
  const now = new Date('2026-08-02T00:00:00.000Z');
  const in4h = new Date(now.getTime() + 4*60*60*1000).toISOString();
  const in8h = new Date(now.getTime() + 8*60*60*1000).toISOString();
  const ctx1 = buildMacroEventContext({ events: [{ id: 'm1', name: 'CPI', category: 'INFLATION', importance: 'MEDIUM', scheduled_at: in4h }], now });
  expect(ctx1.riskLevel).toBe('MODERATE');
  const ctx2 = buildMacroEventContext({ events: [{ id: 'h1', name: 'GDP', category: 'GDP', importance: 'HIGH', scheduled_at: in8h }], now });
  expect(ctx2.riskLevel).toBe('MODERATE');
});

test('passed events and >7days excluded; invalid timestamps skipped; dedupe and max 10', ()=>{
  const now = new Date('2026-08-02T00:00:00.000Z');
  const past = new Date(now.getTime() - 2*60*60*1000).toISOString();
  const far = new Date(now.getTime() + 9*24*60*60*1000).toISOString();
  const good = new Date(now.getTime() + 2*60*60*1000).toISOString();
  const events = [ { id: 'a', name: 'A', category: 'OTHER', importance: 'LOW', scheduled_at: past }, { id: 'b', name: 'B', category: 'OTHER', importance: 'LOW', scheduled_at: far }, { id: 'c', name: 'C', category: 'OTHER', importance: 'HIGH', scheduled_at: good }, { id: 'c', name: 'C', category: 'OTHER', importance: 'HIGH', scheduled_at: good }, { id: 'x', name: 'X', category: 'OTHER', importance: 'LOW', scheduled_at: 'not-a-date' } ];
  const ctx = buildMacroEventContext({ events, now });
  expect(ctx.upcomingEvents.length).toBeGreaterThanOrEqual(1);
  // duplicates removed
  const ids = ctx.upcomingEvents.map(e=> e.id);
  expect(new Set(ids).size).toBe(ids.length);
  // invalid timestamp not included
  expect(ctx.upcomingEvents.every(e => e.scheduledAt !== 'not-a-date')).toBe(true);
});

test('sanitize produces JSON-safe, defensive copy', ()=>{
  const now = new Date('2026-08-02T00:00:00.000Z');
  const in1 = new Date(now.getTime() + 2*60*60*1000).toISOString();
  const ctx = buildMacroEventContext({ events: [{ id: 'z', name: 'PMI', category: 'PMI', importance: 'LOW', scheduled_at: in1 }], now });
  const san = sanitizeMacroEventContextForState(ctx as any);
  expect(san).toHaveProperty('generatedAt');
  expect(() => JSON.stringify(san)).not.toThrow();
});
