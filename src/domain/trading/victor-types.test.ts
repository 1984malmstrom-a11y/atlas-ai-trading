import { describe, it, expect } from 'vitest';
import { DEFAULT_PAPER_AUTO_MANDATE } from './victor-types';

describe('victor types defaults', ()=>{
  it('default maxPositionPercent is decimal fraction (0.10)', ()=>{
    expect(typeof DEFAULT_PAPER_AUTO_MANDATE.maxPositionPercent).toBe('number');
    // allow tiny float rounding
    expect(DEFAULT_PAPER_AUTO_MANDATE.maxPositionPercent).toBeCloseTo(0.10, 6);
  });
});
