import { describe, it, expect } from 'vitest';
import { createTradeFeedback, type TradeFeedback } from './trade-feedback';

describe('createTradeFeedback', () => {
  it('STRONG_WIN vid 10 %', () => {
    const f = createTradeFeedback({ executionId: 'e1', pnlSek: 1000, pnlPercent: 10, winner: true });
    expect(f.verdict).toBe('STRONG_WIN');
    expect(f.summary).toBe('Stark vinst');
  });

  it('WIN över 0 men under 10 %', () => {
    const f = createTradeFeedback({ executionId: 'e2', pnlSek: 50, pnlPercent: 5, winner: true });
    expect(f.verdict).toBe('WIN');
    expect(f.summary).toBe('Vinst');
  });

  it('BREAK_EVEN vid exakt 0 %', () => {
    const f = createTradeFeedback({ executionId: 'e3', pnlSek: 0, pnlPercent: 0, winner: false });
    expect(f.verdict).toBe('BREAK_EVEN');
    expect(f.summary).toBe('Nollresultat');
  });

  it('LOSS under 0 men över -10 %', () => {
    const f = createTradeFeedback({ executionId: 'e4', pnlSek: -5, pnlPercent: -5, winner: false });
    expect(f.verdict).toBe('LOSS');
    expect(f.summary).toBe('Förlust');
  });

  it('LARGE_LOSS vid -10 %', () => {
    const f = createTradeFeedback({ executionId: 'e5', pnlSek: -1000, pnlPercent: -10, winner: false });
    expect(f.verdict).toBe('LARGE_LOSS');
    expect(f.summary).toBe('Stor förlust');
  });

  it('objektet är immutable', () => {
    const f = createTradeFeedback({ executionId: 'e6', pnlSek: 1, pnlPercent: 1, winner: true }) as unknown as TradeFeedback;
    expect(Object.isFrozen(f)).toBe(true);
    try { (f as unknown as Record<string, unknown>).verdict = 'LOSS'; } catch (e) {}
    expect(f.verdict).toBe('WIN');
  });

  it('tom executionId kastar', () => {
    expect(() => createTradeFeedback({ executionId: ' ', pnlSek: 0, pnlPercent: 0, winner: false })).toThrow();
  });

  it('NaN/Infinity i pnl-fält kastar', () => {
    // NaN
    expect(() => createTradeFeedback({ executionId: 'e8', pnlSek: NaN, pnlPercent: 0, winner: false })).toThrow();
    expect(() => createTradeFeedback({ executionId: 'e8', pnlSek: 0, pnlPercent: NaN, winner: false })).toThrow();
    // Infinity
    expect(() => createTradeFeedback({ executionId: 'e8', pnlSek: Infinity, pnlPercent: 0, winner: false })).toThrow();
    expect(() => createTradeFeedback({ executionId: 'e8', pnlSek: 0, pnlPercent: Infinity, winner: false })).toThrow();
  });
});
