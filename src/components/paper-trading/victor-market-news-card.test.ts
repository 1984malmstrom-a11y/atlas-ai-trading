import { describe, it, expect } from 'vitest';
import { formatConfidenceLabel } from './victor-market-news-card';

describe('victor market news card UI helpers', () => {
  it('maps INSUFFICIENT to Otillräckligt underlag', () => {
    expect(formatConfidenceLabel('INSUFFICIENT', 0)).toBe('Otillräckligt underlag');
    expect(formatConfidenceLabel('INSUFFICIENT', 20)).toBe('Otillräckligt underlag');
  });

  it('maps LIMITED to Begränsad', () => {
    expect(formatConfidenceLabel('LIMITED', 30)).toBe('Begränsad');
  });

  it('shows percent for COMPLETE/high quality when numeric', () => {
    expect(formatConfidenceLabel('COMPLETE', 80)).toBe('80 %');
    expect(formatConfidenceLabel('HIGH', 55)).toBe('55 %');
  });

  it('falls back to percent when quality missing but numeric confidence provided', () => {
    expect(formatConfidenceLabel(null, 0)).toBe('0 %');
    expect(formatConfidenceLabel(undefined, 12)).toBe('12 %');
  });

  it('returns dash when nothing provided', () => {
    expect(formatConfidenceLabel(null, null)).toBe('—');
  });
});
