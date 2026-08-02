import { expect, it } from 'vitest';
import { buildHistoricalMarketContext, buildHistoricalContextAuditPayload, sanitizeContextForState } from './historical-market-context';

it('builds context once per symbol per cycle and isolates failures', async ()=>{
  const providerCalls: Record<string, number> = {};
  async function fakeGetHistorical(sym: string){
    providerCalls[sym] = (providerCalls[sym] || 0) + 1;
    if (sym === 'BAD') throw new Error('provider failed');
    const closes = Array.from({length:30}, (_,i)=> 50 + (sym==='FX'? i*0.5 : i*1));
    const dates = closes.map((_,i)=> new Date(Date.UTC(2020,0,i+1)).toISOString());
    const volumes = closes.map((c,i)=> 1000 + i);
    return { closes, dates, volumes, fetchedAt: new Date().toISOString() };
  }

  const cycleId = 'cycle-test';
  const cycleAuditAppends: any[] = [];
  const cycleAuditStore = { append: async (p:any) => { cycleAuditAppends.push(p); } };

  const historicalRequestsBySymbol = new Map<string, Promise<any>>();
  const historicalMarketContextBySymbol = new Map<string, Promise<any>>();

  async function getHistoricalForSymbol(sym: string){
    const s = sym.toUpperCase();
    if (!historicalRequestsBySymbol.has(s)) historicalRequestsBySymbol.set(s, fakeGetHistorical(s));
    return historicalRequestsBySymbol.get(s) as Promise<any>;
  }

  async function getOrBuild(sym: string){
    const s = sym.toUpperCase();
    if (historicalMarketContextBySymbol.has(s)) return historicalMarketContextBySymbol.get(s);
    const p = (async ()=>{
      try{
        const hist = await getHistoricalForSymbol(s).catch(()=>null);
        const ctx = hist ? buildHistoricalMarketContext({ symbol: s, closes: hist.closes, dates: hist.dates, volumes: hist.volumes }) : buildHistoricalMarketContext({ symbol: s, closes: [], dates: [] });
        if (!hist){ try{ if (Array.isArray(ctx.warnings) && !ctx.warnings.includes('HISTORICAL_PROVIDER_UNAVAILABLE')) ctx.warnings.push('HISTORICAL_PROVIDER_UNAVAILABLE'); }catch(_){ } try{ if (Array.isArray(ctx.missingCapabilities) && !ctx.missingCapabilities.includes('HISTORICAL_PROVIDER')) ctx.missingCapabilities.push('HISTORICAL_PROVIDER'); }catch(_){ } }
        try{ await cycleAuditStore.append(buildHistoricalContextAuditPayload(cycleId, ctx)); }catch(_){ }
        return sanitizeContextForState(ctx);
      }catch(_){ return null; }
    })();
    historicalMarketContextBySymbol.set(s, p);
    return p;
  }

  const a1 = await getOrBuild('TST');
  const a2 = await getOrBuild('TST');
  expect(a1).toEqual(a2);
  expect(providerCalls['TST']).toBe(1);

  const b = await getOrBuild('BAD');
  expect(b).toBeTruthy();
  expect(b.dataQuality).toBe('INSUFFICIENT');
  expect(b.observationCount).toBe(0);
  expect(Array.isArray(b.warnings) && b.warnings.includes('HISTORICAL_PROVIDER_UNAVAILABLE')).toBe(true);
  expect(Array.isArray(b.missingCapabilities) && b.missingCapabilities.includes('HISTORICAL_PROVIDER')).toBe(true);
  expect(providerCalls['BAD']).toBe(1);

  const g = await getOrBuild('GOOD');
  expect(g).toBeTruthy();
  expect(providerCalls['GOOD']).toBe(1);

  const kinds = cycleAuditAppends.map((x:any)=> x && x.kind).filter(Boolean);
  expect(kinds).toContain('HISTORICAL_MARKET_CONTEXT_SNAPSHOT');
  const snapshotAudits = cycleAuditAppends.filter((x:any)=> x && x.kind === 'HISTORICAL_MARKET_CONTEXT_SNAPSHOT' && x.symbol === 'TST');
  expect(snapshotAudits.length).toBe(1);

  expect(() => JSON.stringify(a1)).not.toThrow();

  const original = buildHistoricalMarketContext({ symbol: 'TST2', closes: Array.from({length:30},(_,i)=>100+i), dates: Array.from({length:30},(_,i)=> new Date(Date.UTC(2020,0,i+1)).toISOString()), volumes: Array.from({length:30},(_,i)=>1000+i) });
  const snap = sanitizeContextForState(original as any);
  snap.warnings.push('X_TEST');
  snap.missingCapabilities.push('X_CAP');
  expect(original.warnings.includes('X_TEST')).toBe(false);
  expect(original.missingCapabilities.includes('X_CAP')).toBe(false);
});

