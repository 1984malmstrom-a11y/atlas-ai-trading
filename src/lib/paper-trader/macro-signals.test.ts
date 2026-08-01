import { describe, it, expect } from 'vitest';
import { buildMacroSnapshotFromInstruments, buildMacroSignals } from './macro-signals';

describe('macro-signals snapshot builder', () => {
  it('fills GOLD from registered XAU/USD and preserves generatedAt', () => {
    const gen = new Date().toISOString();
    const instruments = [{ symbol: 'XAU/USD', providerSymbol: 'XAU/USD', price: 3200, dataStatus: 'READY', isStale: false, marketTimestamp: gen }];
    const snap = buildMacroSnapshotFromInstruments(instruments, gen);
    expect(snap.generatedAt).toBe(gen);
    expect(snap.gold).toBe(3200);
    const signals = buildMacroSignals(snap);
    const gold = signals.find(s => s.id === 'macro_gold');
    expect(gold).toBeTruthy();
    expect(gold!.direction).toBe('NEUTRAL');
    expect(typeof (gold as any).strength).toBe('number');
    expect((gold as any).strength).toBeCloseTo(0.4);
    expect((gold as any).evidence && (gold as any).evidence.value).toBe(3200);
  });

  it('returns oil undefined when no oil instrument registered', () => {
    const gen = new Date().toISOString();
    const instruments: any[] = [{ symbol: 'XAU/USD', providerSymbol: 'XAU/USD', price: 3200, dataStatus: 'READY', isStale: false, marketTimestamp: gen }];
    const snap = buildMacroSnapshotFromInstruments(instruments, gen);
    expect(snap.oil).toBeUndefined();
    const signals = buildMacroSignals(snap);
    const oil = signals.find(s => s.id === 'macro_oil');
    expect(oil).toBeTruthy();
    expect(oil!.direction).toBe('NEUTRAL');
    expect((oil as any).strength).toBeCloseTo(0.4);
  });

  it('ignores stale instruments for GOLD', () => {
    const gen = new Date().toISOString();
    const instruments = [{ symbol: 'XAU/USD', providerSymbol: 'XAU/USD', price: 3200, dataStatus: 'READY', isStale: true, marketTimestamp: gen }];
    const snap = buildMacroSnapshotFromInstruments(instruments, gen);
    expect(snap.gold).toBeUndefined();
  });

  it('ignores UNAVAILABLE dataStatus', () => {
    const gen = new Date().toISOString();
    const instruments = [{ symbol: 'XAU/USD', providerSymbol: 'XAU/USD', price: 3200, dataStatus: 'UNAVAILABLE', isStale: false, marketTimestamp: gen }];
    const snap = buildMacroSnapshotFromInstruments(instruments, gen);
    expect(snap.gold).toBeUndefined();
  });

  it('ignores invalid or non-positive prices', () => {
    const gen = new Date().toISOString();
    const instruments = [
      { symbol: 'XAU/USD', providerSymbol: 'XAU/USD', price: 0, dataStatus: 'READY', isStale: false, marketTimestamp: gen },
      { symbol: 'XAU/USD', providerSymbol: 'XAU/USD', price: -10, dataStatus: 'READY', isStale: false, marketTimestamp: gen },
      { symbol: 'XAU/USD', providerSymbol: 'XAU/USD', price: NaN, dataStatus: 'READY', isStale: false, marketTimestamp: gen }
    ];
    for (const inst of instruments){
      const snap = buildMacroSnapshotFromInstruments([inst], gen);
      expect(snap.gold).toBeUndefined();
    }
  });

  it('normalizes symbols case/format when matching GOLD', () => {
    const gen = new Date().toISOString();
    const variants = ['XAU/USD', 'xau_usd', 'XAU USD', 'xAu/usD', 'XAU_USD'];
    for (const v of variants){
      const snap = buildMacroSnapshotFromInstruments([{ symbol: v, providerSymbol: v, price: 3100, dataStatus: 'READY', isStale: false, marketTimestamp: gen }], gen);
      expect(snap.gold).toBe(3100);
    }
  });

  it('VIX/DXY/US10Y remain neutral when absent', () => {
    const gen = new Date().toISOString();
    const snap = buildMacroSnapshotFromInstruments([], gen);
    const signals = buildMacroSignals(snap);
    const vix = signals.find(s => s.id === 'macro_vix');
    const dxy = signals.find(s => s.id === 'macro_dxy');
    const us10y = signals.find(s => s.id === 'macro_us10y');
    expect(vix).toBeTruthy(); expect(vix!.direction).toBe('NEUTRAL');
    expect(dxy).toBeTruthy(); expect(dxy!.direction).toBe('NEUTRAL');
    expect(us10y).toBeTruthy(); expect(us10y!.direction).toBe('NEUTRAL');
  });
});
