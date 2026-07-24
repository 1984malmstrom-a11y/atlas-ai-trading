import { describe, it, expect } from 'vitest';
import { analyzeFundamentals } from './fundamental';

describe('fundamental analyzer (mock)', ()=>{
  it('BUY when score >= 75', ()=>{
    const out = analyzeFundamentals({ score: 82 });
    expect(out.status).toBe('success');
    expect(out.score).toBe(82);
    expect(out.signal).toBe('BUY');
    expect(Array.isArray(out.reasons)).toBeTruthy();
    expect(out.reasons.length).toBeGreaterThanOrEqual(2);
    expect(out.reasons[0]).toBe('Strong earnings');
  });

  it('HOLD when score between 50 and 74', ()=>{
    const out = analyzeFundamentals({ score: 60 });
    expect(out.status).toBe('success');
    expect(out.score).toBe(60);
    expect(out.signal).toBe('HOLD');
    expect(Array.isArray(out.reasons)).toBeTruthy();
    expect(out.reasons.length).toBeGreaterThanOrEqual(2);
    expect(out.reasons[0]).toBe('Stable earnings');
  });

  it('SELL when score < 50', ()=>{
    const out = analyzeFundamentals({ score: 40 });
    expect(out.status).toBe('success');
    expect(out.score).toBe(40);
    expect(out.signal).toBe('SELL');
    expect(Array.isArray(out.reasons)).toBeTruthy();
    expect(out.reasons.length).toBeGreaterThanOrEqual(2);
    expect(out.reasons[0]).toBe('Weak earnings');
  });

  it('boundary checks and determinism', ()=>{
    // exact boundaries
    const b1 = analyzeFundamentals({ score: 75 });
    expect(b1.signal).toBe('BUY');
    expect(b1.score).toBe(75);

    const b2 = analyzeFundamentals({ score: 74 });
    expect(b2.signal).toBe('HOLD');
    expect(b2.score).toBe(74);

    const b3 = analyzeFundamentals({ score: 50 });
    expect(b3.signal).toBe('HOLD');
    expect(b3.score).toBe(50);

    const b4 = analyzeFundamentals({ score: 49 });
    expect(b4.signal).toBe('SELL');
    expect(b4.score).toBe(49);

    // rounding and clamping
    const r1 = analyzeFundamentals({ score: 75.6 });
    expect(r1.score).toBe(76);
    const r2 = analyzeFundamentals({ score: 150 });
    expect(r2.score).toBe(100);
    const r3 = analyzeFundamentals({ score: -5 });
    expect(r3.score).toBe(0);

    // reasons count and non-empty
    for (const o of [b1,b2,b3,b4,r1,r2,r3]){
      expect(o.status).toBe('success');
      expect(Array.isArray(o.reasons)).toBeTruthy();
      expect(o.reasons.length).toBeGreaterThanOrEqual(2);
      expect(o.reasons.length).toBeLessThanOrEqual(4);
      for (const s of o.reasons) expect(typeof s === 'string' && s.length > 0).toBeTruthy();
    }

    // determinism: same input -> identical output
    const x1 = analyzeFundamentals({ score: 82, symbol: 'MSFT' });
    const x2 = analyzeFundamentals({ score: 82, symbol: 'MSFT' });
    expect(x1).toEqual(x2);
  });
});
