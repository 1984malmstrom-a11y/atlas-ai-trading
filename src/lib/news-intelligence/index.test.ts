import { describe, it, expect } from 'vitest';
import { buildNewsIntelligence, normalizeNewsItems, deduplicateNewsItems } from './index';

const NOW = Date.parse('2024-01-02T12:00:00.000Z');

describe('news-intelligence v1', ()=>{
  it('handles empty input', ()=>{
    const res = buildNewsIntelligence([], { nowMs: NOW });
    expect(res.totalItems).toBe(0);
    expect(res.events.length).toBe(0);
  });

  it('does not mutate input', ()=>{
    const input = [{ source:'FINNHUB' as any, headline:' h ', publishedAt:'2024-01-02T11:00:00Z' }];
    const copy = JSON.stringify(input);
    buildNewsIntelligence(input, { nowMs: NOW });
    expect(JSON.stringify(input)).toBe(copy);
  });

  it('symbol normalization and dedup symbols', ()=>{
    const raw = [{ source:'FMP' as any, headline:'x', publishedAt:'2024-01-02T10:00:00Z', symbols:['a','A',''] }];
    const norm = normalizeNewsItems(raw, NOW)[0] as any;
    expect(norm.symbols).toEqual(['A']);
  });

  it('stable id and fingerprint', ()=>{
    const a = { source:'FINNHUB' as any, headline:'Same', publishedAt:'2024-01-02T09:00:00Z' };
    const n1 = normalizeNewsItems([a], NOW)[0];
    const n2 = normalizeNewsItems([a], NOW)[0];
    expect(n1.id).toBe(n2.id);
    expect(n1.fingerprint).toBe(n2.fingerprint);
  });

  it('classifies earnings', ()=>{
    const r = buildNewsIntelligence([{ source:'FMP' as any, headline:'Company posts earnings report', publishedAt:'2024-01-02T10:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].category).toBe('EARNINGS');
  });

  it('classifies guidance', ()=>{
    const r = buildNewsIntelligence([{ source:'FMP' as any, headline:'guidance cut outlook', publishedAt:'2024-01-02T09:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].category).toBe('GUIDANCE');
  });

  it('classifies analyst', ()=>{
    const r = buildNewsIntelligence([{ source:'FINNHUB' as any, headline:'analyst upgrade price target', publishedAt:'2024-01-02T08:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].category).toBe('ANALYST');
  });

  it('classifies insider', ()=>{
    const r = buildNewsIntelligence([{ source:'FMP' as any, headline:'insider bought shares', publishedAt:'2024-01-02T07:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].category).toBe('INSIDER');
  });

  it('classifies regulatory', ()=>{
    const r = buildNewsIntelligence([{ source:'SEC' as any, headline:'SEC files investigation', publishedAt:'2024-01-02T06:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].category).toBe('REGULATORY');
  });

  it('classifies m&a', ()=>{
    const r = buildNewsIntelligence([{ source:'FINNHUB' as any, headline:'company announces acquisition of rival', publishedAt:'2024-01-02T05:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].category).toBe('M_AND_A');
  });

  it('classifies legal', ()=>{
    const r = buildNewsIntelligence([{ source:'OTHER' as any, headline:'lawsuit filed against company', publishedAt:'2024-01-02T04:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].category).toBe('LEGAL');
  });

  it('classifies management', ()=>{
    const r = buildNewsIntelligence([{ source:'COMPANY' as any, headline:'CEO resigns', publishedAt:'2024-01-02T03:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].category).toBe('MANAGEMENT');
  });

  it('classifies macro', ()=>{
    const r = buildNewsIntelligence([{ source:'FINNHUB' as any, headline:'Fed raises rates CPI report', publishedAt:'2024-01-02T02:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].category).toBe('MACRO');
  });

  it('positive sentiment', ()=>{
    const r = buildNewsIntelligence([{ source:'FMP' as any, headline:'company beats estimates and raises guidance', publishedAt:'2024-01-02T01:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].sentiment).toBe('POSITIVE');
  });

  it('negative sentiment', ()=>{
    const r = buildNewsIntelligence([{ source:'FINNHUB' as any, headline:'company misses and faces investigation', publishedAt:'2024-01-01T12:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].sentiment).toBe('NEGATIVE');
  });

  it('mixed sentiment', ()=>{
    const r = buildNewsIntelligence([{ source:'FMP' as any, headline:'company beats but faces lawsuit', publishedAt:'2024-01-01T11:00:00Z' }], { nowMs: NOW });
    expect(r.events[0].sentiment).toBe('MIXED');
  });

  it('importance critical and high', ()=>{
    const r1 = buildNewsIntelligence([{ source:'SEC' as any, headline:'company bankrupt filing', publishedAt:'2024-01-01T10:00:00Z' }], { nowMs: NOW });
    expect(r1.events[0].importance).toBe('CRITICAL');
    const r2 = buildNewsIntelligence([{ source:'FMP' as any, headline:'quarterly earnings released', publishedAt:'2024-01-01T09:00:00Z' }], { nowMs: NOW });
    expect(r2.events[0].importance).toBe('HIGH');
  });

  it('deduplication merges similar from different sources and respects SEC priority', ()=>{
    const a = { source:'FINNHUB' as any, headline:'rumor: deal announced', publishedAt:'2024-01-01T08:00:00Z', symbols:['zzz'] };
    const b = { source:'FMP' as any, headline:'Rumor: deal announced ', publishedAt:'2024-01-01T08:05:00Z', symbols:['ZZZ'] };
    const c = { source:'SEC' as any, headline:'RUMOR: deal announced', publishedAt:'2024-01-01T08:02:00Z', symbols:['ZZZ'] };
    const intel = buildNewsIntelligence([a,b,c], { nowMs: NOW });
    expect(intel.events.length).toBe(1);
    expect(intel.events[0].primarySource).toBe('SEC');
    expect(intel.events[0].symbols).toEqual(['ZZZ']);
    expect(intel.warnings).toContain('DUPLICATE_MERGED');
  });

  it('recent window and old news', ()=>{
    const recent = { source:'FMP' as any, headline:'recent', publishedAt:'2024-01-02T11:30:00Z' };
    const old = { source:'FMP' as any, headline:'old', publishedAt:'2023-12-01T00:00:00Z' };
    const intel = buildNewsIntelligence([recent,old], { nowMs: NOW, recentWindowMinutes: 24*60 });
    expect(intel.recentItems).toBe(1);
  });

  it('future date warning', ()=>{
    const f = { source:'FMP' as any, headline:'future', publishedAt:'2025-01-01T00:00:00Z' };
    const intel = buildNewsIntelligence([f], { nowMs: NOW });
    expect(intel.warnings).toContain('FUTURE_DATE');
  });

  it('invalid date warning', ()=>{
    const inv = { source:'FINNHUB' as any, headline:'bad date', publishedAt:'not-a-date' };
    const intel = buildNewsIntelligence([inv], { nowMs: NOW });
    expect(intel.warnings).toContain('INVALID_DATE');
  });

  it('sorting by importance then recent', ()=>{
    const a = { source:'FMP' as any, headline:'product launch', publishedAt:'2024-01-02T11:00:00Z' };
    const b = { source:'SEC' as any, headline:'major acquisition', publishedAt:'2024-01-02T10:00:00Z' };
    const intel = buildNewsIntelligence([a,b], { nowMs: NOW });
    expect(intel.events[0].importance).toBe('CRITICAL');
  });

  it('determinism across runs', ()=>{
    const inputs = [
      { source:'FMP' as any, headline:'steady', publishedAt:'2024-01-02T09:00:00Z' },
      { source:'FINNHUB' as any, headline:'steady', publishedAt:'2024-01-02T09:00:00Z' },
    ];
    const r1 = buildNewsIntelligence(inputs, { nowMs: NOW });
    const r2 = buildNewsIntelligence(inputs, { nowMs: NOW });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
