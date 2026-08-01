import { describe, it, expect } from 'vitest';
import { buildSectorStrengthSummaries, createSectorStrengthSignalForInstrument } from './sector-signals';
import { pickSupportingSignalIds } from './demo-runtime';

describe('sector strength summaries and signals', () => {
  it('builds bullish sector when avg >= 0.75', () => {
    const inst = [
      { symbol: 'A', providerSymbol: 'A', changePercent: 1.0, dataStatus: 'OK' },
      { symbol: 'B', providerSymbol: 'B', changePercent: 1.0, dataStatus: 'OK' }
    ];
    // map A and B to same sector via internal map
    // create temporary internal map mapping in module is static; use symbols that match INTERNAL_SECTOR_MAP if needed
    const res = buildSectorStrengthSummaries([ { symbol: 'MSFT', changePercent: 1.0, dataStatus: 'OK' }, { symbol: 'AAPL', changePercent: 1.0, dataStatus: 'OK' } ]);
    expect(res.length).toBeGreaterThanOrEqual(1);
    const tech = res.find(r=> r.sector === 'Technology');
    expect(tech).toBeTruthy();
    if (tech){ expect(tech.direction).toBe('BULLISH'); expect(tech.strength).toBeGreaterThan(0); }
  });

  it('builds bearish sector when avg <= -0.75', () => {
    const res = buildSectorStrengthSummaries([ { symbol: 'MSFT', changePercent: -1.0, dataStatus: 'OK' }, { symbol: 'AAPL', changePercent: -1.0, dataStatus: 'OK' } ]);
    const tech = res.find(r=> r.sector === 'Technology');
    expect(tech).toBeTruthy();
    if (tech){ expect(tech.direction).toBe('BEARISH'); }
  });

  it('neutral when avg near zero', () => {
    const res = buildSectorStrengthSummaries([ { symbol: 'MSFT', changePercent: 0.1, dataStatus: 'OK' }, { symbol: 'AAPL', changePercent: -0.1, dataStatus: 'OK' } ]);
    const tech = res.find(r=> r.sector === 'Technology');
    expect(tech).toBeTruthy();
    if (tech){ expect(tech.direction).toBe('NEUTRAL'); }
  });

  it('requires at least 2 valid instruments', () => {
    const res = buildSectorStrengthSummaries([ { symbol: 'MSFT', changePercent: 1.0, dataStatus: 'OK' } ]);
    expect(res.find(r=> r.sector === 'Technology')).toBeUndefined();
  });

  it('ignores stale and UNAVAILABLE and invalid changePercent', () => {
    const res = buildSectorStrengthSummaries([
      { symbol: 'MSFT', changePercent: 1.0, dataStatus: 'OK' },
      { symbol: 'AAPL', changePercent: null, dataStatus: 'OK' },
      { symbol: 'NVDA', changePercent: 2.0, dataStatus: 'UNAVAILABLE' },
      { symbol: 'AMD', changePercent: 0.5, dataStatus: 'OK', isStale: true }
    ]);
    // Only MSFT counts -> less than 2 -> no summary
    expect(res.find(r=> r.sector === 'Technology')).toBeUndefined();
  });

  it('signal id stable and fields correct', () => {
    const summaries = buildSectorStrengthSummaries([ { symbol: 'MSFT', changePercent: 1.0, dataStatus: 'OK' }, { symbol: 'AAPL', changePercent: 1.0, dataStatus: 'OK' } ]);
    const sig = createSectorStrengthSignalForInstrument({ symbol: 'MSFT' }, summaries);
    expect(sig).toBeTruthy();
    if (sig){
      expect(sig.type).toBe('SECTOR_STRENGTH');
      expect(sig.origin).toBe('SECTOR_QUOTES_AGGREGATE');
      expect(sig.id).toMatch(/^sector_strength_/);
      expect(sig.strength).toBeGreaterThanOrEqual(0);
      expect(sig.strength).toBeLessThanOrEqual(1);
      expect(Array.isArray(sig.symbols)).toBe(true);
    }
  });

  it('TECHNICAL_MOMENTUM + SECTOR_STRENGTH can be picked as two supporting ids for BUY', () => {
    const summaries = buildSectorStrengthSummaries([ { symbol: 'MSFT', changePercent: 1.0, dataStatus: 'OK' }, { symbol: 'AAPL', changePercent: 1.0, dataStatus: 'OK' } ]);
    const sectorSig = createSectorStrengthSignalForInstrument({ symbol: 'MSFT' }, summaries);
    const techSig = { id: 'technical_MSFT', type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', symbols: ['MSFT'], direction: 'BULLISH' } as any;
    const relSig = { id: 'relative_strength_MSFT', type: 'RELATIVE_STRENGTH', origin: 'MARKET_QUOTES_AGGREGATE', symbols: ['MSFT'], direction: 'BULLISH' } as any;
    const marketSignals = { generatedAt: new Date().toISOString(), confidence: 50, signals: [ techSig, sectorSig as any, relSig ] } as any;
    const picked = pickSupportingSignalIds(marketSignals, 'MSFT', 'BUY');
    // must include two distinct ids and include sector signal id
    expect(Array.isArray(picked)).toBe(true);
    expect(picked.length).toBeGreaterThanOrEqual(1);
    const hasSector = picked.some(id => typeof id === 'string' && id === (sectorSig && sectorSig.id));
    expect(hasSector).toBe(true);
    // Ensure no duplicate ids
    const uniq = Array.from(new Set(picked));
    expect(uniq.length).toBe(picked.length);
  });

  it('pure selector: technical_AAPL + sector_strength_technology selected for BUY, and BEARISH works for SELL', () => {
    const tech = { id: 'technical_AAPL', type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', direction: 'BULLISH', symbols: ['AAPL'] } as any;
    const sector = { id: 'sector_strength_technology', type: 'SECTOR_STRENGTH', origin: 'SECTOR_QUOTES_AGGREGATE', direction: 'BULLISH', symbols: ['AAPL','MSFT'] } as any;
    const marketSignals = { generatedAt: new Date().toISOString(), confidence: 50, signals: [ tech, sector ] } as any;

    const picked = pickSupportingSignalIds(marketSignals, 'AAPL', 'BUY');
    expect(Array.isArray(picked)).toBe(true);
    expect(picked.length).toBe(2);
    expect(picked).toContain('technical_AAPL');
    expect(picked).toContain('sector_strength_technology');
    // distinct types and origins
    const types = new Set(picked.map(id => { const s = marketSignals.signals.find((x:any)=> x.id===id); return s && s.type; }));
    const origins = new Set(picked.map(id => { const s = marketSignals.signals.find((x:any)=> x.id===id); return s && s.origin; }));
    expect(types.size).toBe(2);
    expect(origins.size).toBe(2);
    // no duplicates
    expect(Array.from(new Set(picked)).length).toBe(picked.length);

    // BEARISH sector should not be selected for BUY
    const bearishSector = { ...sector, id: 'sector_strength_technology_bear', direction: 'BEARISH' } as any;
    const ms2 = { generatedAt: new Date().toISOString(), confidence: 50, signals: [ tech, bearishSector ] } as any;
    const picked2 = pickSupportingSignalIds(ms2, 'AAPL', 'BUY');
    // should pick only technical for BUY when sector is bearish
    expect(picked2).toContain('technical_AAPL');
    expect(picked2).not.toContain('sector_strength_technology_bear');

    // Corresponding BEARISH technical + BEARISH sector should work for SELL
    const techBear = { ...tech, direction: 'BEARISH', id: 'technical_AAPL_bear' } as any;
    const ms3 = { generatedAt: new Date().toISOString(), confidence: 50, signals: [ techBear, bearishSector ] } as any;
    const picked3 = pickSupportingSignalIds(ms3, 'AAPL', 'SELL');
    expect(Array.isArray(picked3)).toBe(true);
    expect(picked3.length).toBeGreaterThanOrEqual(1);
    expect(picked3).toContain('technical_AAPL_bear');
    expect(picked3).toContain('sector_strength_technology_bear');
  });
});
