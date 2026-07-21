import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { countSuccessfulExecutionsToday, runVictorTradingCycle } from './victor-trading-engine';
import { TRADABLE_UNIVERSE } from './tradable-universe';
import { TwelveDataMarketDataProvider } from './market-providers';
import { AtlasPaperBrokerProvider } from './broker-providers';
import { DEFAULT_PAPER_AUTO_MANDATE } from './victor-types';

const AUDIT_PATH = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');

function backupAudit(){
  if (fs.existsSync(AUDIT_PATH)){
    const bak = `${AUDIT_PATH}.bak.${Date.now()}`;
    fs.renameSync(AUDIT_PATH, bak);
    return bak;
  }
  return null;
}

function restoreAudit(bak: string | null){
  try{
    if (bak && fs.existsSync(bak)){
      if (fs.existsSync(AUDIT_PATH)) fs.unlinkSync(AUDIT_PATH);
      fs.renameSync(bak, AUDIT_PATH);
    } else {
      if (fs.existsSync(AUDIT_PATH)) fs.unlinkSync(AUDIT_PATH);
    }
  }catch(e){ }
}

function writeAudit(contents: any[]){
  try{ fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true }); }catch(e){}
  fs.writeFileSync(AUDIT_PATH, JSON.stringify(contents, null, 2), 'utf-8');
}

function isoOffset(days=0){ const d = new Date(); d.setDate(d.getDate()+days); return d.toISOString(); }

