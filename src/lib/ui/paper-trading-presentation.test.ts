import { describe, it, expect } from 'vitest';
import buildPaperTradingPresentation from './paper-trading-presentation';

describe('paper trading presentation', () => {
  it('prefers intelligence maps with 13 symbols and abstains from trade', () => {
    const fakeRuntime = {
      lastAutomaticRunAt: '2026-08-03T12:30:00.000Z',
      lastAutomaticRunStatus: 'success',
      latestCycle: { decisionSummary: { analyzedSymbols: [] } },
      latestMultiTimeframeTechnicalIntelligenceBySymbol: Object.fromEntries(Array.from({length:13}).map((_,i)=>[`SYM${i}`, { generatedAt: '2026-08-03T12:29:00.000Z' }])),
      latestForexSessionIntelligenceBySymbol: Object.fromEntries(Array.from({length:13}).map((_,i)=>[`SYM${i}`, { generatedAt: '2026-08-03T12:29:00.000Z' }])),
      latestDecisionIntelligenceBySymbol: Object.fromEntries(Array.from({length:13}).map((_,i)=>[`SYM${i}`, { generatedAt: '2026-08-03T12:29:00.000Z' }])),
      latestDecision: { symbol: 'NVDA', action: 'HOLD', generatedAt: '2026-08-03T12:00:00.000Z', confidence: 0 },
      tradesToday: 0,
    } as any;

    const p = buildPaperTradingPresentation(fakeRuntime as any);
    expect(p).not.toBeNull();
    expect(p!.analyzedCount).toBe(13);
    expect(p!.displayAction).toBe('Avstår');
    expect(p!.isHistoricalFallback).toBe(false);
    expect(p!.activityTitle).toContain('13');
    expect(p!.analysisQualityLabel === null || typeof p!.analysisQualityLabel === 'string').toBeTruthy();
    expect(p!.executionCount).toBe(0);
    // Ensure NVDA (historical) is not used as current symbol when intelligence maps present
    expect(p!.analyzedSymbols.includes('NVDA')).toBe(false);
  });
});
