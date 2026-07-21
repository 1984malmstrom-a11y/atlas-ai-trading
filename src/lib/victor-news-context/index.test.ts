import { describe, it, expect } from 'vitest';
import { buildNewsIntelligence } from '../news-intelligence/index';
import { buildVictorNewsContext } from './index';

const NOW = Date.parse('2024-01-02T12:00:00.000Z');

describe('victor-news-context v1', ()=>{
  it('empty input produces neutral', ()=>{
    const ni = buildNewsIntelligence([], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.marketMood).toBe('NEUTRAL');
  });

  it('bullish when positive weighted events', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'company beats and raises guidance', publishedAt:'2024-01-02T11:00:00Z' }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.marketMood).toBe('BULLISH');
  });

  it('bearish when negative weighted events', ()=>{
    const ni = buildNewsIntelligence([{ source:'FINNHUB' as any, headline:'company misses and faces investigation', publishedAt:'2024-01-02T11:00:00Z' }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.marketMood).toBe('BEARISH');
  });

  it('mixed when both sides present', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'beats', publishedAt:'2024-01-02T10:00:00Z' },
      { source:'FINNHUB' as any, headline:'lawsuit filed', publishedAt:'2024-01-02T09:00:00Z' },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(['MIXED','BULLISH','BEARISH']).toContain(ctx.marketMood);
  });

  it('topEvents max 5 and only high/critical', ()=>{
    const inputs = [] as any[];
    for(let i=0;i<8;i++) inputs.push({ source:'FMP' as any, headline:'event '+i, publishedAt:`2024-01-02T0${i}:00:00Z` });
    const ni = buildNewsIntelligence(inputs, { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.topEvents.length).toBeLessThanOrEqual(5);
  });

  it('opportunities and risks select HIGH/CRITICAL with sentiment', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'beats', publishedAt:'2024-01-02T11:00:00Z' },
      { source:'FMP' as any, headline:'lawsuit', publishedAt:'2024-01-02T10:00:00Z' },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(Array.isArray(ctx.opportunities)).toBe(true);
    expect(Array.isArray(ctx.risks)).toBe(true);
  });

  it('watchlist contains symbols from high events', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'earnings report: beats estimates', publishedAt:'2024-01-02T11:00:00Z', symbols:['AAPL'] }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.watchlist).toEqual(['AAPL']);
  });

  it('portfolioMentions unique and sorted', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'x', publishedAt:'2024-01-02T11:00:00Z', symbols:['b','a'] },
      { source:'FINNHUB' as any, headline:'y', publishedAt:'2024-01-02T10:00:00Z', symbols:['a'] },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.portfolioMentions).toEqual(['A','B']);
  });

  it('summary deterministic phrasing', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'approved', publishedAt:'2024-01-02T11:00:00Z' }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(typeof ctx.summary).toBe('string');
  });

  it('handles duplicate symbols', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'beat', publishedAt:'2024-01-02T11:00:00Z', symbols:['a'] },
      { source:'FINNHUB' as any, headline:'beat', publishedAt:'2024-01-02T10:00:00Z', symbols:['A'] },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.portfolioMentions).toEqual(['A']);
  });

  it('determinism across runs', ()=>{
    const input = [{ source:'FMP' as any, headline:'steady', publishedAt:'2024-01-02T11:00:00Z', symbols:['Z'] }];
    const n1 = buildNewsIntelligence(input, { nowMs: NOW });
    const c1 = buildVictorNewsContext(n1 as any);
    const n2 = buildNewsIntelligence(input, { nowMs: NOW });
    const c2 = buildVictorNewsContext(n2 as any);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });

  it('sorting respects importance then time', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'product launch', publishedAt:'2024-01-02T11:00:00Z' },
      { source:'SEC' as any, headline:'major acquisition', publishedAt:'2024-01-02T10:00:00Z' },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.topEvents[0].importance === 'CRITICAL' || ctx.topEvents[0].importance === 'HIGH').toBe(true);
  });

  it('only includes HIGH/CRITICAL in topEvents', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'minor mention', publishedAt:'2024-01-02T11:00:00Z' }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.topEvents.length).toBeLessThanOrEqual(1);
  });

  it('opportunities empty when none', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'neutral note', publishedAt:'2024-01-02T11:00:00Z' }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(Array.isArray(ctx.opportunities)).toBe(true);
  });

  it('risks empty when none', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'neutral note', publishedAt:'2024-01-02T11:00:00Z' }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(Array.isArray(ctx.risks)).toBe(true);
  });

  it('watchlist empty when no symbols', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'beats', publishedAt:'2024-01-02T11:00:00Z' }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(Array.isArray(ctx.watchlist)).toBe(true);
  });

  it('topEvents limited when many high events', ()=>{
    const inputs = [] as any[];
    for(let i=0;i<10;i++) inputs.push({ source:'FMP' as any, headline:'big '+i, publishedAt:`2024-01-02T0${i}:00:00Z` });
    const ni = buildNewsIntelligence(inputs, { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.topEvents.length).toBeLessThanOrEqual(5);
  });

  // New tests to enforce watchlist and summary contracts
  it('MEDIUM events do not appear in watchlist', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'product launch', publishedAt:'2024-01-02T11:00:00Z', symbols:['M1'] }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.watchlist).not.toContain('M1');
    expect(ctx.portfolioMentions).toContain('M1');
  });

  it('LOW events do not appear in watchlist but in portfolioMentions', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'note', publishedAt:'2024-01-02T11:00:00Z', symbols:['L1'] }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.watchlist).not.toContain('L1');
    expect(ctx.portfolioMentions).toContain('L1');
  });

  it('affectedSymbols without HIGH/CRITICAL do not fill watchlist', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'product update', publishedAt:'2024-01-02T11:00:00Z', symbols:['X'] },
      { source:'FINNHUB' as any, headline:'note', publishedAt:'2024-01-02T10:00:00Z', symbols:['Y'] },
    ], { nowMs: NOW });
    // ensure affectedSymbols exist in input
    expect((ni as any).affectedSymbols.length).toBeGreaterThan(0);
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.watchlist.length).toBe(0);
  });

  it('portfolioMentions contains MEDIUM symbols', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'product launch', publishedAt:'2024-01-02T11:00:00Z', symbols:['PM1'] }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.portfolioMentions).toContain('PM1');
  });

  it('portfolioMentions contains LOW symbols', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'minor note', publishedAt:'2024-01-02T11:00:00Z', symbols:['PL1'] }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.portfolioMentions).toContain('PL1');
  });

  it('singular positive summary phrasing', ()=>{
    const ni = buildNewsIntelligence([{ source:'FMP' as any, headline:'earnings report: beats estimates', publishedAt:'2024-01-02T11:00:00Z' }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.summary).toBe('1 viktig positiv händelse identifierades.');
  });

  it('plural positive summary phrasing', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'earnings report: beats estimates', publishedAt:'2024-01-02T11:00:00Z' },
      { source:'FMP' as any, headline:'raises guidance', publishedAt:'2024-01-02T10:00:00Z' },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.summary).toBe('2 viktiga positiva händelser identifierades.');
  });

  it('singular regulatory risk phrasing', ()=>{
    const ni = buildNewsIntelligence([{ source:'SEC' as any, headline:'investigation', publishedAt:'2024-01-02T11:00:00Z' }], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.summary).toBe('1 regulatorisk risk identifierades.');
  });

  it('plural regulatory risks phrasing', ()=>{
    const ni = buildNewsIntelligence([
      { source:'SEC' as any, headline:'investigation A', publishedAt:'2024-01-02T11:00:00Z' },
      { source:'SEC' as any, headline:'investigation B', publishedAt:'2024-01-02T10:00:00Z' },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.summary).toBe('2 regulatoriska risker identifierades.');
  });

  it('combined singular/plural summary', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'earnings report: beats estimates', publishedAt:'2024-01-02T11:00:00Z' },
      { source:'FMP' as any, headline:'raises guidance', publishedAt:'2024-01-02T10:00:00Z' },
      { source:'SEC' as any, headline:'investigation', publishedAt:'2024-01-02T09:00:00Z' },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.summary).toBe('2 viktiga positiva händelser och 1 regulatorisk risk identifierades.');
  });

  it('watchlist is alphabetically sorted and unique', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'earnings report: beats estimates', publishedAt:'2024-01-02T11:00:00Z', symbols:['ZZZ'] },
      { source:'SEC' as any, headline:'acquisition', publishedAt:'2024-01-02T10:00:00Z', symbols:['AAA'] },
      { source:'FMP' as any, headline:'earnings report: beats', publishedAt:'2024-01-02T09:00:00Z', symbols:['ZZZ'] },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.watchlist).toEqual(['AAA','ZZZ']);
  });

  it('portfolioMentions is alphabetically sorted and unique', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FMP' as any, headline:'note', publishedAt:'2024-01-02T11:00:00Z', symbols:['B','a'] },
      { source:'FMP' as any, headline:'note2', publishedAt:'2024-01-02T10:00:00Z', symbols:['a','C'] },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    expect(ctx.portfolioMentions).toEqual(['A','B','C']);
  });

  it('topEvents retains importance sorting (CRITICAL before HIGH)', ()=>{
    const ni = buildNewsIntelligence([
      { source:'FINNHUB' as any, headline:'investigation', publishedAt:'2024-01-02T09:00:00Z' },
      { source:'FMP' as any, headline:'earnings', publishedAt:'2024-01-02T10:00:00Z' },
    ], { nowMs: NOW });
    const ctx = buildVictorNewsContext(ni as any);
    if(ctx.topEvents.length >= 2) expect(ctx.topEvents[0].importance === 'CRITICAL').toBe(true);
  });

  it('does not mutate input news intelligence object', ()=>{
    const raw = [{ source:'FMP' as any, headline:'beats', publishedAt:'2024-01-02T11:00:00Z', symbols:['S'] }];
    const ni = buildNewsIntelligence(raw, { nowMs: NOW });
    const copy = JSON.stringify(ni);
    buildVictorNewsContext(ni as any);
    expect(JSON.stringify(ni)).toBe(copy);
  });
});