it('normalized symbol dedupe and audit sanitized and append-failure isolation', async ()=>{
  const providerCalls: Record<string, number> = {};
  async function fakeGetHistorical(sym: string){
    const s = sym.toUpperCase(); providerCalls[s] = (providerCalls[s] || 0) + 1;
    if (s === 'FAIL') return null; // simulate provider failure
    const closes = Array.from({length:30},(_,i)=> 50 + i);
    const dates = closes.map((_,i)=> new Date(Date.UTC(2020,0,i+1)).toISOString());
    const volumes = closes.map((c,i)=> 1000 + i);
    return { closes, dates, volumes };
  }

  const cycleAuditAppends: any[] = [];
  const cycleAuditStore = { append: async (p:any) => { if (p && p.symbol === 'FAIL') throw new Error('audit fail'); cycleAuditAppends.push(p); } };

  const historicalRequestsBySymbol = new Map<string, Promise<any>>();
  const historicalMarketContextBySymbol = new Map<string, Promise<any>>();

  async function getHistoricalForSymbol(sym:string){
    const s = sym.toUpperCase(); if (!historicalRequestsBySymbol.has(s)) historicalRequestsBySymbol.set(s, fakeGetHistorical(s)); return historicalRequestsBySymbol.get(s) as Promise<any>;
  }

  async function getOrBuild(sym:string){
    const s = sym.toUpperCase(); if (historicalMarketContextBySymbol.has(s)) return historicalMarketContextBySymbol.get(s);
    const p = (async ()=>{
      const hist = await getHistoricalForSymbol(s).catch(()=>null);
      const ctx = hist ? buildHistoricalMarketContext({ symbol: s, closes: hist.closes, dates: hist.dates, volumes: hist.volumes }) : buildHistoricalMarketContext({ symbol: s, closes: [], dates: [] });
      if (!hist){ try{ if (Array.isArray(ctx.warnings) && !ctx.warnings.includes('HISTORICAL_PROVIDER_UNAVAILABLE')) ctx.warnings.push('HISTORICAL_PROVIDER_UNAVAILABLE'); }catch(_){ } try{ if (Array.isArray(ctx.missingCapabilities) && !ctx.missingCapabilities.includes('HISTORICAL_PROVIDER')) ctx.missingCapabilities.push('HISTORICAL_PROVIDER'); }catch(_){ } }
      try{ await cycleAuditStore.append(buildHistoricalContextAuditPayload('c', ctx)); }catch(_){ }
      return sanitizeContextForState(ctx);
    })();
    historicalMarketContextBySymbol.set(s, p);
    return p;
  }

  const r1 = await getOrBuild('msft');
  const r2 = await getOrBuild('MSFT');
  expect(providerCalls['MSFT']).toBe(1);

  for (const a of cycleAuditAppends){
    const forbidden = ['closes','dates','volumes','returns','providerResponse','apiKey','url','credentials'];
    for (const f of forbidden) expect(Object.prototype.hasOwnProperty.call(a,f)).toBe(false);
  }

  const f = await getOrBuild('FAIL');
  expect(f).toBeTruthy();
  const ok = await getOrBuild('OK');
  expect(ok).toBeTruthy();
  expect(providerCalls['OK']).toBe(1);

  const orig = buildHistoricalMarketContext({ symbol: 'T1', closes: Array.from({length:30},(_,i)=>100+i), dates: Array.from({length:30},(_,i)=> new Date(Date.UTC(2020,0,i+1)).toISOString()), volumes: Array.from({length:30},(_,i)=>1000+i) });
  const snap = sanitizeContextForState(orig);
  snap.warnings.push('X'); snap.missingCapabilities.push('Y');
  expect(orig.warnings.includes('X')).toBe(false);
  expect(orig.missingCapabilities.includes('Y')).toBe(false);
  expect(() => JSON.stringify(snap)).not.toThrow();
});
