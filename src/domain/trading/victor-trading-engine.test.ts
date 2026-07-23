import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
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

// (removed unused helper isoOffset)

describe('victor audit counting', ()=>{
  let bak: string | null = null;
  let origTdKey: string | undefined;
  let origGetQuotes: any = null;
  let origPlace: any = null;
  beforeEach(()=>{ bak = backupAudit(); origTdKey = process.env.TWELVE_DATA_API_KEY; process.env.TWELVE_DATA_API_KEY = 'test'; });
  afterEach(async ()=>{
    // restore audit and env
    restoreAudit(bak); 
    if (typeof origTdKey === 'undefined') delete process.env.TWELVE_DATA_API_KEY; else process.env.TWELVE_DATA_API_KEY = origTdKey;

    // Restore any vitest spies/mocks
    try{ vi.restoreAllMocks(); }catch(e){}
    try{ vi.resetAllMocks(); }catch(e){}

    // Re-import fresh module implementations and restore prototypes to avoid leaked overrides
    try{
      const freshMarket = await import('./market-providers');
      if (freshMarket && (freshMarket as any).TwelveDataMarketDataProvider){
        (TwelveDataMarketDataProvider as any).prototype.getQuotes = (freshMarket as any).TwelveDataMarketDataProvider.prototype.getQuotes;
      }
    }catch(e){}
    try{
      const freshBroker = await import('./broker-providers');
      if (freshBroker && (freshBroker as any).AtlasPaperBrokerProvider){
        AtlasPaperBrokerProvider.prototype.placeOrder = (freshBroker as any).AtlasPaperBrokerProvider.prototype.placeOrder;
      }
    }catch(e){}
    try{
      const freshEngine = await import('./paper-trading-engine');
      if (freshEngine && (freshEngine as any).PaperTradingEngine){
        (freshEngine as any).PaperTradingEngine.prototype.simulateExecution = (freshEngine as any).PaperTradingEngine.prototype.simulateExecution;
      }
    }catch(e){}
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

  it('BUY MARKET with real quote executes near provided price and updates portfolio accordingly', async ()=>{
    // Build an isolated in-memory portfolio to avoid touching disk
    const portfolio: any = { id: 't1', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, holdings: [] };
    const { PaperTradingEngine } = await import('./paper-trading-engine');
    const eng = new (PaperTradingEngine as any)(portfolio);

    const price = 385.87;
    const qty = 10;
    const order = { id: 'o_buy_1', symbol: 'MSFT', side: 'Köp', quantity: qty, price };
    const res: any = eng.simulateExecution(order);
    expect(res.success).toBe(true);
    const tx = res.transaction;
    // executedPrice should be based on provided price and not near 100
    expect(tx.executedPrice).toBeGreaterThan(150);
    expect(tx.executedPrice).toBeGreaterThanOrEqual(price);
    // fee calculated from notional should be present
    expect(tx.fee).toBeGreaterThan(0);
    // cash should decrease by executedPrice*qty + fee
    const expectedCash = portfolio.availableCash - (tx.executedPrice * qty + tx.fee);
    expect(res.portfolio.availableCash).toBeCloseTo(expectedCash, 6);
    // holding averagePrice should equal executedPrice for new holding
    const holding = res.portfolio.holdings.find((h: any) => h.symbol === 'MSFT');
    expect(holding).toBeTruthy();
    expect(holding.averagePrice).toBeCloseTo(tx.executedPrice, 6);
  });

  it('SELL MARKET with real quote executes near provided price and decreases holding', async ()=>{
    // Initial portfolio with existing holding
    const portfolio: any = { id: 't2', baseCurrency: 'SEK', totalValue: 100000, availableCash: 1000, holdings: [{ id: 'h_MSFT', symbol: 'MSFT', quantity: 20, averagePrice: 300, currentPrice: 300, marketValue: 6000 }] };
    const { PaperTradingEngine } = await import('./paper-trading-engine');
    const eng = new (PaperTradingEngine as any)(portfolio);

    const price = 385.87;
    const qty = 10;
    const order = { id: 'o_sell_1', symbol: 'MSFT', side: 'Sälj', quantity: qty, price };
    const res: any = eng.simulateExecution(order);
    expect(res.success).toBe(true);
    const tx = res.transaction;
    // executedPrice should be below the provided price for SELL (slippage reduces price)
    expect(tx.executedPrice).toBeLessThan(price + 1); // slight cushion
    expect(tx.executedPrice).toBeLessThan(price);
    // holding quantity decreased by qty
    const holding = res.portfolio.holdings.find((h: any) => h.symbol === 'MSFT');
    expect(holding.quantity).toBe(10);
    // cash increased by proceeds minus fee
    const proceed = Math.max(0, tx.executedPrice * qty - tx.fee);
    expect(res.portfolio.availableCash).toBeCloseTo(portfolio.availableCash + proceed, 6);
  });

  it('MARKET orders without valid price are rejected by AtlasPaperBrokerProvider (integration)', async ()=>{
    // Use spyOn for fs methods so we can assert they were not called
    const portfolioSvc = await import('../portfolio/portfolio-service');

    // Spy on engine simulateExecution to ensure it's NOT called for invalid market prices
    const pte = await import('./paper-trading-engine');
    const PaperTradingEngine = (pte as any).PaperTradingEngine;
    const proto: any = PaperTradingEngine.prototype;
    const origSim = proto.simulateExecution;

    // Import a fresh copy of the broker module to avoid any prototype stubs from other tests
    const freshBrokerModule = await import(`./broker-providers?update=${Date.now()}`);
    const BrokerClass = freshBrokerModule.AtlasPaperBrokerProvider;
    const broker = new BrokerClass();
    const baseReq = { instrumentId: 'microsoft', symbol: 'MSFT', side: 'BUY', quantity: 1, orderType: 'MARKET' } as any;

    const before = portfolioSvc.getPortfolio();

    const cases: any[] = [ undefined, 0, NaN, -1 ];
    for (const p of cases){
      // reset simulateExecution spy flag per-iteration
      let simCalled = false;
      proto.simulateExecution = function(this: any, ...args: any[]){ simCalled = true; return origSim.apply(this, args); };

      // create spies for fs methods and ensure they mock to no-op
      const writeSpy = vi.spyOn(portfolioSvc.__fs as any, 'writeFile').mockImplementation(async ()=>{});
      const renameSpy = vi.spyOn(portfolioSvc.__fs as any, 'rename').mockImplementation(async ()=>{});
      const rmSpy = vi.spyOn(portfolioSvc.__fs as any, 'rm').mockImplementation(async ()=>{});

      const req = (typeof p === 'undefined') ? { ...baseReq } : { ...baseReq, price: p };
      const r = await broker.placeOrder(req);
      expect(r.success).toBe(false);
      expect(r.status).toBe('REJECTED');
      expect((r as any).reason).toBe('MISSING_MARKET_PRICE');
      expect(simCalled).toBe(false);
      // fs methods must not have been called
      expect(writeSpy).not.toHaveBeenCalled();
      expect(renameSpy).not.toHaveBeenCalled();
      expect(rmSpy).not.toHaveBeenCalled();

      const after = portfolioSvc.getPortfolio();
      expect(after).toEqual(before);

      // restore spies for next iteration
      writeSpy.mockRestore();
      renameSpy.mockRestore();
      rmSpy.mockRestore();
    }

    // restore engine method
    proto.simulateExecution = origSim;
  });

  it('END-TO-END deterministic BUY: provider -> victor -> broker -> engine -> portfolio', async ()=>{
    // Mocks / spies: market provider, persistence fs, Math.random
    const portfolioSvc = await import('../portfolio/portfolio-service');
    const Twelve = TwelveDataMarketDataProvider as any;

    // Spy fs methods to avoid real writes
    const writeSpy = vi.spyOn(portfolioSvc.__fs as any, 'writeFile').mockImplementation(async ()=>{});
    const renameSpy = vi.spyOn(portfolioSvc.__fs as any, 'rename').mockImplementation(async ()=>{});
    const rmSpy = vi.spyOn(portfolioSvc.__fs as any, 'rm').mockImplementation(async ()=>{});

    // Deterministic slippage
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    // Mock market provider to return MSFT quote that produces BUY
    const origGetQuotes = (Twelve as any).prototype.getQuotes;
    (Twelve as any).prototype.getQuotes = async function(ids: string[]){
      return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 385.87, changePercent: -2.5, timestamp: new Date().toISOString(), source: 'twelve', isMock: false }));
    };

    // Isolate portfolio: set a test path and seed portfolio in-memory via savePortfolio
    const tmpPath = `${process.cwd()}/src/data/portfolio.test.json`;
    const restorePath = portfolioSvc.__setPortfolioPathForTest(tmpPath);
    const initial = { id: 'paper-test', baseCurrency: 'SEK', totalValue: 1000000, availableCash: 1000000, holdings: [] } as any;
    await portfolioSvc.savePortfolio(initial);

    // Spy broker.placeOrder so we can observe broker interaction; use real engine implementation
    const brokerSpy = vi.spyOn(AtlasPaperBrokerProvider.prototype as any, 'placeOrder');
    const pte = await import('./paper-trading-engine');

    // Build mandate to target microsoft only and allow buys
    const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode: 'PAPER_AUTO', allowedInstrumentIds: ['microsoft'], maxTradesPerCycle: 1, maxOrderValueSek: 100000, minimumBuyConfidence: 0, allowAutomaticBuys: true } as any;

    // Ensure broker/engine prototypes are the fresh implementations to avoid leaked stubs
    try{
      const freshBrokerMod = await import(`./broker-providers?update=${Date.now()}`);
      AtlasPaperBrokerProvider.prototype.placeOrder = (freshBrokerMod as any).AtlasPaperBrokerProvider.prototype.placeOrder;
    }catch(e){}
    try{
      const freshEngineMod = await import(`./paper-trading-engine?update=${Date.now()}`);
      (freshEngineMod as any).PaperTradingEngine.prototype.simulateExecution = (freshEngineMod as any).PaperTradingEngine.prototype.simulateExecution;
    }catch(e){}

    // Run a single victor cycle using a fresh import to avoid leaked stubs from other tests
    const freshVictor = await import(`./victor-trading-engine?update=${Date.now()}`);
    const res = await (freshVictor as any).runVictorTradingCycle({ mandate, trigger: 'TEST' } as any);

    // Assertions using returned audit report
    const audit = (res as any).report && (res as any).report.audit;
    expect(audit).toBeTruthy();
    const decision = (audit.decisions || []).find((d:any)=> d.instrumentId === 'microsoft');
    expect(decision).toBeTruthy();
    expect(decision.action).toBe('BUY');

    const proposal = (audit.proposals || []).find((p:any)=> p.request && p.request.symbol === 'MSFT');
    expect(proposal).toBeTruthy();
    expect(proposal.request.price).toBeCloseTo(385.87, 6);

    // executed entries may contain the proposal either as { request: {...} } or flattened { symbol: 'MSFT' }
    const executed = (audit.executed || []).find((e:any)=> e.proposal && ((e.proposal.request && e.proposal.request.symbol === 'MSFT') || e.proposal.symbol === 'MSFT'));
    expect(executed).toBeTruthy();
    expect(executed.result.status).toBe('EXECUTED');

    // Quantity and price flow
    const qty = executed.result.quantity;
    expect(Number.isFinite(qty)).toBe(true);
    // We validate price flow via proposal and executed price below; engine is the internal implementation.

    const executedPrice = executed.result.executedPrice;
    expect(executedPrice).toBeGreaterThan(385.87);
    expect(Math.abs(executedPrice - 100)).toBeGreaterThan(50); // not near 100

    // slippage and fee
    const slippageAmount = executedPrice - 385.87;
    const slippagePct = slippageAmount / 385.87;
    expect(slippageAmount).toBeGreaterThan(0);
    expect(executed.result.fee).toBeGreaterThan(0);

    // cash before/after and holding
    const cashBefore = initial.availableCash;
    const cashAfter = (await portfolioSvc.getPortfolio()).availableCash;
    const expectedCost = executedPrice * qty + executed.result.fee;
    expect(cashAfter).toBeCloseTo(cashBefore - expectedCost, 6);

    const holding = (await portfolioSvc.getPortfolio()).holdings.find((h:any)=> h.symbol === 'MSFT');
    expect(holding).toBeTruthy();
    if (!holding) throw new Error('Expected MSFT holding to exist after execution');
    expect(holding.quantity).toBe(qty);
    expect(holding.averagePrice).toBeCloseTo(executedPrice, 6);

    // Clean up / restore
    brokerSpy.mockRestore();
    (Twelve as any).prototype.getQuotes = origGetQuotes;
    rnd.mockRestore();
    writeSpy.mockRestore();
    renameSpy.mockRestore();
    rmSpy.mockRestore();
    restorePath();
  });

  it('Broker rejects orders with invalid quantity (0, -1, NaN) using engine rejection reason', async ()=>{
    const portfolioSvc = await import('../portfolio/portfolio-service');
    const pte = await import('./paper-trading-engine');
    const PaperTradingEngine = (pte as any).PaperTradingEngine;
    const proto: any = PaperTradingEngine.prototype;
    const origSim = proto.simulateExecution;

    const freshBrokerModule = await import(`./broker-providers?update=${Date.now()}`);
    const BrokerClass = freshBrokerModule.AtlasPaperBrokerProvider;
    const broker = new BrokerClass();
    const baseReq = { instrumentId: 'microsoft', symbol: 'MSFT', side: 'BUY', orderType: 'MARKET', price: 385.87 } as any;

    const before = portfolioSvc.getPortfolio();

    const cases = [0, -1, NaN];
    for (const q of cases){
      // spy engine simulateExecution to detect calls
      let simCalled = false;
      proto.simulateExecution = function(this: any, ...args: any[]){ simCalled = true; return origSim.apply(this, args); };

      const writeSpy = vi.spyOn(portfolioSvc.__fs as any, 'writeFile').mockImplementation(async ()=>{});
      const renameSpy = vi.spyOn(portfolioSvc.__fs as any, 'rename').mockImplementation(async ()=>{});
      const rmSpy = vi.spyOn(portfolioSvc.__fs as any, 'rm').mockImplementation(async ()=>{});

      const req = { ...baseReq, quantity: q } as any;
      const r = await broker.placeOrder(req);

      expect(r.success).toBe(false);
      expect(r.status).toBe('REJECTED');
      // broker now rejects invalid quantity before calling engine
      expect((r as any).reason).toBe('INVALID_QUANTITY');

      // engine must NOT be called due to early broker validation
      expect(simCalled).toBe(false);

      // persistence must not be called
      expect(writeSpy).not.toHaveBeenCalled();
      expect(renameSpy).not.toHaveBeenCalled();
      expect(rmSpy).not.toHaveBeenCalled();

      const after = portfolioSvc.getPortfolio();
      expect(after).toEqual(before);

      writeSpy.mockRestore();
      renameSpy.mockRestore();
      rmSpy.mockRestore();
    }

    proto.simulateExecution = origSim;
  });

  it('LIMIT order uses explicit price mapping and executes based on provided limit', async ()=>{
    const portfolio: any = { id: 't3', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, holdings: [] };
    const { PaperTradingEngine } = await import('./paper-trading-engine');
    const eng = new (PaperTradingEngine as any)(portfolio);
    const limitPrice = 123.45;
    const qty = 5;
    const order = { id: 'o_limit_1', symbol: 'FOO', side: 'Köp', quantity: qty, price: limitPrice };
    const res: any = eng.simulateExecution(order);
    expect(res.success).toBe(true);
    expect(res.transaction.executedPrice).toBeGreaterThanOrEqual(limitPrice);
    expect(res.transaction.executedPrice).toBeLessThan(limitPrice * 1.01);
  });
});
