import { describe, it, expect } from 'vitest';
import { buildIntradayMarketContext, sanitizeIntradayMarketContextForState, buildIntradayDataReadiness } from './intraday-market-context';

function makeCandle(ts: string, o:number,h:number,l:number,c:number,v:number|null){ return { timestamp: ts, open: o, high: h, low: l, close: c, volume: v }; }

describe('IntradayMarketContext builder', ()=>{
  it('sorts, dedupes and classifies coverage', ()=>{
    // unsorted with duplicate timestamp; last duplicate should win
    const now = new Date();
    // place base far enough in the past so generated candles are not considered future
    const base = new Date(now.getTime() - 60 * 29 * 1000);
    const candles = [] as any[];
    for (let i=0;i<30;i++){
      const d = new Date(base.getTime() + i*60*1000);
      candles.push(makeCandle(d.toISOString(), 100+i, 110+i, 90+i, 105+i, 1000));
    }
    // duplicate at middle: earlier invalid then valid
    const dupTs = candles[10].timestamp;
    candles[10] = makeCandle(dupTs, 0,0,0,0,null); // invalid
    candles.push(makeCandle(dupTs, 120,121,119,120,500));
    // shuffle
    candles.sort(()=> Math.random() - 0.5);
    const ctx = buildIntradayMarketContext({ symbol: 'MSFT', interval: '5min', candles, now });
    expect(ctx.pointCount).toBeGreaterThanOrEqual(30);
    expect(ctx.coverage).toBe('LIMITED');
    expect(ctx.latest.open).toBeDefined();
    expect(ctx.session.openPrice).toBeDefined();
    expect(ctx.warnings.includes('INTRADAY_INVALID_CANDLES_FILTERED')).toBeTruthy();
  });

  it('computes direction and shortReturnPercent and volumeVsAverage', ()=>{
    const now = new Date();
    const base = new Date(now.getTime() - 20*60*1000);
    const candles = [] as any[];
    for (let i=0;i<25;i++){
      const d = new Date(base.getTime() + i*60*1000);
      const open = 100 + i*0.1; const close = open + (i>=20? 0.3 : 0); // small uptick near end
      candles.push(makeCandle(d.toISOString(), open, open+0.5, open-0.5, close, 100 + i));
    }
    const ctx = buildIntradayMarketContext({ symbol: 'AAPL', interval: '15min', candles, now });
    expect(ctx.momentum.shortReturnPercent).not.toBeNull();
    expect(['UP','DOWN','FLAT','UNKNOWN'].includes(ctx.momentum.direction)).toBeTruthy();
  });

  it('filters invalid candles and future tolerance, volume nulling, duplicate keep-last', ()=>{
    const now = new Date();
    const base = new Date(now.getTime() - 60 * 60 * 1000);
    const candles: any[] = [];
    // valid block
    for (let i=0;i<10;i++){ const d = new Date(base.getTime() + i*60*1000); candles.push({ timestamp: d.toISOString(), open: 10+i, high: 12+i, low: 9+i, close: 11+i, volume: i % 2 === 0 ? 100 : null }); }
    // invalid open
    candles.push({ timestamp: new Date(base.getTime()+11*60*1000).toISOString(), open: 0, high:2, low:1, close:1, volume:10 });
    // invalid relation (high too low)
    candles.push({ timestamp: new Date(base.getTime()+12*60*1000).toISOString(), open: 5, high: 4, low:4, close:4, volume:5 });
    // negative volume -> null
    candles.push({ timestamp: new Date(base.getTime()+13*60*1000).toISOString(), open:20, high:21, low:19, close:20, volume: -5 });
    // future beyond tolerance -> filtered
    candles.push({ timestamp: new Date(now.getTime()+5*60*1000).toISOString(), open:1,high:2,low:1,close:2,volume:1 });
    // duplicate timestamp: first invalid then valid later; valid should win
    const dupTs = new Date(base.getTime()+14*60*1000).toISOString();
    candles.push({ timestamp: dupTs, open: 0, high:0, low:0, close:0, volume:null });
    candles.push({ timestamp: dupTs, open: 30, high:31, low:29, close:30, volume:50 });

    const ctx = buildIntradayMarketContext({ symbol: 'TEST', interval: '5min', candles, now });
    expect(ctx.pointCount).toBeGreaterThanOrEqual(10);
    expect(ctx.latest.close).not.toBeNull();
    expect(ctx.session.cumulativeVolume).not.toBeNull();
    expect(ctx.warnings.includes('INTRADAY_INVALID_CANDLES_FILTERED')).toBeTruthy();
  });

  it('coverage bucketing and freshness checks', ()=>{
    const now = new Date();
    const base = new Date(now.getTime() - 60 * 60 * 1000);
    const make = (n:number) => {
      const arr: any[] = [];
      for (let i=0;i<n;i++){ const d = new Date(base.getTime() + i*60*1000); arr.push({ timestamp: d.toISOString(), open: 10+i, high: 12+i, low: 9+i, close: 11+i, volume: 100 }); }
      return arr;
    };
    const cComplete = buildIntradayMarketContext({ symbol: 'S', interval: '15min', candles: make(50), now });
    expect(cComplete.coverage).toBe('COMPLETE');
    const cLimited = buildIntradayMarketContext({ symbol: 'L', interval: '15min', candles: make(30), now });
    expect(cLimited.coverage).toBe('LIMITED');
    const cIns = buildIntradayMarketContext({ symbol: 'I', interval: '15min', candles: make(10), now });
    expect(cIns.coverage).toBe('INSUFFICIENT');
    const cUn = buildIntradayMarketContext({ symbol: 'U', interval: '15min', candles: make(5), now });
    expect(cUn.coverage).toBe('UNAVAILABLE');
    // freshness: create latest older than thresholds
    const staleNow = new Date();
    const staleBase = new Date(staleNow.getTime() - 60 * 60 * 1000);
    const staleCandles = [] as any[]; for (let i=0;i<10;i++){ staleCandles.push({ timestamp: new Date(staleBase.getTime() + i*60*1000).toISOString(), open:1,high:2,low:1,close:2,volume:10 }); }
    const stale = buildIntradayMarketContext({ symbol: 'ST', interval: '5min', candles: staleCandles, now: staleNow });
    expect(stale.isFresh).toBe(false);
  });

  it('sanitizer produces defensive copy without raw candles', ()=>{
    const now = new Date();
    const base = new Date(now.getTime() - 30*60*1000);
    const candles: any[] = [];
    for (let i=0;i<20;i++){ const d=new Date(base.getTime()+i*60*1000); candles.push({ timestamp: d.toISOString(), open:10+i,high:11+i,low:9+i,close:10+i,volume:100 }); }
    const ctx = buildIntradayMarketContext({ symbol: 'SAN', interval: '15min', candles, now });
    const s = sanitizeIntradayMarketContextForState(ctx);
    expect(s).not.toBe(ctx);
    expect((s as any).latest).toBeDefined();
    expect((s as any).warnings).toBeDefined();
  });

  it('buildIntradayDataReadiness handles empty and counts', ()=>{
    const empty = buildIntradayDataReadiness(null, new Date());
    expect(empty.symbolCount).toBe(0);
    const now = new Date();
    const base = new Date(now.getTime() - 30*60*1000);
    const candles = []; for (let i=0;i<25;i++){ const d=new Date(base.getTime()+i*60*1000); candles.push({ timestamp: d.toISOString(), open:1,high:2,low:1,close:2,volume:10 }); }
    const a = buildIntradayMarketContext({ symbol: 'R', interval: '15min', candles, now });
    const r = buildIntradayDataReadiness([a], now);
    expect(r.symbolCount).toBe(1);
  });
});
