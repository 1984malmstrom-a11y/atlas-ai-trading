import { test, expect } from 'vitest';
import { fetchFinnhubEconomicCalendar, FinnhubEconomicCalendarError } from './finnhub-economic-calendar';

test('missing API key throws MACRO_CALENDAR_KEY_MISSING', async ()=>{
  await expect(fetchFinnhubEconomicCalendar({ apiKey: '' })).rejects.toMatchObject({ code: 'MACRO_CALENDAR_KEY_MISSING' });
});

test('403 response maps to PREMIUM_REQUIRED', async ()=>{
  const mockFetch = async (_input: any, _init?: any) => ({ ok: false, status: 403, statusText: 'Forbidden', text: async ()=> 'Premium required' } as any);
  await expect(fetchFinnhubEconomicCalendar({ apiKey: 'KEY', fetchImpl: mockFetch })).rejects.toMatchObject({ code: 'MACRO_CALENDAR_PREMIUM_REQUIRED' });
});

test('429 response maps to RATE_LIMITED', async ()=>{
  const mockFetch = async (_input: any, _init?: any) => ({ ok: false, status: 429, statusText: 'Too Many Requests', text: async ()=> 'Rate limited' } as any);
  await expect(fetchFinnhubEconomicCalendar({ apiKey: 'KEY', fetchImpl: mockFetch })).rejects.toMatchObject({ code: 'MACRO_CALENDAR_RATE_LIMITED' });
});

test('valid payload is mapped conservatively', async ()=>{
  const payload = [ { id: '1', event: 'CPI (YoY)', country: 'US', time: '2026-08-03T10:00:00Z', impact: 'high', actual: '1.2', estimate: '1.0', previous: '0.9', currency: 'USD' } ];
  const mockFetch = async (_input: any, _init?: any) => ({ ok: true, status: 200, json: async ()=> payload } as any);
  const res = await fetchFinnhubEconomicCalendar({ apiKey: 'KEY', fetchImpl: mockFetch });
  expect(Array.isArray(res)).toBe(true);
  expect(res.length).toBe(1);
  const r = res[0];
  expect(r.id).toBe('1');
  expect(r.category).toBe('INFLATION');
  expect(r.time).toBe('2026-08-03T10:00:00.000Z');
  expect(r.impact).toBe('HIGH');
  expect(r.actual).toBe(1.2);
  expect(r.estimate).toBe(1.0);
  expect(r.previous).toBe(0.9);
});
