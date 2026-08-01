import { describe, it, expect } from 'vitest';
import { checkHistoricalFreshness, createTechnicalSignalIfFresh, createRelativeStrengthSignalForInstrument, pickSupportingSignalIds } from './demo-runtime';

const MAX = 5; // must match demo-runtime's documented max

describe('checkHistoricalFreshness helper', ()=>{
  it('today -> valid age 0', ()=>{
    const now = new Date('2026-07-31T12:00:00.000Z');
    const r = checkHistoricalFreshness('2026-07-31', now, MAX);
    expect(r.valid).toBe(true);
    expect(r.historicalDataAgeDays).toBe(0);
  });

  it('previous day -> valid age 1', ()=>{
    const now = new Date('2026-07-31T12:00:00.000Z');
    const r = checkHistoricalFreshness('2026-07-30', now, MAX);
    expect(r.valid).toBe(true);
    expect(r.historicalDataAgeDays).toBe(1);
  });

  it('friday -> sunday (weekend) -> valid', ()=>{
    const last = '2026-07-31'; // Fri
    const now = new Date('2026-08-02T12:00:00.000Z'); // Sun
    const r = checkHistoricalFreshness(last, now, MAX);
    expect(r.valid).toBe(true);
    expect(r.historicalDataAgeDays).toBe(2);
  });

  it('friday -> monday -> valid', ()=>{
    const last = '2026-07-31'; // Fri
    const now = new Date('2026-08-03T12:00:00.000Z'); // Mon
    const r = checkHistoricalFreshness(last, now, MAX);
    expect(r.valid).toBe(true);
    expect(r.historicalDataAgeDays).toBe(3);
  });

  it('friday -> tuesday after monday holiday -> valid within limit', ()=>{
    const last = '2026-07-31'; // Fri
    const now = new Date('2026-08-04T12:00:00.000Z'); // Tue
    const r = checkHistoricalFreshness(last, now, MAX);
    expect(r.valid).toBe(true);
    expect(r.historicalDataAgeDays).toBe(4);
  });

  it('thursday -> tuesday after long holiday -> valid only when max=5', ()=>{
    const last = '2026-07-30'; // Thu
    const now = new Date('2026-08-04T12:00:00.000Z'); // Tue (age 5)
    const r = checkHistoricalFreshness(last, now, MAX);
    expect(r.valid).toBe(true);
    expect(r.historicalDataAgeDays).toBe(5);
  });

  it('exact maxAgeDays allowed, max+1 blocked', ()=>{
    const now = new Date('2026-08-01T12:00:00.000Z');
    const rOk = checkHistoricalFreshness('2026-07-27', now, 5); // age 5
    expect(rOk.valid).toBe(true);
    const rBad = checkHistoricalFreshness('2026-07-26', now, 5); // age 6
    expect(rBad.valid).toBe(false);
    expect(rBad.reason).toBe('STALE_DATE');
  });

  it('future date -> FUTURE_DATE', ()=>{
    const now = new Date('2026-07-31T12:00:00.000Z');
    const r = checkHistoricalFreshness('2026-08-10', now, MAX);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('FUTURE_DATE');
  });

  it('invalid date -> INVALID_DATE', ()=>{
    const now = new Date('2026-07-31T12:00:00.000Z');
    const r = checkHistoricalFreshness('not-a-date', now, MAX);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('INVALID_DATE');
  });

  it('missing date -> MISSING_DATE', ()=>{
    const now = new Date('2026-07-31T12:00:00.000Z');
    const r = checkHistoricalFreshness(null as any, now, MAX);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('MISSING_DATE');
  });

  it('UTC/timezone independence produces same age', ()=>{
    const last = '2026-07-31';
    const now1 = new Date('2026-08-02T03:00:00.000Z');
    const now2 = new Date('2026-08-02T23:00:00.000Z');
    const r1 = checkHistoricalFreshness(last, now1, MAX);
    const r2 = checkHistoricalFreshness(last, now2, MAX);
    expect(r1.historicalDataAgeDays).toBe(r2.historicalDataAgeDays);
  });
});

describe('createTechnicalSignalIfFresh integration (lightweight)', ()=>{
  it('creates signal when freshness valid and attaches evidence', ()=>{
    const now = new Date('2026-08-02T12:00:00.000Z');
    const techMeta = { technicalAnalysisStatus: 'success', historicalDataPoints: 30, technicalSignal: 'BUY', technicalMomentumPercent: 4.2, technicalScore: 42, historicalLastDate: '2026-08-02' };
    const sig = createTechnicalSignalIfFresh(techMeta, 'MSFT', now, MAX);
    expect(sig).toBeTruthy();
    expect(sig.evidence.historicalLastDate).toBe('2026-08-02');
    expect(typeof sig.evidence.historicalDataAgeDays).toBe('number');
  });

  it('does not create signal when freshness invalid', ()=>{
    const now = new Date('2026-07-31T12:00:00.000Z');
    const techMeta = { technicalAnalysisStatus: 'success', historicalDataPoints: 30, technicalSignal: 'BUY', technicalMomentumPercent: 4.2, technicalScore: 42, historicalLastDate: '2026-07-20' };
    const sig = createTechnicalSignalIfFresh(techMeta, 'MSFT', now, MAX);
    expect(sig).toBeNull();
  });
});

