import { MarketNewsItem, MarketNewsSnapshot } from './types';

export type MarketNewsValidation = {
  valid: boolean;
  fresh: boolean;
  ageMs: number | null;
  reason: string;
};

export function validateMarketNewsItem(
  item: MarketNewsItem,
  nowMs: number = Date.now(),
  maxAgeMs: number = 24 * 60 * 60 * 1000
): MarketNewsValidation {
  const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  if (!item || typeof item !== 'object') {
    return { valid: false, fresh: false, ageMs: null, reason: 'invalid_item' };
  }

  if (!trim(item.id)) {
    return { valid: false, fresh: false, ageMs: null, reason: 'missing_field:id' };
  }
  if (!trim(item.symbol)) {
    return { valid: false, fresh: false, ageMs: null, reason: 'missing_field:symbol' };
  }
  if (!trim(item.headline)) {
    return { valid: false, fresh: false, ageMs: null, reason: 'missing_field:headline' };
  }
  if (!trim(item.source)) {
    return { valid: false, fresh: false, ageMs: null, reason: 'missing_field:source' };
  }

  const pub = Date.parse(item.publishedAt);
  if (Number.isNaN(pub)) {
    return { valid: false, fresh: false, ageMs: null, reason: 'invalid_publishedAt' };
  }
  if (pub > nowMs) {
    return { valid: false, fresh: false, ageMs: nowMs - pub, reason: 'future_publishedAt' };
  }

  const fetched = Date.parse(item.fetchedAt);
  if (Number.isNaN(fetched)) {
    return { valid: false, fresh: false, ageMs: nowMs - pub, reason: 'invalid_fetchedAt' };
  }

  const ageMs = nowMs - pub;
  const fresh = ageMs <= maxAgeMs;
  const reason = fresh ? 'ok' : 'stale';

  return { valid: true, fresh, ageMs, reason };
}

export default { validateMarketNewsItem };

export type ValidatedMarketNewsSnapshot = {
  symbol: string;
  validItems: MarketNewsItem[];
  staleItems: MarketNewsItem[];
  invalidCount: number;
  fetchedAt: string;
};

export function validateMarketNewsSnapshot(
  snapshot: MarketNewsSnapshot,
  nowMs: number = Date.now(),
  maxAgeMs: number = 24 * 60 * 60 * 1000
): ValidatedMarketNewsSnapshot {
  const out: ValidatedMarketNewsSnapshot = {
    symbol: (snapshot && typeof snapshot.symbol === 'string') ? snapshot.symbol.trim() : '',
    validItems: [],
    staleItems: [],
    invalidCount: 0,
    fetchedAt: snapshot && typeof snapshot.fetchedAt === 'string' ? snapshot.fetchedAt : (snapshot && (snapshot as any).fetchedAt) || '',
  };

  const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
  for (const it of items) {
    const v = validateMarketNewsItem(it as MarketNewsItem, nowMs, maxAgeMs);
    if (!v.valid) {
      out.invalidCount += 1;
      continue;
    }
    if (v.fresh) out.validItems.push(it as MarketNewsItem);
    else out.staleItems.push(it as MarketNewsItem);
  }

  return out;
}
