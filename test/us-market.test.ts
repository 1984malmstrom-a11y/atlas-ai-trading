import { expect, test } from 'vitest';
import { computeUSMarketStatus, getNextNYOpenInstant } from '../src/lib/us-market';

function fmtStockholm(date: Date){
  return date.toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour12:false, hour: '2-digit', minute: '2-digit' });
}

test('1. Friday before opening -> Öppnar idag 15:30', ()=>{
  const now = '2026-07-17T12:00:00Z'; // Friday 08:00 NY
  const next = getNextNYOpenInstant(now) as any;
  expect(next.open).toBe(false);
  const stockholm = fmtStockholm(next.nextOpenInstant);
  expect(stockholm).toBe('15:30');
  // day text should be 'idag' when comparing NY weekday of now and next
  const nyDayNow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(now));
  const nyDayNext = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(next.nextOpenInstant);
  expect(nyDayNow).toBe(nyDayNext);
  const expectedText = `Öppnar idag ${stockholm}`;
  const computed = computeUSMarketStatus(now);
  expect(computed).toBe(expectedText);
});

test('2. Friday after close -> next open is måndag 15:30', ()=>{
  const now = '2026-07-17T21:00:00Z';
  const next = getNextNYOpenInstant(now) as any;
  expect(next.open).toBe(false);
  const weekdayNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(next.nextOpenInstant);
  expect(weekdayNY).toBe('Mon');
  const stockholm = fmtStockholm(next.nextOpenInstant);
  expect(stockholm).toBe('15:30');
  const expected = `Öppnar måndag ${stockholm}`;
  // computeUSMarketStatus compares based on system date for 'idag' logic; construct expected and verify helper text
  const computed = computeUSMarketStatus(now);
  expect(computed).toBe(expected);
});

test('3. Saturday -> next open is måndag 15:30', ()=>{
  const now = '2026-07-18T12:00:00Z'; // Saturday
  const next = getNextNYOpenInstant(now) as any;
  expect(next.open).toBe(false);
  const weekdayNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(next.nextOpenInstant);
  expect(weekdayNY).toBe('Mon');
  const stockholm = fmtStockholm(next.nextOpenInstant);
  expect(stockholm).toBe('15:30');
  const expected = `Öppnar måndag ${stockholm}`;
  const computed = computeUSMarketStatus(now);
  expect(computed).toBe(expected);
});

test('4. Weekday during session -> Öppen', ()=>{
  const now = '2026-07-15T14:00:00Z'; // Wed 10:00 NY
  const s = getNextNYOpenInstant(now) as any;
  expect(s.open).toBe(true);
  const status = computeUSMarketStatus(now);
  expect(status).toBe('Öppen');
});

test('5. DST difference week -> Stockholm shows 14:30 (US DST before Sweden)', ()=>{
  const now = '2026-03-16T00:00:00Z'; // between US and SE DST switch
  const next = getNextNYOpenInstant(now) as any;
  expect(next.open).toBe(false);
  const stockholm = fmtStockholm(next.nextOpenInstant);
  expect(stockholm).toBe('14:30');
  const expected = `Öppnar ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', weekday: 'long' }).format(next.nextOpenInstant)} ${stockholm}`;
  const computed = computeUSMarketStatus(now);
  expect(computed).toBe(expected);
});

test('6. Normal week -> opening 15:30', ()=>{
  const now = '2026-07-14T00:00:00Z';
  const next = getNextNYOpenInstant(now) as any;
  const stockholm = fmtStockholm(next.nextOpenInstant);
  expect(stockholm).toBe('15:30');
  const expected = `Öppnar ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', weekday: 'long' }).format(next.nextOpenInstant)} ${stockholm}`;
  const computed = computeUSMarketStatus(now);
  // computeUSMarketStatus may return 'Öppen' for times within session; ensure consistency
  if (next.open) expect(computed).toBe('Öppen'); else expect(computed).toBe(expected);
});
