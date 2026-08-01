import { describe, it, expect } from 'vitest';
import { validateMarketNewsItem, validateMarketNewsSnapshot } from './market-news';
import { MarketNewsItem } from './types';

describe('validateMarketNewsItem', () => {
  const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
  const maxAgeMs = 24 * 60 * 60 * 1000;

  it('valid and fresh news', () => {
    const item: MarketNewsItem = {
      id: 'n1',
      symbol: 'MSFT',
      headline: 'Earnings beat',
      source: 'NewsCorp',
      publishedAt: new Date(nowMs - 1000).toISOString(),
      fetchedAt: new Date(nowMs - 500).toISOString(),
      url: 'https://example.com',
    };
    const res = validateMarketNewsItem(item, nowMs, maxAgeMs);
    expect(res.valid).toBe(true);
    expect(res.fresh).toBe(true);
    expect(res.reason).toBe('ok');
    expect(res.ageMs).toBeGreaterThanOrEqual(1000);
  });

  it('valid but old news', () => {
    const item: MarketNewsItem = {
      id: 'n2',
      symbol: 'MSFT',
      headline: 'Old news',
      source: 'Archive',
      publishedAt: new Date(nowMs - maxAgeMs * 2).toISOString(),
      fetchedAt: new Date(nowMs - maxAgeMs * 2 + 1000).toISOString(),
    } as any;
    const res = validateMarketNewsItem(item, nowMs, maxAgeMs);
    expect(res.valid).toBe(true);
    expect(res.fresh).toBe(false);
    expect(res.reason).toBe('stale');
  });

  it('empty headline', () => {
    const item: MarketNewsItem = {
      id: 'n3',
      symbol: 'MSFT',
      headline: '   ',
      source: 'X',
      publishedAt: new Date(nowMs - 1000).toISOString(),
      fetchedAt: new Date(nowMs - 500).toISOString(),
    } as any;
    const res = validateMarketNewsItem(item, nowMs, maxAgeMs);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('missing_field:headline');
  });

  it('invalid publishedAt', () => {
    const item: MarketNewsItem = {
      id: 'n4',
      symbol: 'MSFT',
      headline: 'X',
      source: 'Y',
      publishedAt: 'not-a-date',
      fetchedAt: new Date(nowMs - 500).toISOString(),
    } as any;
    const res = validateMarketNewsItem(item, nowMs, maxAgeMs);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('invalid_publishedAt');
  });

  it('future publishedAt', () => {
    const item: MarketNewsItem = {
      id: 'n5',
      symbol: 'MSFT',
      headline: 'Future',
      source: 'F',
      publishedAt: new Date(nowMs + 1000).toISOString(),
      fetchedAt: new Date(nowMs + 1000).toISOString(),
    } as any;
    const res = validateMarketNewsItem(item, nowMs, maxAgeMs);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('future_publishedAt');
  });

  it('invalid fetchedAt', () => {
    const item: MarketNewsItem = {
      id: 'n6',
      symbol: 'MSFT',
      headline: 'X',
      source: 'Y',
      publishedAt: new Date(nowMs - 1000).toISOString(),
      fetchedAt: 'bad',
    } as any;
    const res = validateMarketNewsItem(item, nowMs, maxAgeMs);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('invalid_fetchedAt');
  });

  it('exact maxAgeMs is fresh', () => {
    const item: MarketNewsItem = {
      id: 'n7',
      symbol: 'MSFT',
      headline: 'Edge',
      source: 'E',
      publishedAt: new Date(nowMs - maxAgeMs).toISOString(),
      fetchedAt: new Date(nowMs - 1000).toISOString(),
    } as any;
    const res = validateMarketNewsItem(item, nowMs, maxAgeMs);
    expect(res.valid).toBe(true);
    expect(res.fresh).toBe(true);
    expect(res.reason).toBe('ok');
  });

  it('one ms over maxAgeMs is stale', () => {
    const item: MarketNewsItem = {
      id: 'n8',
      symbol: 'MSFT',
      headline: 'Edge2',
      source: 'E',
      publishedAt: new Date(nowMs - maxAgeMs - 1).toISOString(),
      fetchedAt: new Date(nowMs - 1).toISOString(),
    } as any;
    const res = validateMarketNewsItem(item, nowMs, maxAgeMs);
    expect(res.valid).toBe(true);
    expect(res.fresh).toBe(false);
    expect(res.reason).toBe('stale');
  });

  it('snapshot with fresh, stale and invalid items preserves order and counts', () => {
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
    const freshA: MarketNewsItem = { id: 'f1', symbol: 'MSFT', headline: 'A', source: 'S', publishedAt: new Date(nowMs - 1000).toISOString(), fetchedAt: new Date(nowMs - 500).toISOString() };
    const staleA: MarketNewsItem = { id: 's1', symbol: 'MSFT', headline: 'B', source: 'S', publishedAt: new Date(nowMs - maxAgeMs - 1000).toISOString(), fetchedAt: new Date(nowMs - maxAgeMs - 900).toISOString() };
    const freshB: MarketNewsItem = { id: 'f2', symbol: 'MSFT', headline: 'C', source: 'S', publishedAt: new Date(nowMs - 2000).toISOString(), fetchedAt: new Date(nowMs - 1500).toISOString() };
    const invalid: any = { id: 'x', symbol: 'MSFT', headline: 'X', source: 'S', publishedAt: 'bad', fetchedAt: new Date(nowMs - 1000).toISOString() };
    const staleB: MarketNewsItem = { id: 's2', symbol: 'MSFT', headline: 'D', source: 'S', publishedAt: new Date(nowMs - maxAgeMs - 2000).toISOString(), fetchedAt: new Date(nowMs - maxAgeMs - 1900).toISOString() };

    const snapshot = {
      symbol: ' MSFT ',
      items: [freshA, staleA, freshB, invalid, staleB],
      fetchedAt: new Date(nowMs - 100).toISOString(),
    };

    const res = validateMarketNewsSnapshot(snapshot, nowMs, maxAgeMs);

    expect(res.symbol).toBe('MSFT');
    expect(res.fetchedAt).toBe(snapshot.fetchedAt);
    expect(res.invalidCount).toBe(1);
    expect(res.validItems.map(i => i.id)).toEqual(['f1','f2']);
    expect(res.staleItems.map(i => i.id)).toEqual(['s1','s2']);
  });

  it('empty items array does not throw and returns zeros', () => {
    const snapshot = { symbol: ' X ', items: [], fetchedAt: '2026-07-30T11:00:00.000Z' } as any;
    const res = validateMarketNewsSnapshot(snapshot, Date.parse('2026-07-30T12:00:00.000Z'));
    expect(res.validItems.length).toBe(0);
    expect(res.staleItems.length).toBe(0);
    expect(res.invalidCount).toBe(0);
    expect(res.symbol).toBe('X');
    expect(res.fetchedAt).toBe(snapshot.fetchedAt);
  });

  it('exact maxAgeMs goes to validItems, one ms over goes to staleItems', () => {
    const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const edge: MarketNewsItem = { id: 'e1', symbol: 'MSFT', headline: 'Edge', source: 'S', publishedAt: new Date(nowMs - maxAgeMs).toISOString(), fetchedAt: new Date(nowMs - 1000).toISOString() };
    const over: MarketNewsItem = { id: 'o1', symbol: 'MSFT', headline: 'Over', source: 'S', publishedAt: new Date(nowMs - maxAgeMs - 1).toISOString(), fetchedAt: new Date(nowMs - 1000).toISOString() };
    const snapshot = { symbol: 'MSFT', items: [edge, over], fetchedAt: new Date(nowMs - 1).toISOString() } as any;
    const res = validateMarketNewsSnapshot(snapshot, nowMs, maxAgeMs);
    expect(res.validItems.map(i => i.id)).toEqual(['e1']);
    expect(res.staleItems.map(i => i.id)).toEqual(['o1']);
  });
});
