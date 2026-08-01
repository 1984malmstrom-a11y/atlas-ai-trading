import { describe, it, expect } from 'vitest';
import { MarketNewsItem, MarketNewsSnapshot } from './types';
import { createMarketNewsIntelligenceSummary } from './cycle-intelligence-snapshot';

describe('createMarketNewsIntelligenceSummary', () => {
  const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
  const maxAgeMs = 24 * 60 * 60 * 1000;

  it('mixed fresh, stale and invalid items produce correct counts and latestPublishedAt', () => {
    const fresh: MarketNewsItem = { id: 'f1', symbol: 'MSFT', headline: 'Fresh', source: 'S', publishedAt: new Date(nowMs - 1000).toISOString(), fetchedAt: new Date(nowMs - 500).toISOString() };
    const stale: MarketNewsItem = { id: 's1', symbol: 'MSFT', headline: 'Stale', source: 'S', publishedAt: new Date(nowMs - maxAgeMs - 2000).toISOString(), fetchedAt: new Date(nowMs - maxAgeMs - 1900).toISOString() };
    const invalid: any = { id: 'x', symbol: 'MSFT', headline: 'X', source: 'S', publishedAt: 'bad', fetchedAt: new Date(nowMs - 1000).toISOString() };

    const snapshot: MarketNewsSnapshot = {
      symbol: ' MSFT ',
      items: [fresh, stale, invalid],
      fetchedAt: new Date(nowMs - 100).toISOString(),
    } as any;

    const res = createMarketNewsIntelligenceSummary(snapshot, nowMs, maxAgeMs);
    expect(res.symbol).toBe('MSFT');
    expect(res.freshCount).toBe(1);
    expect(res.staleCount).toBe(1);
    expect(res.invalidCount).toBe(1);
    // latest should be the fresh item's publishedAt
    expect(res.latestPublishedAt).toBe(fresh.publishedAt);
  });

  it('stale items can be latestPublishedAt when no fresh items exist', () => {
    const staleA: MarketNewsItem = { id: 'sA', symbol: 'MSFT', headline: 'A', source: 'S', publishedAt: new Date(nowMs - maxAgeMs - 1000).toISOString(), fetchedAt: new Date(nowMs - maxAgeMs - 900).toISOString() };
    const staleB: MarketNewsItem = { id: 'sB', symbol: 'MSFT', headline: 'B', source: 'S', publishedAt: new Date(nowMs - maxAgeMs - 500).toISOString(), fetchedAt: new Date(nowMs - maxAgeMs - 400).toISOString() };
    const snapshot: MarketNewsSnapshot = { symbol: 'MSFT', items: [staleA, staleB], fetchedAt: new Date(nowMs - 1).toISOString() } as any;
    const res = createMarketNewsIntelligenceSummary(snapshot, nowMs, maxAgeMs);
    expect(res.freshCount).toBe(0);
    expect(res.staleCount).toBe(2);
    expect(res.invalidCount).toBe(0);
    // latest should be the newer staleB
    expect(res.latestPublishedAt).toBe(staleB.publishedAt);
  });

  it('only invalid items produce null latestPublishedAt and invalidCount equals items length', () => {
    const invalidA: any = { id: 'i1', symbol: 'MSFT', headline: 'X', source: 'S', publishedAt: 'bad', fetchedAt: new Date(nowMs - 1000).toISOString() };
    const invalidB: any = { id: 'i2', symbol: 'MSFT', headline: 'Y', source: 'S', publishedAt: 'nope', fetchedAt: new Date(nowMs - 2000).toISOString() };
    const snapshot: MarketNewsSnapshot = { symbol: 'MSFT', items: [invalidA, invalidB], fetchedAt: new Date(nowMs - 1).toISOString() } as any;
    const res = createMarketNewsIntelligenceSummary(snapshot, nowMs, maxAgeMs);
    expect(res.freshCount).toBe(0);
    expect(res.staleCount).toBe(0);
    expect(res.invalidCount).toBe(2);
    expect(res.latestPublishedAt).toBeNull();
  });

  it('empty items array gives null latestPublishedAt and zero counts and trimmed symbol', () => {
    const snapshot: MarketNewsSnapshot = { symbol: ' X ', items: [], fetchedAt: new Date(nowMs - 1).toISOString() } as any;
    const res = createMarketNewsIntelligenceSummary(snapshot, nowMs, maxAgeMs);
    expect(res.freshCount).toBe(0);
    expect(res.staleCount).toBe(0);
    expect(res.invalidCount).toBe(0);
    expect(res.latestPublishedAt).toBeNull();
    expect(res.symbol).toBe('X');
  });
});\r\n
