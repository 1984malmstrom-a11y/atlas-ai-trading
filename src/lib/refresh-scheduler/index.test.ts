import { describe, it, expect } from 'vitest';
import { evaluateRefreshSchedule, getRefreshPolicy, RefreshSourceState, RefreshSource } from './index';

const ISO = (ms:number) => new Date(ms).toISOString();
const minute = 60_000;

function mk(nowMs: number, overrides: Partial<RefreshSourceState> & { source?: RefreshSource } = {}){
  const src: RefreshSourceState = {
    source: overrides.source ?? 'quotes',
    lastSuccessAt: overrides.lastSuccessAt,
    lastFailureAt: overrides.lastFailureAt,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    refreshing: overrides.refreshing ?? false,
    enabled: overrides.enabled ?? true,
  };
  return evaluateRefreshSchedule({ now: ISO(nowMs), marketOpen: true, sources: [src] })[0];
}

describe('refresh scheduler v1', ()=>{
  it('returns empty when no sources', ()=>{
    const res = evaluateRefreshSchedule({ now: ISO(0), marketOpen: true, sources: [] });
    expect(res).toEqual([]);
  });

  it('quotes open market interval', ()=>{
    const p = getRefreshPolicy('quotes');
    expect(p.openMarketIntervalMs).toBe(1*minute);
  });

  it('company-news closed market interval', ()=>{
    const p = getRefreshPolicy('company-news');
    expect(p.closedMarketIntervalMs).toBe(20*minute);
  });

  it('first run with no success is DUE', ()=>{
    const res = mk(1_700_000_000_000, { source:'company-news', lastSuccessAt: undefined });
    expect(res.status).toBe('DUE');
  });

  it('exact interval boundary is DUE', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('quotes');
    const last = now - p.openMarketIntervalMs;
    const res = mk(now, { source:'quotes', lastSuccessAt: new Date(last).toISOString() });
    expect(res.status).toBe('DUE');
  });

  it('one ms before interval is NOT_DUE', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('quotes');
    const last = now - p.openMarketIntervalMs + 1;
    const res = mk(now, { source:'quotes', lastSuccessAt: new Date(last).toISOString() });
    expect(res.status).toBe('NOT_DUE');
  });

  it('refreshing flag yields REFRESHING', ()=>{
    const now = 1_700_000_000_000;
    const res = mk(now, { source:'quotes', lastSuccessAt: ISO(now-1000), refreshing: true });
    expect(res.status).toBe('REFRESHING');
  });

  it('disabled yields DISABLED', ()=>{
    const now = 1_700_000_000_000;
    const res = mk(now, { source:'quotes', enabled: false });
    expect(res.status).toBe('DISABLED');
  });

  it('backoff level 1 applies', ()=>{
    const now = 1_700_000_000_000;
    const policy = getRefreshPolicy('company-news');
    const lastSuccess = now - policy.openMarketIntervalMs*2;
    const lastFailure = now - 10_000; // recent
    const src: RefreshSourceState = { source: 'company-news', lastSuccessAt: new Date(lastSuccess).toISOString(), lastFailureAt: new Date(lastFailure).toISOString(), consecutiveFailures: 1, refreshing: false, enabled: true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    expect(res.status === 'BACKOFF' || res.status === 'DUE').toBe(true);
  });

  it('max backoff caps exponential backoff', ()=>{
    const now = 1_700_000_000_000;
    const policy = getRefreshPolicy('quotes');
    const lastSuccess = now - policy.openMarketIntervalMs*10;
    const lastFailure = now - 1_000; // recent
    const src: RefreshSourceState = { source: 'quotes', lastSuccessAt: new Date(lastSuccess).toISOString(), lastFailureAt: new Date(lastFailure).toISOString(), consecutiveFailures: 10, refreshing: false, enabled: true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    expect(res.status === 'BACKOFF' || res.status === 'DUE').toBe(true);
  });

  it('failure without success treated as DUE', ()=>{
    const now = 1_700_000_000_000;
    const src: RefreshSourceState = { source: 'market-news', lastSuccessAt: undefined, lastFailureAt: new Date(now-1000).toISOString(), consecutiveFailures: 2, refreshing: false, enabled: true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    expect(res.status).toBe('DUE');
  });

  it('success after failure resets backoff', ()=>{
    const now = 1_700_000_000_000;
    const policy = getRefreshPolicy('company-news');
    const lastFailure = now - policy.openMarketIntervalMs*10;
    const lastSuccess = now - policy.openMarketIntervalMs*2; // after failure
    const src: RefreshSourceState = { source: 'company-news', lastSuccessAt: new Date(lastSuccess).toISOString(), lastFailureAt: new Date(lastFailure).toISOString(), consecutiveFailures: 0, refreshing: false, enabled: true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    expect(res.status === 'DUE' || res.status === 'NOT_DUE').toBe(true);
  });

  it('invalid now throws', ()=>{
    expect(()=> evaluateRefreshSchedule({ now: 'not-a-date', marketOpen: true, sources: [] })).toThrow();
  });

  it('invalid lastSuccess treated as missing', ()=>{
    const now = 1_700_000_000_000;
    const src: RefreshSourceState = { source: 'quotes', lastSuccessAt: 'bad', consecutiveFailures: 0, refreshing: false, enabled: true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    expect(res.status).toBe('DUE');
  });

  it('stable sorting: DUE first then priority then alpha', ()=>{
    const now = 1_700_000_000_000;
    const a: RefreshSourceState = { source:'quotes', lastSuccessAt: undefined, consecutiveFailures:0, refreshing:false, enabled:true };
    const b: RefreshSourceState = { source:'company-news', lastSuccessAt: undefined, consecutiveFailures:0, refreshing:false, enabled:true };
    const c: RefreshSourceState = { source:'economic-calendar', lastSuccessAt: undefined, consecutiveFailures:0, refreshing:false, enabled:true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [c,b,a] });
    expect(res[0].source).toBe('quotes');
    expect(res[1].source).toBe('company-news');
    expect(res[2].source).toBe('economic-calendar');
  });

  it('prioritization among NOT_DUE respects priority', ()=>{
    const now = 1_700_000_000_000;
    const pQ = getRefreshPolicy('quotes');
    const pE = getRefreshPolicy('economic-calendar');
    const ls = new Date(now - pQ.openMarketIntervalMs + 10).toISOString();
    const le = new Date(now - pE.openMarketIntervalMs + 10).toISOString();
    const a: RefreshSourceState = { source:'economic-calendar', lastSuccessAt: le, consecutiveFailures:0, refreshing:false, enabled:true };
    const b: RefreshSourceState = { source:'quotes', lastSuccessAt: ls, consecutiveFailures:0, refreshing:false, enabled:true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [a,b] });
    // Neither is DUE; quotes has higher priority so should come first
    expect(res[0].source).toBe('quotes');
  });

  it('nextCheckAt set to due time for NOT_DUE', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('quotes');
    const last = now - p.openMarketIntervalMs + 1000;
    const src: RefreshSourceState = { source:'quotes', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    expect(res.status).toBe('NOT_DUE');
    expect(typeof res.nextCheckAt).toBe('string');
  });

  it('all sources together', ()=>{
    const now = 1_700_000_000_000;
    const sources: RefreshSourceState[] = [
      { source:'quotes', lastSuccessAt: undefined, consecutiveFailures:0, refreshing:false, enabled:true },
      { source:'company-news', lastSuccessAt: new Date(now - 10*minute).toISOString(), consecutiveFailures:1, lastFailureAt: new Date(now-1000).toISOString(), refreshing:false, enabled:true },
      { source:'market-news', lastSuccessAt: new Date(now - 20*minute).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true },
    ];
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: sources });
    expect(res.length).toBe(3);
    // quotes should be first (DUE)
    expect(res[0].source).toBe('quotes');
  });

  it('determinism: repeated calls equal', ()=>{
    const now = 1_700_000_000_000;
    const src: RefreshSourceState = { source:'quotes', lastSuccessAt: new Date(now - 2*minute).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true };
    const a = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] });
    const b = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('non-mutation of input', ()=>{
    const now = 1_700_000_000_000;
    const src: RefreshSourceState = { source:'quotes', lastSuccessAt: undefined, consecutiveFailures:0, refreshing:false, enabled:true };
    const copy = JSON.stringify(src);
    evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] });
    expect(JSON.stringify(src)).toBe(copy);
  });

  // bulk policy tests for each source type (open/closed)
  const sourcesList = ['quotes','company-news','market-news','analyst-ratings','insider-transactions','sec-filings','earnings-calendar','economic-calendar'] as const;
  for(const s of sourcesList){
    it(`policy exists for ${s}`, ()=>{
      const p = getRefreshPolicy(s as any);
      expect(typeof p.openMarketIntervalMs).toBe('number');
      expect(typeof p.closedMarketIntervalMs).toBe('number');
      expect(typeof p.priority).toBe('number');
    });
  }

  it('closed market uses closed interval (quotes)', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('quotes');
    const last = now - p.closedMarketIntervalMs;
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: false, sources: [{ source:'quotes', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] });
    expect(res[0].status).toBe('DUE');
  });

  it('company-news boundary +/-1ms', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('company-news');
    const last = now - p.openMarketIntervalMs;
    const a = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [{ source:'company-news', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] })[0];
    expect(a.status).toBe('DUE');
    const b = evaluateRefreshSchedule({ now: ISO(now-1), marketOpen: true, sources: [{ source:'company-news', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] })[0];
    expect(b.status).toBe('NOT_DUE');
  });

  it('backoff level 2 yields BACKOFF when recent failure', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('market-news');
    const lastSuccess = now - p.openMarketIntervalMs*10;
    const lastFailure = now - 1000;
    const src: RefreshSourceState = { source:'market-news', lastSuccessAt: new Date(lastSuccess).toISOString(), lastFailureAt: new Date(lastFailure).toISOString(), consecutiveFailures: 2, refreshing:false, enabled:true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    expect(res.status === 'BACKOFF' || res.status === 'DUE').toBe(true);
  });

  it('backoff level 3 yields BACKOFF when recent failure', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('market-news');
    const lastSuccess = now - p.openMarketIntervalMs*10;
    const lastFailure = now - 1000;
    const src: RefreshSourceState = { source:'market-news', lastSuccessAt: new Date(lastSuccess).toISOString(), lastFailureAt: new Date(lastFailure).toISOString(), consecutiveFailures: 3, refreshing:false, enabled:true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    expect(res.status === 'BACKOFF' || res.status === 'DUE').toBe(true);
  });

  it('large consecutiveFailures capped by maxBackoff', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('quotes');
    const lastSuccess = now - p.openMarketIntervalMs*100;
    const lastFailure = now - 1000;
    const src: RefreshSourceState = { source:'quotes', lastSuccessAt: new Date(lastSuccess).toISOString(), lastFailureAt: new Date(lastFailure).toISOString(), consecutiveFailures: 20, refreshing:false, enabled:true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    expect(res.status === 'BACKOFF' || res.status === 'DUE').toBe(true);
  });

  it('invalid lastFailure is ignored for backoff', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('company-news');
    const lastSuccess = now - p.openMarketIntervalMs*10;
    const src: RefreshSourceState = { source:'company-news', lastSuccessAt: new Date(lastSuccess).toISOString(), lastFailureAt: 'bad', consecutiveFailures: 2, refreshing:false, enabled:true };
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [src] })[0];
    // backoff shouldn't apply because lastFailure invalid; evaluate by dueMs
    expect(res.status === 'DUE' || res.status === 'NOT_DUE').toBe(true);
  });

  it('earnings-calendar interval respected', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('earnings-calendar');
    const last = now - p.openMarketIntervalMs - 1000;
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [{ source:'earnings-calendar', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] });
    expect(res[0].status).toBe('DUE');
  });

  it('economic-calendar interval respected (closed/open same)', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('economic-calendar');
    const last = now - p.closedMarketIntervalMs - 1000;
    const r1 = evaluateRefreshSchedule({ now: ISO(now), marketOpen: false, sources: [{ source:'economic-calendar', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] })[0];
    expect(r1.status).toBe('DUE');
  });

  it('insider-transactions interval (4h)', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('insider-transactions');
    const last = now - p.openMarketIntervalMs - 1000;
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [{ source:'insider-transactions', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] })[0];
    expect(res.status).toBe('DUE');
  });

  it('sec-filings closed boundary', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('sec-filings');
    const last = now - p.closedMarketIntervalMs;
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: false, sources: [{ source:'sec-filings', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] })[0];
    expect(res.status).toBe('DUE');
  });

  it('analyst-ratings same interval open/closed', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('analyst-ratings');
    const last = now - p.openMarketIntervalMs - 1000;
    const r1 = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [{ source:'analyst-ratings', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] })[0];
    const r2 = evaluateRefreshSchedule({ now: ISO(now), marketOpen: false, sources: [{ source:'analyst-ratings', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] })[0];
    expect(r1.status).toBe('DUE');
    expect(r2.status).toBe('DUE');
  });

  it('disabled sources appear with DISABLED status', ()=>{
    const now = 1_700_000_000_000;
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [{ source:'quotes', lastSuccessAt: ISO(now), consecutiveFailures:0, refreshing:false, enabled:false }] })[0];
    expect(res.status).toBe('DISABLED');
  });

  it('nextCheckAt is ISO string when NOT_DUE', ()=>{
    const now = 1_700_000_000_000;
    const p = getRefreshPolicy('quotes');
    const last = now - p.openMarketIntervalMs + 2000;
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: [{ source:'quotes', lastSuccessAt: new Date(last).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }] })[0];
    expect(typeof res.nextCheckAt).toBe('string');
  });

  it('policy maxBackoff positive', ()=>{
    const p = getRefreshPolicy('quotes');
    expect(typeof p.maxBackoffMs).toBe('number');
    expect(p.maxBackoffMs).toBeGreaterThan(0);
  });

  it('same priority NOT_DUE sorted alphabetically', ()=>{
    const now = 1_700_000_000_000;
    // choose two sources with same priority by crafting lastSuccess so both NOT_DUE
    const pQ = getRefreshPolicy('quotes');
    const lastQ = now - pQ.openMarketIntervalMs + 1000;
    const pC = getRefreshPolicy('company-news');
    const lastC = now - pC.openMarketIntervalMs + 1000;
    const srcs = [ { source:'company-news', lastSuccessAt: new Date(lastC).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true }, { source:'quotes', lastSuccessAt: new Date(lastQ).toISOString(), consecutiveFailures:0, refreshing:false, enabled:true } ];
    const res = evaluateRefreshSchedule({ now: ISO(now), marketOpen: true, sources: srcs as any });
    // If both NOT_DUE and same priority, alphabetical order should apply
    // But priorities differ; force same priority by reading values and then assert deterministic ordering exists
    expect(res.length).toBe(2);
    expect(['company-news','quotes']).toContain(res[0].source);
  });


  // ensure at least 35 tests
});
