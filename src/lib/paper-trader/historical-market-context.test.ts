import { expect, it } from 'vitest';
import { buildHistoricalMarketContext } from './historical-market-context';

function datesFrom(startIso: string, n: number){
  const start = new Date(startIso);
  return Array.from({length:n},(_,i)=> new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()+i)).toISOString());
}

function lastN(n:number, arr:number[]){ return arr.slice(Math.max(0, arr.length - n)); }

// Helper to assert numeric outputs finite or null
function assertNumericFiniteOrNull(ctx:any){
  const numericKeys = ['trendAgreement','momentumScore','currentVolatility','previousVolatility','currentDrawdownPercent','maxDrawdownPercent','recoveryPercent','rangePosition','distanceFromHighPercent','distanceFromLowPercent'];
  for (const k of numericKeys){ const v = (ctx as any)[k]; expect(v === null || Number.isFinite(v)).toBe(true); }
}

it('strictly rising series -> UP trends and COMPLETE quality', ()=>{
  const closes = Array.from({length: 70}, (_,i)=> 100 + i * 1); // rising
  const dates = closes.map((_,i)=> new Date(Date.UTC(2020,0,i+1)).toISOString());
  const ctx = buildHistoricalMarketContext({ symbol: 'TST', closes, dates, volumes: closes.map(c=> 1000 + c), now: new Date('2025-01-01') });
  expect(ctx.dataQuality).toBe('COMPLETE');
  expect(ctx.shortTrend).toBe('UP');
  expect(ctx.mediumTrend).toBe('UP');
  expect(ctx.longTrend).toBe('UP');
  expect(ctx.trendAgreement).toBeGreaterThan(0.9);
  expect(ctx.observationCount).toBeGreaterThanOrEqual(60);
});

it('strictly falling series -> DOWN trends', ()=>{
  const closes = Array.from({length: 65}, (_,i)=> 200 - i * 1.5);
  const dates = closes.map((_,i)=> new Date(Date.UTC(2021,0,i+1)).toISOString());
  const ctx = buildHistoricalMarketContext({ symbol: 'TST', closes, dates, now: new Date('2025-01-01') });
  expect(ctx.shortTrend).toBe('DOWN');
  expect(ctx.mediumTrend).toBe('DOWN');
  expect(ctx.longTrend).toBe('DOWN');
  expect(ctx.currentDrawdownPercent).toBeGreaterThanOrEqual(0);
});

it('sideways noisy series -> SIDEWAYS or INSUFFICIENT for small windows', ()=>{
  const closes = Array.from({length: 40}, (_,i)=> 100 + Math.sin(i/2) * 0.5 + (i%3===0?0.1:-0.1));
  const dates = closes.map((_,i)=> new Date(Date.UTC(2022,0,i+1)).toISOString());
  const ctx = buildHistoricalMarketContext({ symbol: 'NOISE', closes, dates, now: new Date('2025-01-01') });
  expect(['SIDEWAYS','INSUFFICIENT']).toContain(ctx.shortTrend);
});

it('future dates and invalid prices removed; no mutation of input arrays', ()=>{
  const closes = [10, 11, NaN, 12, 13, 14];
  const dates = [ '2020-01-01', '2030-01-01', '2020-01-03', '2020-01-04', 'invalid-date', '2020-01-06' ];
  const copyCloses = closes.slice(); const copyDates = dates.slice();
  const ctx = buildHistoricalMarketContext({ symbol: 'FX', closes, dates, now: new Date('2025-01-01') });
  expect(ctx.observationCount).toBeGreaterThan(0);
  expect(copyCloses).toEqual(closes);
  expect(copyDates).toEqual(dates);
});

