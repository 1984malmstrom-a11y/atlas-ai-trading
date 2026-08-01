import { describe, it, expect } from 'vitest';
import { createMarketNewsActivity } from './market-news-activity';
import type { MarketNewsIntelligenceSummary } from './cycle-intelligence-snapshot';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

describe('createMarketNewsActivity', () => {
  it('only fresh news', () => {
    const input: MarketNewsIntelligenceSummary = {
      symbol: 'ABC',
      freshCount: 3,
      staleCount: 0,
      invalidCount: 0,
      latestPublishedAt: undefined,
    } as any;
    const before = clone(input);
    const activity = createMarketNewsActivity(input);

    expect(activity.title).toBe('Nyhetsanalys för ABC');
    expect(activity.message).toBe('3 färska nyheter kunde användas.');
    expect(input).toEqual(before);
  });

  it('singular freshCount', () => {
    const input: MarketNewsIntelligenceSummary = {
      symbol: 'ONE',
      freshCount: 1,
      staleCount: 0,
      invalidCount: 0,
    } as any;
    const before = clone(input);
    const activity = createMarketNewsActivity(input);

    expect(activity.title).toBe('Nyhetsanalys för ONE');
    expect(activity.message).toBe('1 färsk nyhet kunde användas.');
    expect(input).toEqual(before);
  });

  it('fresh + stale + invalid', () => {
    const input: MarketNewsIntelligenceSummary = {
      symbol: 'XYZ',
      freshCount: 2,
      staleCount: 1,
      invalidCount: 3,
    } as any;
    const before = clone(input);
    const activity = createMarketNewsActivity(input);

    expect(activity.title).toBe('Nyhetsanalys för XYZ');
    expect(activity.message).toBe(
      '2 färska nyheter kunde användas. 1 äldre nyhet. 3 ogiltiga artiklar.'
    );
    expect(input).toEqual(before);
  });

  it('no fresh news', () => {
    const input: MarketNewsIntelligenceSummary = {
      symbol: 'NOFRESH',
      freshCount: 0,
      staleCount: 2,
      invalidCount: 0,
    } as any;
    const before = clone(input);
    const activity = createMarketNewsActivity(input);

    expect(activity.title).toBe('Nyhetsanalys för NOFRESH');
    expect(activity.message).toBe('Inga färska nyheter kunde användas. 2 äldre nyheter.');
    expect(input).toEqual(before);
  });

  it('singular/plural for stale and invalid', () => {
    const input: MarketNewsIntelligenceSummary = {
      symbol: 'SING',
      freshCount: 0,
      staleCount: 1,
      invalidCount: 1,
    } as any;
    const before = clone(input);
    const activity = createMarketNewsActivity(input);

    expect(activity.title).toBe('Nyhetsanalys för SING');
    expect(activity.message).toBe('Inga färska nyheter kunde användas. 1 äldre nyhet. 1 ogiltig artikel.');
    expect(input).toEqual(before);
  });

  it('does not mutate input', () => {
    const input: MarketNewsIntelligenceSummary = {
      symbol: 'MUT',
      freshCount: 4,
      staleCount: 5,
      invalidCount: 6,
    } as any;
    const before = clone(input);
    createMarketNewsActivity(input);
    expect(input).toEqual(before);
  });
});
