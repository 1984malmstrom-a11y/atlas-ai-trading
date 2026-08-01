import { MarketNewsSnapshot, MarketNewsItem } from './types';
import { validateMarketNewsSnapshot } from './market-news';

export type MarketNewsIntelligenceSummary = {
  symbol: string;
  freshCount: number;
  staleCount: number;
  invalidCount: number;
  latestPublishedAt: string | null;
};

export function createMarketNewsIntelligenceSummary(
  snapshot: MarketNewsSnapshot,
  nowMs?: number,
  maxAgeMs?: number
): MarketNewsIntelligenceSummary {
  const validated = validateMarketNewsSnapshot(snapshot, nowMs, maxAgeMs);
  const freshCount = validated.validItems.length;
  const staleCount = validated.staleItems.length;
  const invalidCount = validated.invalidCount;
  const symbol = validated.symbol;

  // Determine latest publishedAt among valid and stale items, preserving original ISO strings
  let latest: { ts: number; iso: string } | null = null;
  const candidates: MarketNewsItem[] = [...validated.validItems, ...validated.staleItems];
  for (const it of candidates) {
    const ts = Date.parse(it.publishedAt);
    if (Number.isNaN(ts)) continue;
    if (!latest || ts > latest.ts) latest = { ts, iso: it.publishedAt };
  }

  return {
    symbol,
    freshCount,
    staleCount,
    invalidCount,
    latestPublishedAt: latest ? latest.iso : null,
  };
}

export default { createMarketNewsIntelligenceSummary };
