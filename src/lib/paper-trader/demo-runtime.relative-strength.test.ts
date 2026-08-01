import { describe, it, expect, vi } from 'vitest';
// Mock TwelveData provider so demo-runtime.fetchAndAnalyze produces deterministic technical meta
vi.doMock('../market-data/twelve-data', ()=>({
  TwelveDataMarketDataProvider: class {
    async getHistoricalDailyCloses(_sym: string, _days: number){
      const now = new Date();
      return { closes: Array.from({length:30}, (_,i)=> 100 + i), dates: Array.from({length:30}, ()=> now.toISOString()), source: 'mock' };
    }
  }
}));

import { createTechnicalSignalIfFresh, createRelativeStrengthSignalForInstrument, pickSupportingSignalIds } from './demo-runtime';

describe('relative strength helpers and selection', ()=>{
  it('pickSupportingSignalIds prefers TECHNICAL_MOMENTUM and RELATIVE_STRENGTH when both present', ()=>{
    const targ = { symbol: 'TARG', changePercent: 3.0, dataStatus: 'OK', isStale: false } as any;
    const others = [
      { symbol: 'A', changePercent: 0.5, dataStatus: 'OK', isStale: false },
      { symbol: 'B', changePercent: 0.4, dataStatus: 'OK', isStale: false },
      { symbol: 'C', changePercent: 0.6, dataStatus: 'OK', isStale: false },
      { symbol: 'D', changePercent: 0.3, dataStatus: 'OK', isStale: false },
      { symbol: 'E', changePercent: 0.2, dataStatus: 'OK', isStale: false }
    ];
    const all = [targ, ...others];
    const techMeta = { technicalAnalysisStatus: 'success', historicalDataPoints: 30, technicalSignal: 'BUY', technicalMomentumPercent: 12.3, historicalLastDate: new Date().toISOString(), technicalScore: 75 } as any;
    const tech = createTechnicalSignalIfFresh(techMeta, 'TARG');
    const rel = createRelativeStrengthSignalForInstrument(targ, all);
    expect(tech).toBeTruthy();
    expect(rel).toBeTruthy();
    const ms = { signals: [tech, rel, ...others.map((o:any)=> ({ id: `other_${o.symbol}`, type: 'MARKET_TREND', origin: 'MARKET', symbols: [], evidence: { changePercent: o.changePercent } })) ] } as any;
    const chosen = pickSupportingSignalIds(ms, 'TARG', 'BUY');
    expect(Array.isArray(chosen)).toBeTruthy();
    // Both ids present and distinct
    expect(chosen.length).toBeGreaterThanOrEqual(1);
    expect(chosen.includes(tech.id)).toBeTruthy();
    expect(chosen.includes(rel.id)).toBeTruthy();
  });

  it('createRelativeStrengthSignalForInstrument returns null when near market average', ()=>{
    const targ = { symbol: 'TARG', changePercent: 0.6, dataStatus: 'OK', isStale: false } as any;
    const others = [
      { symbol: 'A', changePercent: 0.5, dataStatus: 'OK', isStale: false },
      { symbol: 'B', changePercent: 0.55, dataStatus: 'OK', isStale: false },
      { symbol: 'C', changePercent: 0.65, dataStatus: 'OK', isStale: false },
      { symbol: 'D', changePercent: 0.6, dataStatus: 'OK', isStale: false },
      { symbol: 'E', changePercent: 0.5, dataStatus: 'OK', isStale: false }
    ];
    const sig = createRelativeStrengthSignalForInstrument(targ, [targ, ...others]);
    expect(sig).toBeNull();
  });
});