describe('createRelativeStrengthSignalForInstrument', ()=>{
  it('creates BULLISH when symbol clearly stronger than market avg', ()=>{
    const now = new Date('2026-08-02T12:00:00.000Z');
    const instruments = [
      { symbol: 'MSFT', changePercent: 3.0, dataStatus: 'READY', isStale: false },
      { symbol: 'AAPL', changePercent: 0.5, dataStatus: 'READY', isStale: false },
      { symbol: 'NVDA', changePercent: 0.8, dataStatus: 'READY', isStale: false },
      { symbol: 'GOOGL', changePercent: 0.6, dataStatus: 'READY', isStale: false },
      { symbol: 'AMZN', changePercent: 0.4, dataStatus: 'READY', isStale: false },
      { symbol: 'TSLA', changePercent: 0.3, dataStatus: 'READY', isStale: false }
    ];
    const sig = createRelativeStrengthSignalForInstrument(instruments[0], instruments, now, { minComparables: 4, minDiffPercent: 0.7 });
    expect(sig).toBeTruthy();
    expect(sig.id).toBe('relative_strength_MSFT');
    expect(sig.type).toBe('RELATIVE_STRENGTH');
    expect(sig.origin).toBe('MARKET_QUOTES_AGGREGATE');
    expect(sig.direction).toBe('BULLISH');
  });

  it('creates BEARISH when symbol clearly weaker than market avg', ()=>{
    const now = new Date('2026-08-02T12:00:00.000Z');
    const instruments = [
      { symbol: 'WEAK', changePercent: -2.5, dataStatus: 'READY', isStale: false },
      { symbol: 'A', changePercent: 0.5, dataStatus: 'READY', isStale: false },
      { symbol: 'B', changePercent: 0.8, dataStatus: 'READY', isStale: false },
      { symbol: 'C', changePercent: 0.6, dataStatus: 'READY', isStale: false },
      { symbol: 'D', changePercent: 0.4, dataStatus: 'READY', isStale: false }
    ];
    const sig = createRelativeStrengthSignalForInstrument(instruments[0], instruments, now, { minComparables: 3, minDiffPercent: 0.7 });
    expect(sig).toBeTruthy();
    expect(sig.direction).toBe('BEARISH');
  });

  it('does not create when near average', ()=>{
    const now = new Date('2026-08-02T12:00:00.000Z');
    const instruments = [
      { symbol: 'MID', changePercent: 0.6, dataStatus: 'READY', isStale: false },
      { symbol: 'A', changePercent: 0.5, dataStatus: 'READY', isStale: false },
      { symbol: 'B', changePercent: 0.55, dataStatus: 'READY', isStale: false },
      { symbol: 'C', changePercent: 0.65, dataStatus: 'READY', isStale: false },
      { symbol: 'D', changePercent: 0.6, dataStatus: 'READY', isStale: false }
    ];
    const sig = createRelativeStrengthSignalForInstrument(instruments[0], instruments, now, { minComparables: 3, minDiffPercent: 0.7 });
    expect(sig).toBeNull();
  });

  it('does not create when data stale or missing', ()=>{
    const now = new Date('2026-08-02T12:00:00.000Z');
    const instruments = [
      { symbol: 'X', changePercent: 1.5, dataStatus: 'READY', isStale: true },
      { symbol: 'A', changePercent: 0.5, dataStatus: 'READY', isStale: false },
      { symbol: 'B', changePercent: 0.6, dataStatus: 'READY', isStale: false },
      { symbol: 'C', changePercent: 0.4, dataStatus: 'READY', isStale: false },
      { symbol: 'D', changePercent: 0.3, dataStatus: 'READY', isStale: false }
    ];
    const sig = createRelativeStrengthSignalForInstrument(instruments[0], instruments, now, { minComparables: 3, minDiffPercent: 0.5 });
    expect(sig).toBeNull();
  });

  it('can be combined with TECHNICAL_MOMENTUM and picked by pickSupportingSignalIds', ()=>{
    const now = new Date('2026-08-02T12:00:00.000Z');
    const rel = { id: 'relative_strength_MSFT', type: 'RELATIVE_STRENGTH', origin: 'MARKET_QUOTES_AGGREGATE', direction: 'BULLISH', symbols: ['MSFT'] };
    const tech = { id: 'technical_MSFT', type: 'TECHNICAL_MOMENTUM', origin: 'SYMBOL_PRICE_SERIES', direction: 'BULLISH', symbols: ['MSFT'] };
    const ms = { generatedAt: now.toISOString(), confidence: 90, signals: [rel, tech] } as any;
    const picked = pickSupportingSignalIds(ms, 'MSFT', 'BUY');
    expect(Array.isArray(picked)).toBe(true);
    expect(picked.length).toBeGreaterThanOrEqual(1);
    // ensure both can be referenced (order not required)
    expect(new Set(picked)).toEqual(new Set(['relative_strength_MSFT','technical_MSFT']));
  });
});
