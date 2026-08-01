import { describe, it, expect } from 'vitest';
import { parseTwelveTimestamp } from './twelve-data';

describe('Twelve Data timestamp parser', () => {
  it('parses UTC datetime without offset as UTC with same clock time', () => {
    const ts = parseTwelveTimestamp('2026-07-29 06:24:00');
    expect(ts).not.toBeNull();
    expect(ts!.toISOString()).toBe('2026-07-29T06:24:00.000Z');
  });

  it('parses 10-digit epoch as seconds UTC', () => {
    const seconds = 1596240000; // 2020-08-01T00:00:00Z
    const ts = parseTwelveTimestamp(seconds);
    expect(ts).not.toBeNull();
    expect(ts!.toISOString()).toBe('2020-08-01T00:00:00.000Z');
  });

  it('parses 13-digit epoch as milliseconds UTC', () => {
    const ms = 1596240000123; // 2020-08-01T00:00:00.123Z
    const ts = parseTwelveTimestamp(ms);
    expect(ts).not.toBeNull();
    expect(ts!.toISOString()).toBe('2020-08-01T00:00:00.123Z');
  });

  it('parses ISO with Z correctly', () => {
    const ts = parseTwelveTimestamp('2026-07-29T06:24:00Z');
    expect(ts).not.toBeNull();
    expect(ts!.toISOString()).toBe('2026-07-29T06:24:00.000Z');
  });

  it('parses ISO with offset correctly', () => {
    const ts = parseTwelveTimestamp('2026-07-29T08:24:00+02:00');
    expect(ts).not.toBeNull();
    expect(ts!.toISOString()).toBe('2026-07-29T06:24:00.000Z');
  });

  it('returns null for invalid values', () => {
    expect(parseTwelveTimestamp('not-a-date')).toBeNull();
    expect(parseTwelveTimestamp('')).toBeNull();
    expect(parseTwelveTimestamp(null)).toBeNull();
  });

  it('freshness regression: provider string near system time', () => {
    // simulated system time 2026-07-29T06:24:30Z, provider datetime 2026-07-29 06:24:00
    const sys = new Date('2026-07-29T06:24:30Z').getTime();
    const prov = parseTwelveTimestamp('2026-07-29 06:24:00');
    expect(prov).not.toBeNull();
    const ageSec = Math.round((sys - prov!.getTime())/1000);
    expect(ageSec).toBe(30);
  });
});
