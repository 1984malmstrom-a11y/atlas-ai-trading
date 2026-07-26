import { describe, it, expect } from 'vitest';
import { createTradeFeedback, summarizeFeedbackBySignal, type SignalFeedbackSummary, type TradeFeedback } from './trade-feedback';

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

  describe('summarizeFeedbackBySignal', ()=>{
    it('en trade med en signal', ()=>{
      const audits = [{ raw: { evaluation: { tradeReview: { executionId: 't1', pnlSek: 100, pnlPercent: 5, winner: true, summary: 'Vinst' } }, decision: { signals: ['SIG_A'] } } }];
      const out = summarizeFeedbackBySignal(audits as unknown as any);
      expect(out.length).toBe(1);
      expect(out[0].signalId).toBe('SIG_A');
      expect(out[0].evaluatedCount).toBe(1);
      expect(out[0].wins).toBe(1);
      expect(out[0].losses).toBe(0);
      expect(out[0].winRate).toBeCloseTo(1);
      expect(out[0].avgPnlSek).toBeCloseTo(100);
    });

    it('en trade med flera signaler', ()=>{
      const audits = [{ raw: { evaluation: { tradeReview: { executionId: 't2', pnlSek: 50, pnlPercent: 3, winner: true } }, decision: { signals: ['S1','S2'] } } }];
      const out = summarizeFeedbackBySignal(audits as unknown as any);
      expect(out.length).toBe(2);
      const ids = out.map(o=>o.signalId).sort();
      expect(ids).toEqual(['S1','S2']);
      for (const o of out){ expect(o.evaluatedCount).toBe(1); expect(o.avgPnlSek).toBeCloseTo(50); }
    });

    it('flera trades med samma signal aggregeras', ()=>{
      const audits = [
        { raw: { evaluation: { tradeReview: { executionId: 'a1', pnlSek: 10, pnlPercent: 1, winner: true } }, decision: { signals: ['X'] } } },
        { raw: { evaluation: { tradeReview: { executionId: 'a2', pnlSek: -5, pnlPercent: -0.5, winner: false } }, decision: { signals: ['X'] } } },
      ];
      const out = summarizeFeedbackBySignal(audits as unknown as any);
      expect(out.length).toBe(1);
      expect(out[0].signalId).toBe('X');
      expect(out[0].evaluatedCount).toBe(2);
      expect(out[0].wins).toBe(1);
      expect(out[0].losses).toBe(1);
      expect(out[0].winRate).toBeCloseTo(0.5);
      expect(out[0].avgPnlSek).toBeCloseTo((10 + -5) / 2);
    });

    it('tomma eller ogiltiga signal ignoreras', ()=>{
      const audits = [{ raw: { evaluation: { tradeReview: { executionId: 't3', pnlSek: 20, pnlPercent: 2, winner: true } }, decision: { signals: ['', null, '  ', 'GOOD'] } } }];
      const out = summarizeFeedbackBySignal(audits as unknown as any);
      expect(out.length).toBe(1);
      expect(out[0].signalId).toBe('GOOD');
    });

    it('deterministisk sortering: flest först, tiebreaker alfabetiskt', ()=>{
      const make = (id:string, pnl:number, winner:boolean, sigs:string[])=> ({ raw: { evaluation: { tradeReview: { executionId: `${id}_${Math.random()}`, pnlSek: pnl, pnlPercent: pnl/10, winner } }, decision: { signals: sigs } } });
      const audits = [
        make('a', 1, true, ['A']),
        make('b', 2, false, ['B']),
        make('c', 3, true, ['A']),
        make('d', 4, false, ['B']),
        make('e', 5, true, ['C']),
      ];
      // Counts: A=2, B=2, C=1 -> A and B tie at 2, alphabetical A before B
      const out = summarizeFeedbackBySignal(audits as unknown as any);
      expect(out[0].signalId).toBe('A');
      expect(out[1].signalId).toBe('B');
      expect(out[2].signalId).toBe('C');
    });
  });

  it('createTradeFeedback inkluderar bySignal när audits skickas in', ()=>{
    const audits = [{ raw: { evaluation: { tradeReview: { executionId: 't1', pnlSek: 100, pnlPercent: 5, winner: true } }, decision: { signals: ['SIG_A'] } } }];
    const f = createTradeFeedback({ executionId: 'x', pnlSek: 0, pnlPercent: 0, winner: false, audits });
    expect(Array.isArray((f as any).bySignal)).toBe(true);
    const bs = (f as any).bySignal as SignalFeedbackSummary[];
    expect(bs.length).toBe(1);
    expect(bs[0].signalId).toBe('SIG_A');
  });

  it('skriver endast från raw.decision.signals och använder inga fallback-fält', ()=>{
    const audits = [{ raw: { evaluation: { tradeReview: { executionId: 'tX', pnlSek: 20, pnlPercent: 2, winner: true } }, meta: { technicalAnalysis: { technicalSignal: 'META_SIG' } } } }];
    const out = summarizeFeedbackBySignal(audits as any);
    // meta-level signal must be ignored; no decision.signals present -> empty
    expect(out.length).toBe(0);
  });
});