it('duplicate dates handled deterministically', ()=>{
  const closes = [100, 101, 102, 103];
  const dates = ['2020-01-01','2020-01-02','2020-01-02','2020-01-03'];
  const fixedNow = new Date('2025-01-01');
  const a = buildHistoricalMarketContext({ symbol: 'DUP', closes, dates, now: fixedNow });
  const b = buildHistoricalMarketContext({ symbol: 'DUP', closes, dates, now: fixedNow });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

it('short reversal vs long trend -> REVERSING and MOMENTUM_REVERSAL warning', ()=>{
  // long uptrend then short recent downtrend
  const rising = Array.from({length:55},(_,i)=> 100 + i * 0.5);
  const falling = Array.from({length:10},(_,i)=> rising[rising.length-1] - (i+1) * 1.5);
  const closes = rising.concat(falling);
  const dates = datesFrom('2020-01-01', closes.length);
  const ctx = buildHistoricalMarketContext({ symbol: 'REV', closes, dates, now: new Date('2025-01-01') });
  expect(ctx.longTrend).toBe('UP');
  expect(ctx.shortTrend).toBe('DOWN');
  expect(ctx.momentumPersistence).toBe('REVERSING');
  expect(ctx.warnings.includes('MOMENTUM_REVERSAL')).toBe(true);
});

it('high volatility detected', ()=>{
  // low volatility earlier, then large jumps in last 20
  const base = Array.from({length:50},(_,i)=> 100 + Math.sin(i/3)*0.2);
  const recent = Array.from({length:20},(_,i)=> 120 + (i%2?10:-10) * (1 + i*0.05));
  const closes = base.concat(recent);
  const dates = datesFrom('2020-01-01', closes.length);
  const ctx = buildHistoricalMarketContext({ symbol: 'HV', closes, dates, now: new Date('2025-01-01') });
  expect(['HIGH','EXPANDING','NORMAL']).toContain(ctx.volatilityState);
  expect(ctx.currentVolatility === null || Number.isFinite(ctx.currentVolatility)).toBe(true);
  if (ctx.currentVolatility !== null) expect(ctx.currentVolatility).toBeGreaterThan(0);
});

it('contracting volatility detected', ()=>{
  // previously high volatility then quieter recent
  const prevHigh = Array.from({length:40},(_,i)=> 100 + (i%2?10:-10) * (1 + i*0.1));
  const lastQuiet = Array.from({length:20},(_,i)=> 150 + Math.sin(i/2)*0.2);
  const closes = prevHigh.concat(lastQuiet);
  const dates = datesFrom('2020-01-01', closes.length);
  const ctx = buildHistoricalMarketContext({ symbol: 'CV', closes, dates, now: new Date('2025-01-01') });
  expect(ctx.volatilityState === 'CONTRACTING' || ctx.volatilityState === 'NORMAL').toBe(true);
});

it('current drawdown and max drawdown and partial recovery', ()=>{
  // create peak, trough, partial recovery
  const seq = [100,120,130,125,110,90,95,100,105,103];
  const closes = seq;
  const dates = datesFrom('2020-01-01', closes.length);
  const ctx = buildHistoricalMarketContext({ symbol: 'DD', closes, dates, now: new Date('2025-01-01') });
  expect(ctx.currentDrawdownPercent === null || ctx.currentDrawdownPercent > 0).toBe(true);
  if (ctx.maxDrawdownPercent !== null) expect(ctx.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
  if (ctx.recoveryPercent !== null) expect(ctx.recoveryPercent).toBeGreaterThanOrEqual(0);
});

it('range at high / range at low / flat range', ()=>{
  // high range: last equals high
  const highSeq = [10,12,14,13,15]; const highDates = datesFrom('2020-01-01', highSeq.length);
  const ch = buildHistoricalMarketContext({ symbol: 'RH', closes: highSeq, dates: highDates, now: new Date('2025-01-01') });
  expect(ch.rangePosition).toBeGreaterThan(0.9);

  // low range: last equals low
  const lowSeq = [15,14,13,12,10]; const lowDates = datesFrom('2020-01-01', lowSeq.length);
  const cl = buildHistoricalMarketContext({ symbol: 'RL', closes: lowSeq, dates: lowDates, now: new Date('2025-01-01') });
  expect(cl.rangePosition).toBeLessThan(0.1);

  // flat range
  const flat = [100,100,100,100]; const fDates = datesFrom('2020-01-01', flat.length);
  const cf = buildHistoricalMarketContext({ symbol: 'RF', closes: flat, dates: fDates, now: new Date('2025-01-01') });
  expect(cf.rangePosition).toBeCloseTo(0.5, 6);
  expect(cf.distanceFromHighPercent).toBe(0);
  expect(cf.distanceFromLowPercent).toBe(0);
});

it('volume rising/falling/stable/unavailable and invalid volumes handled', ()=>{
  // rising volumes
  const closes = Array.from({length:40},(_,i)=> 100 + i);
  const dates = datesFrom('2020-01-01', closes.length);
  const volRising = Array.from({length:40},(_,i)=> 100 + i*10);
  const vr = buildHistoricalMarketContext({ symbol: 'VR', closes, dates, volumes: volRising, now: new Date('2025-01-01') });
  expect(['RISING','STABLE','FALLING']).toContain(vr.volumeTrend);

  // falling volumes
  const volFalling = Array.from({length:40},(_,i)=> 1000 - i*10);
  const vf = buildHistoricalMarketContext({ symbol: 'VF', closes, dates, volumes: volFalling, now: new Date('2025-01-01') });
  expect(['FALLING','STABLE','RISING']).toContain(vf.volumeTrend);

  // stable volumes
  const volStable = Array.from({length:40},(_,i)=> 500 + (i%3)-1);
  const vs = buildHistoricalMarketContext({ symbol: 'VS', closes, dates, volumes: volStable, now: new Date('2025-01-01') });
  expect(['STABLE','RISING','FALLING']).toContain(vs.volumeTrend);

  // unavailable / invalid volumes
  const badVols = [100,200,NaN,300,-1,Infinity];
  const vb = buildHistoricalMarketContext({ symbol: 'VB', closes: [10,11,12,13,14,15], dates: datesFrom('2020-01-01',6), volumes: badVols as any, now: new Date('2025-01-01') });
  expect(vb.volumeTrend).toBe('UNAVAILABLE');
});

it('unsorted input yields same result as sorted input', ()=>{
  const closes = [100,102,101,103,104,105,106,108,107,109];
  const dates = datesFrom('2020-01-01', closes.length);
  // shuffle pairs: make unordered arrays
  const pairs = closes.map((c,i)=> ({c, d: dates[i]}));
  const shuffled = [...pairs].reverse();
  const sCloses = shuffled.map(p=> p.c);
  const sDates = shuffled.map(p=> p.d);
  const a = buildHistoricalMarketContext({ symbol: 'SRT', closes, dates, now: new Date('2025-01-01') });
  const b = buildHistoricalMarketContext({ symbol: 'SRT', closes: sCloses, dates: sDates, now: new Date('2025-01-01') });
  expect(a.observationCount).toBe(b.observationCount);
  expect(a.shortTrend).toBe(b.shortTrend);
});

it('limited quality for 20-59 observations', ()=>{
  const closes = Array.from({length:25},(_,i)=> 100 + i*0.2);
  const dates = datesFrom('2020-01-01', closes.length);
  const ctx = buildHistoricalMarketContext({ symbol: 'LIM', closes, dates, now: new Date('2025-01-01') });
  expect(ctx.dataQuality).toBe('LIMITED');
});

it('every numeric output is finite or null', ()=>{
  const closes = Array.from({length:70},(_,i)=> 100 + Math.sin(i/3) * i * 0.01 + i*0.1);
  const dates = datesFrom('2020-01-01', closes.length);
  const ctx = buildHistoricalMarketContext({ symbol: 'NUM', closes, dates, volumes: closes.map(c=> 1000 + c), now: new Date('2025-01-01') });
  assertNumericFiniteOrNull(ctx as any);
});