describe('victor audit counting', ()=>{
  let bak: string | null = null;
  let origTdKey: string | undefined;
  let origGetQuotes: any = null;
  let origPlace: any = null;
  beforeEach(()=>{ bak = backupAudit(); origTdKey = process.env.TWELVE_DATA_API_KEY; process.env.TWELVE_DATA_API_KEY = 'test'; });
  afterEach(()=>{ 
    // restore audit and env
    restoreAudit(bak); 
    if (typeof origTdKey === 'undefined') delete process.env.TWELVE_DATA_API_KEY; else process.env.TWELVE_DATA_API_KEY = origTdKey;
    // restore spies/prototypes if assigned
    try{ if (origGetQuotes) (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGetQuotes; }catch(e){}
    try{ if (origPlace) AtlasPaperBrokerProvider.prototype.placeOrder = origPlace; }catch(e){}
  });

  it('counts only executed entries for today and ignores future/past/invalid', async ()=>{
    const now = new Date();
    const todayIso = now.toISOString();
    const yesterdayIso = new Date(now.getTime() - 24*3600*1000).toISOString();
    const futureIso = new Date(now.getTime() + 24*3600*1000).toISOString();

    const audits = [
      { timestamp: todayIso, executed: [ { proposal: {}, result: { status: 'EXECUTED', success: true } } ] },
      { timestamp: todayIso, executed: [ { proposal: {}, result: { status: 'REJECTED', success: false } } ] },
      { timestamp: yesterdayIso, executed: [ { proposal: {}, result: { status: 'EXECUTED', success: true } } ] },
      { timestamp: futureIso, executed: [ { proposal: {}, result: { status: 'EXECUTED', success: true } } ] },
      { timestamp: 'invalid-date', executed: [ { proposal: {}, result: { status: 'EXECUTED', success: true } } ] },
    ];
    writeAudit(audits);
    const c = await countSuccessfulExecutionsToday();
    expect(c).toBe(1);
  });

  it('runVictorTradingCycle enforces maxTradesPerDay combining audit and current cycle', async ()=>{
    // prepare audit with 1 successful trade today
    const now = new Date();
    const todayIso = now.toISOString();
    writeAudit([{ timestamp: todayIso, executed: [ { proposal: {}, result: { status: 'EXECUTED', success: true } } ] }]);

    // stub market provider to return quotes for first two tradable instruments
    const symbols = TRADABLE_UNIVERSE.slice(0,2).map(i=> (i.providerSymbol || i.name).toUpperCase());
    const origGetQuotes = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
    (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
      return ids.map((s:string, i:number)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: i===0 ? -2 : 2 }));
    };

    // spy/patch broker placeOrder
    let placeCalls = 0;
    const origPlace = AtlasPaperBrokerProvider.prototype.placeOrder;
    AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){
      placeCalls++;
      return { success: true, orderId: `o_${placeCalls}`, executedPrice: 100, quantity: req.quantity, fee: 0, status: 'EXECUTED' };
    };

    // build mandate
    const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode: 'PAPER_AUTO', allowedInstrumentIds: TRADABLE_UNIVERSE.slice(0,2).map(i=>i.id), maxTradesPerDay: 2 } as any;

    const res = await runVictorTradingCycle({ mandate, trigger: 'MANUAL' });

    // placeOrder should have been called exactly once (one existing + one new allowed)
    expect(placeCalls).toBe(1);

    // audit file should contain an entry with reason MAX_TRADES_PER_DAY_REACHED
    const raw = fs.readFileSync(AUDIT_PATH, 'utf-8');
    const arr = JSON.parse(raw) || [];
    const found = arr.find((a:any)=> a && a.reason && a.reason.code === 'MAX_TRADES_PER_DAY_REACHED');
    expect(found).toBeTruthy();
    if (found){
      expect(found.reason.current).toBe(2);
      expect(found.reason.limit).toBe(2);
    }

    // providers restored in afterEach
  });

  it('REJECTED/FAILED in-cycle does not increase successfulTradesThisCycle', async ()=>{
    writeAudit([]);
    const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
    (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
      return ids.map((s:string, i:number)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: i===0 ? -2 : 2 }));
    };
    origGetQuotes = origGQ;

    let placeCalls = 0;
    const origPl = AtlasPaperBrokerProvider.prototype.placeOrder;
    AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){
      placeCalls++;
      if (placeCalls === 1) return { success: false, orderId: `o_${placeCalls}`, status: 'REJECTED', reason: 'test' } as any;
      return { success: true, orderId: `o_${placeCalls}`, executedPrice: 100, quantity: req.quantity || 1, fee: 0, status: 'EXECUTED' } as any;
    };
    origPlace = origPl;

    const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode: 'PAPER_AUTO', allowedInstrumentIds: TRADABLE_UNIVERSE.slice(0,2).map(i=>i.id), maxTradesPerDay: 1 } as any;
    const res = await runVictorTradingCycle({ mandate, trigger: 'MANUAL' });
    // both proposals attempted (first rejected, second executed), so placeOrder called twice
    expect(placeCalls).toBe(2);
    // audit should not have MAX_TRADES_PER_DAY_REACHED because successful count only 1
    const arr = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf-8') || '[]');
    const found = arr.find((a:any)=> a && a.reason && a.reason.code === 'MAX_TRADES_PER_DAY_REACHED');
    expect(found).toBeFalsy();
  });

  it('maxTradesPerCycle limits number of placeOrder attempts independently', async ()=>{
    writeAudit([]);
    const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
    (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
      return ids.map((s:string, i:number)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: i===0 ? -2 : 2 }));
    };
    origGetQuotes = origGQ;

    let placeCalls = 0;
    const origPl = AtlasPaperBrokerProvider.prototype.placeOrder;
    AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){ placeCalls++; return { success: true, orderId: `o_${placeCalls}`, executedPrice: 100, quantity: req.quantity || 1, fee: 0, status: 'EXECUTED' } as any; };
    origPlace = origPl;

    const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode: 'PAPER_AUTO', allowedInstrumentIds: TRADABLE_UNIVERSE.slice(0,3).map(i=>i.id), maxTradesPerDay: 10, maxTradesPerCycle: 1 } as any;
    await runVictorTradingCycle({ mandate, trigger: 'MANUAL' });
    expect(placeCalls).toBe(1);
  });

  it('maxTradesPerDay disabled for 0, negative, NaN, Infinity', async ()=>{
    const vals = [0, -1, NaN, Infinity];
    for (const v of vals){
      writeAudit([{ timestamp: new Date().toISOString(), executed: [ { proposal: {}, result: { status: 'EXECUTED' } } ] }]);
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        return ids.map((s:string, i:number)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: i===0 ? -2 : 2 }));
      };
      origGetQuotes = origGQ;

      let placeCalls = 0;
      const origPl = AtlasPaperBrokerProvider.prototype.placeOrder;
      AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){ placeCalls++; return { success: true, orderId: `o_${placeCalls}`, executedPrice: 100, quantity: req.quantity || 1, fee: 0, status: 'EXECUTED' } as any; };
      origPlace = origPl;

      const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode: 'PAPER_AUTO', allowedInstrumentIds: TRADABLE_UNIVERSE.slice(0,2).map(i=>i.id), maxTradesPerDay: v } as any;
      await runVictorTradingCycle({ mandate, trigger: 'MANUAL' });
      // since day-limit disabled, both proposals should be attempted
      expect(placeCalls).toBe(2);

      // cleanup for next iteration
      try{ if (origGetQuotes) (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGetQuotes; }catch(e){}
      try{ if (origPlace) AtlasPaperBrokerProvider.prototype.placeOrder = origPlace; }catch(e){}
    }
  });
});
