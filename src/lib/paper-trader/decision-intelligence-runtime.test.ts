import { describe, it, expect } from 'vitest';
import { createPerCycleDecisionIntelligenceResolver, buildDecisionIntelligenceSnapshot, buildConfluenceReasoning } from './signal-confluence';

describe('Decision Intelligence Resolver', ()=>{
  it('builds snapshot once and finalizes with selected ids without recomputing', async ()=>{
    const appended: any[] = [];
    const buildSummary = async (sym: string, marketSignals?: any) => {
      // simple synthetic summary with signals
      return { symbol: sym, generatedAt: new Date().toISOString(), direction: 'BULLISH', bullishScore: 1, bearishScore: 0, neutralCount: 0, bullishSignalCount: 1, bearishSignalCount: 0, usableSignalCount: 1, placeholderCount: 0, distinctTypes: 1, distinctOrigins: 1, hasIndependentBullishSupport: false, hasIndependentBearishSupport: false, hasConflict: false, strongestBullish: { id: 's1', type: 'T', origin: 'O', direction: 'BULLISH', strength: 1, isPlaceholder: false }, strongestBearish: undefined, bullishSignals: [{ id:'s1', type:'T', origin:'O', direction:'BULLISH', strength:1, isPlaceholder:false }], bearishSignals: [], neutralSignals: [], warnings: [] } as any;
    };
    const resolver = createPerCycleDecisionIntelligenceResolver({ cycleId: 'c1', buildSummary: buildSummary as any, appendAudit: async (p:any)=> { appended.push(p); } });
    const a = await resolver.resolveAnalysis({ symbol: 'X' });
    expect(a).toBeTruthy();
    const a2 = await resolver.resolveAnalysis({ symbol: 'x' });
    // same object reference
    expect(a2).toBe(a);
    // finalize with selected ids
    const final = await resolver.finalizeSnapshot({ symbol: 'X', selectedSupportingSignalIds: ['s1'] });
    expect(final!.selectedSupportingSignals.length).toBe(1);
    // audit appended once
    expect(appended.length).toBe(1);
    // second finalize does not double append
    await resolver.finalizeSnapshot({ symbol: 'X', selectedSupportingSignalIds: ['s1'] });
    expect(appended.length).toBe(1);
  });

  it('handles missing summary gracefully and produces NEUTRAL/INSUFFICIENT', async ()=>{
    const appended: any[] = [];
    const buildSummary = async (sym:string) => null;
    const resolver = createPerCycleDecisionIntelligenceResolver({ cycleId: 'c2', buildSummary: buildSummary as any, appendAudit: async (p:any)=> { appended.push(p); } });
    const a = await resolver.resolveAnalysis({ symbol: 'Y' });
    expect(a!.direction).toBe('NEUTRAL');
    const final = await resolver.finalizeSnapshot({ symbol: 'Y', selectedSupportingSignalIds: [] });
    expect(final!.analysisQuality.level).toBeDefined();
    expect(appended.length).toBe(1);
  });
});
