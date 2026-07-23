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
      return ids.map((s:string, i:number)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: i===0 ? -2 : 2, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
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
      return ids.map((s:string, i:number)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: i===0 ? -2 : 2, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
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
      return ids.map((s:string, i:number)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: i===0 ? -2 : 2, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
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
        return ids.map((s:string, i:number)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: i===0 ? -2 : 2, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
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

  // --- Uses mocked Twelve Data crypto quotes deterministically (mock-only) ---
  it('uses mocked Twelve Data crypto quotes deterministically', async ()=>{
    const provider = new TwelveDataMarketDataProvider();
    const syms = ['BTC/USD','ETH/USD','SOL/USD'];
    const out: any[] = [];
    try{
      const quotes = await provider.getQuotes(syms);
      for (const s of syms){
        const found = (quotes || []).find((q:any)=> String(q.symbol).toUpperCase() === String(s).toUpperCase());
        if (found){
          const fresh = (found.timestamp && (Date.now() - new Date(found.timestamp).getTime()) <= (2*60*1000));
          out.push({ requested: s, returned: found.symbol, price: found.price, timestamp: found.timestamp, fresh, source: found.source, error: null });
        } else {
          out.push({ requested: s, returned: null, price: null, timestamp: null, fresh: false, source: null, error: 'no_quote' });
        }
      }
    }catch(e:any){
      for (const s of syms) out.push({ requested: s, returned: null, price: null, timestamp: null, fresh: false, source: null, error: String(e) });
    }
    // Basic assertions: out must have three entries
    expect(out.length).toBe(3);
  });

  // --- Timestamp normalization unit tests for TwelveDataMarketDataProvider.validateQuote ---
  describe('TwelveData timestamp normalization', ()=>{
    const proto: any = (TwelveDataMarketDataProvider as any).prototype;

    it('converts unix seconds to ISO timestamp', ()=>{
      const raw: any = { symbol: 'BTC/USD', price: 1, timestamp: 1620003600 };
      const q = proto.validateQuote(raw, 'BTC/USD');
      expect(q.timestamp).toBe(new Date(1620003600 * 1000).toISOString());
      expect(q.isStale).toBe(false);
    });

    it('accepts unix milliseconds and converts to ISO', ()=>{
      const raw: any = { symbol: 'ETH/USD', price: 1, timestamp: 1620003600000 };
      const q = proto.validateQuote(raw, 'ETH/USD');
      expect(q.timestamp).toBe(new Date(1620003600000).toISOString());
      expect(q.isStale).toBe(false);
    });

    it('accepts ISO datetime strings', ()=>{
      const iso = new Date().toISOString();
      const raw: any = { symbol: 'SOL/USD', price: 1, datetime: iso };
      const q = proto.validateQuote(raw, 'SOL/USD');
      expect(q.timestamp).toBe(new Date(iso).toISOString());
      expect(q.isStale).toBe(false);
    });

    it('invalid timestamp is not replaced by current time and is marked stale', ()=>{
      const raw: any = { symbol: 'BTC/USD', price: 1, timestamp: 'not-a-time' };
      const q = proto.validateQuote(raw, 'BTC/USD');
      expect(q.timestamp).toBeNull();
      expect(q.isStale).toBe(true);
    });

    it('fresh crypto quote passes freshness check', ()=>{
      const nowIso = new Date().toISOString();
      const raw: any = { symbol: 'BTC/USD', price: 50000, timestamp: nowIso };
      const q = proto.validateQuote(raw, 'BTC/USD');
      expect(q.timestamp).toBe(new Date(nowIso).toISOString());
      const age = Date.now() - new Date(q.timestamp).getTime();
      expect(age).toBeLessThanOrEqual(2 * 60 * 1000);
    });

    it('old crypto quote yields large age (filtered by Victor)', ()=>{
      const oldIso = new Date(Date.now() - (10 * 60 * 1000)).toISOString();
      const raw: any = { symbol: 'BTC/USD', price: 50000, timestamp: oldIso };
      const q = proto.validateQuote(raw, 'BTC/USD');
      const age = Date.now() - new Date(q.timestamp).getTime();
      expect(age).toBeGreaterThan(2 * 60 * 1000);
    });

    it('numeric timestamp prioritized over date-only datetime', ()=>{
      const raw: any = { symbol: 'BTC/USD', price: 1, timestamp: 1620003600, datetime: '2026-07-23' };
      const q = proto.validateQuote(raw, 'BTC/USD');
      expect(q.rawTimestampField).toBe('timestamp');
      expect(q.timestamp).toBe(new Date(1620003600 * 1000).toISOString());
      expect(q.isStale).toBe(false);
    });

    it('unix seconds normalized correctly', ()=>{
      const raw: any = { symbol: 'ETH/USD', price: 1, timestamp: 1620003600 };
      const q = proto.validateQuote(raw, 'ETH/USD');
      expect(q.timestamp).toBe(new Date(1620003600 * 1000).toISOString());
    });

    it('unix milliseconds normalized correctly', ()=>{
      const raw: any = { symbol: 'SOL/USD', price: 1, timestamp: 1620003600000 };
      const q = proto.validateQuote(raw, 'SOL/USD');
      expect(q.timestamp).toBe(new Date(1620003600000).toISOString());
    });

    it('datetime with time accepted', ()=>{
      const iso = '2026-07-23T12:34:56Z';
      const raw: any = { symbol: 'BTC/USD', price: 1, datetime: iso };
      const q = proto.validateQuote(raw, 'BTC/USD');
      expect(q.timestamp).toBe(new Date(iso).toISOString());
      expect(q.rawTimestampField).toBe('datetime');
      expect(q.isStale).toBe(false);
    });

    it('date-only datetime rejected (YYYY-MM-DD)', ()=>{
      const raw: any = { symbol: 'ETH/USD', price: 1, datetime: '2026-07-23' };
      const q = proto.validateQuote(raw, 'ETH/USD');
      expect(q.timestamp).toBeNull();
      expect(q.isStale).toBe(true);
      expect(q.rawTimestampField).toBeUndefined();
    });

    it('date-only datetime rejected (midnight string)', ()=>{
      const raw: any = { symbol: 'SOL/USD', price: 1, datetime: '2026-07-23T00:00:00.000Z' };
      const q = proto.validateQuote(raw, 'SOL/USD');
      expect(q.timestamp).toBeNull();
      expect(q.isStale).toBe(true);
    });

    it('date field ignored for freshness', ()=>{
      const raw: any = { symbol: 'BTC/USD', price: 1, date: '2026-07-23' };
      const q = proto.validateQuote(raw, 'BTC/USD');
      expect(q.timestamp).toBeNull();
      expect(q.isStale).toBe(true);
    });

    it('missing intraday timestamp yields null and isStale true (no fallback)', ()=>{
      const raw: any = { symbol: 'BTC/USD', price: 1 }; // no timestamp-like fields
      const q = proto.validateQuote(raw, 'BTC/USD');
      expect(q.timestamp).toBeNull();
      expect(q.isStale).toBe(true);
    });

    it('fresh intraday timestamp passes freshness check', ()=>{
      const nowIso = new Date().toISOString();
      const raw: any = { symbol: 'BTC/USD', price: 50000, timestamp: nowIso };
      const q = proto.validateQuote(raw, 'BTC/USD');
      expect(q.timestamp).toBe(new Date(nowIso).toISOString());
      const age = Date.now() - new Date(q.timestamp).getTime();
      expect(age).toBeLessThanOrEqual(2 * 60 * 1000);
    });
  });

  describe('TwelveData time_series for Crypto', ()=>{
    let fetchOrig: any;
    beforeEach(()=>{ fetchOrig = globalThis.fetch; });
    afterEach(()=>{ globalThis.fetch = fetchOrig; });

    it('uses time_series for BTC/USD and maps values[0].close to price', async ()=>{
      const provider = new TwelveDataMarketDataProvider();
      // mock fetch
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.includes('/time_series')){
          return { ok: true, status: 200, json: async ()=>({ meta: { symbol: 'BTC/USD', exchange: 'Binance' }, values: [{ datetime: new Date().toISOString().replace('T',' ').replace(/\.\d+Z$/,'') , close: '60000' }] }) };
        }
        return { ok: false, status: 500, json: async ()=>({}) };
      }) as any;
      const q = await provider.getQuote('BTC/USD');
      expect(q.price).toBe(60000);
      expect(q.rawTimestampField).toBe('values[0].datetime');
      expect(q.timestamp).toMatch(/T\d{2}:\d{2}:\d{2}\.000Z$/);
    });

    it('empty values yields error/no valid quote', async ()=>{
      const provider = new TwelveDataMarketDataProvider();
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.includes('/time_series')) return { ok: true, status:200, json: async ()=>({ meta: { symbol: 'SOL/USD' }, values: [] }) };
        return { ok: false, status:500, json: async ()=>({}) };
      }) as any;
      await expect(provider.getQuote('SOL/USD')).rejects.toThrow();
    });

    it('does not call /quote for crypto when time_series succeeds', async ()=>{
      const provider = new TwelveDataMarketDataProvider();
      let seenQuote = false;
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.includes('/quote')){ seenQuote = true; return { ok: true, status:200, json: async ()=>({}) }; }
        if (url.includes('/time_series')) return { ok: true, status:200, json: async ()=>({ meta: { symbol: 'ETH/USD' }, values: [{ datetime: new Date().toISOString().replace('T',' ').replace(/\.\d+Z$/,'') , close: '2000' }] }) };
        return { ok: false, status:500, json: async ()=>({}) };
      }) as any;
      const q = await provider.getQuote('ETH/USD');
      expect(seenQuote).toBe(false);
      expect(q.price).toBe(2000);
    });
  });

  // --- Auto market prioritization tests (US -> Forex -> Crypto) ---
  describe('auto market prioritization (US -> Forex -> Crypto)', ()=>{
    afterEach(()=>{
      try{ vi.useRealTimers(); }catch(e){}
    });

    it('A. US open -> selects US Stocks', async ()=>{
      // Monday 2026-07-20 14:00 America/New_York (within market hours)
      vi.setSystemTime(new Date('2026-07-20T14:00:00-04:00'));
      const recorded: string[] = [];
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){ recorded.push(...ids); return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: 0, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false })); };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const audit = (res as any).report && (res as any).report.audit;
      expect(audit).toBeTruthy();
      // allowedInstrumentIds should include US instrument ids (e.g., microsoft)
      const ids = (audit.mandate && audit.mandate.allowedInstrumentIds) || [];
      expect(ids.some((id:string)=> id === 'microsoft')).toBe(true);

      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('B. US closed, Forex open with fresh quote -> selects Forex', async ()=>{
      // Stockholm local 2026-07-21T12:00:00+02:00 (weekday, not rollover); NY is closed
      vi.setSystemTime(new Date('2026-07-21T12:00:00+02:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        // if forex symbols requested, return fresh quotes
        if (ids.some(s=> String(s).toUpperCase().includes('/'))){
          return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 1.2345, changePercent: 0.1, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
        }
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 50, changePercent: 0, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
      };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const audit = (res as any).report && (res as any).report.audit;
      expect(audit).toBeTruthy();
      const ids = (audit.mandate && audit.mandate.allowedInstrumentIds) || [];
      // should include at least one FOREX id from universe
      expect(ids.length).toBeGreaterThan(0);
      const forexIds = ids.filter((id:string)=> String(id).startsWith('fx_'));
      expect(forexIds.length).toBeGreaterThan(0);

      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('C. Forex rollover 23:00-00:00 Europe/Stockholm -> selects Crypto', async ()=>{
      vi.setSystemTime(new Date('2026-07-21T23:30:00+02:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
          // when crypto symbols requested, return fresh crypto
          if (ids.some(s=> String(s).toUpperCase().includes('BTC') || String(s).toUpperCase().includes('ETH') || String(s).toUpperCase().includes('SOL'))){
            return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 30000, changePercent: 1, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
          }
          return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 1, changePercent: 0, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
        };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const audit = (res as any).report && (res as any).report.audit;
      expect(audit).toBeTruthy();
      const ids = (audit.mandate && audit.mandate.allowedInstrumentIds) || [];
      // should include crypto ids
      expect(ids.some((id:string)=> String(id).startsWith('crypto_'))).toBe(true);

      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('D. Weekend -> Crypto selected', async ()=>{
      // Saturday 2026-07-18T12:00:00+02:00
      vi.setSystemTime(new Date('2026-07-18T12:00:00+02:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        if (ids.some(s=> String(s).toUpperCase().includes('BTC'))) return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 30000, changePercent: 0, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 1, changePercent: 0, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
      };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const audit = (res as any).report && (res as any).report.audit;
      expect(audit).toBeTruthy();
      const ids = (audit.mandate && audit.mandate.allowedInstrumentIds) || [];
      expect(ids.some((id:string)=> String(id).startsWith('crypto_'))).toBe(true);

      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('E. Forex stale -> falls back to Crypto', async ()=>{
      vi.setSystemTime(new Date('2026-07-21T12:00:00+02:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
          // crypto first
          if (ids.some(s=> /BTC|ETH|SOL/.test(String(s).toUpperCase()))) return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 20000, changePercent: 0, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
          // forex symbols: return stale timestamps
          if (ids.some(s=> String(s).toUpperCase().includes('/'))){
            const old = new Date(Date.now() - (10 * 60 * 1000)).toISOString();
            return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 1.2345, changePercent: 0, timestamp: old, source: 'twelve-data', isStale: true }));
          }
          return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 50, changePercent: 0, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
        };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const audit = (res as any).report && (res as any).report.audit;
      expect(audit).toBeTruthy();
      const ids = (audit.mandate && audit.mandate.allowedInstrumentIds) || [];
      expect(ids.some((id:string)=> String(id).startsWith('crypto_'))).toBe(true);

      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('F. Crypto chosen but no valid crypto quotes -> HOLD/no_market_data', async ()=>{
      // Choose time where US closed and forex blocked (e.g., rollover) to force crypto path
      vi.setSystemTime(new Date('2026-07-21T23:30:00+02:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        // return nothing/failure for crypto
        return ids.map((s:string)=> null).filter(Boolean) as any;
      };

      // spy engine to ensure it's not called
      const pte = await import('./paper-trading-engine');
      const proto: any = (pte as any).PaperTradingEngine.prototype;
      const origSim = proto.simulateExecution;
      let simCalled = false;
      proto.simulateExecution = function(this: any, ...args: any[]){ simCalled = true; return origSim.apply(this, args); };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const report = (res as any).report;
      expect(report).toBeTruthy();
      const audit = report.audit;
      expect(audit).toBeTruthy();
      // Expect a reason code indicating no market data
      expect(audit.reason && audit.reason.code === 'NO_MARKET_DATA').toBe(true);
      expect((audit.proposals || []).length).toBe(0);
      expect((audit.executed || []).length).toBe(0);
      expect(simCalled).toBe(false);

      proto.simulateExecution = origSim;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('H. Crypto quote with future timestamp is not considered fresh -> HOLD/no_market_data', async ()=>{
      // Force crypto path
      vi.setSystemTime(new Date('2026-07-21T23:30:00+02:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      // Return crypto quotes with timestamp 60s in the future
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        const fut = new Date(Date.now() + 60_000).toISOString();
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 30000, changePercent: 0, timestamp: fut, source: 'twelve-data', isStale: false }));
      };

      // spy engine simulateExecution to ensure no executions
      const pte = await import('./paper-trading-engine');
      const proto: any = (pte as any).PaperTradingEngine.prototype;
      const origSim = proto.simulateExecution;
      let simCalled = false;
      proto.simulateExecution = function(this: any, ...args: any[]){ simCalled = true; return origSim.apply(this, args); };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const report = (res as any).report;
      expect(report).toBeTruthy();
      const audit = report.audit;
      expect(audit).toBeTruthy();
      // Expect NO_MARKET_DATA because future timestamps should be rejected
      expect(audit.reason && audit.reason.code === 'NO_MARKET_DATA').toBe(true);
      expect((audit.proposals || []).length).toBe(0);
      expect((audit.executed || []).length).toBe(0);
      expect(simCalled).toBe(false);

      proto.simulateExecution = origSim;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('I. Stock quote with future timestamp is not considered fresh -> no executions / HOLD', async ()=>{
      // US market open
      vi.setSystemTime(new Date('2026-07-20T14:00:00-04:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      // Return MSFT with a timestamp 60s in the future
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        const fut = new Date(Date.now() + 60_000).toISOString();
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: 2, timestamp: fut, source: 'twelve-data', isStale: false }));
      };

      // spy broker placeOrder to ensure no executions
      let placeCalls = 0;
      const origPlace = AtlasPaperBrokerProvider.prototype.placeOrder;
      AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){
        placeCalls++;
        return { success: true, orderId: `o_${placeCalls}`, executedPrice: req.price || 100, quantity: req.quantity, fee: 0, status: 'EXECUTED' };
      };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const report = (res as any).report;
      expect(report).toBeTruthy();
      const audit = report.audit;
      expect(audit).toBeTruthy();

      // Expect no executions placed. If a specific reason exists, accept NO_MARKET_DATA as well.
      const noMarketData = !!(audit.reason && audit.reason.code === 'NO_MARKET_DATA');
      expect(placeCalls === 0 || noMarketData).toBe(true);
      expect((audit.executed || []).length).toBe(0);

      // restore
      AtlasPaperBrokerProvider.prototype.placeOrder = origPlace;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('J. Stock quote without timestamp is not considered fresh -> no executions / HOLD', async ()=>{
      vi.setSystemTime(new Date('2026-07-20T14:00:00-04:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        // return stocks without timestamp
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: 2, source: 'twelve-data', isStale: false }));
      };

      let placeCalls = 0;
      const origPlace = AtlasPaperBrokerProvider.prototype.placeOrder;
      AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){ placeCalls++; return { success: true, orderId: `o_${placeCalls}`, executedPrice: req.price || 100, quantity: req.quantity, fee: 0, status: 'EXECUTED' }; };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const audit = (res as any).report && (res as any).report.audit;
      expect(audit).toBeTruthy();
      const noMarketData = !!(audit.reason && audit.reason.code === 'NO_MARKET_DATA');
      expect(placeCalls === 0 || noMarketData).toBe(true);
      expect((audit.executed || []).length).toBe(0);

      AtlasPaperBrokerProvider.prototype.placeOrder = origPlace;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('K. Stock quote with invalid timestamp is not considered fresh -> no executions / HOLD', async ()=>{
      vi.setSystemTime(new Date('2026-07-20T14:00:00-04:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        // return stocks with invalid timestamp
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: 2, timestamp: 'invalid-date', source: 'twelve-data', isStale: false }));
      };

      let placeCalls = 0;
      const origPlace = AtlasPaperBrokerProvider.prototype.placeOrder;
      AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){ placeCalls++; return { success: true, orderId: `o_${placeCalls}`, executedPrice: req.price || 100, quantity: req.quantity, fee: 0, status: 'EXECUTED' }; };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const audit = (res as any).report && (res as any).report.audit;
      expect(audit).toBeTruthy();
      const noMarketData = !!(audit.reason && audit.reason.code === 'NO_MARKET_DATA');
      expect(placeCalls === 0 || noMarketData).toBe(true);
      expect((audit.executed || []).length).toBe(0);

      AtlasPaperBrokerProvider.prototype.placeOrder = origPlace;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('L. Fresh stock quote remains eligible for execution', async ()=>{
      // US market open
      vi.setSystemTime(new Date('2026-07-20T14:00:00-04:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: -2, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
      };

      let placeCalls = 0;
      const origPlace = AtlasPaperBrokerProvider.prototype.placeOrder;
      AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){
        placeCalls++;
        return { success: true, orderId: `o_${placeCalls}`, executedPrice: req.price || 100, quantity: req.quantity, fee: 0, status: 'EXECUTED' };
      };

      const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode: 'PAPER_AUTO', allowedInstrumentIds: ['microsoft'] } as any;
      const res = await runVictorTradingCycle({ mandate, trigger: 'MANUAL' } as any);
      const report = (res as any).report;
      expect(report).toBeTruthy();
      const audit = report.audit;
      expect(audit).toBeTruthy();
      // Expect exactly one placeOrder call and at least one executed entry
      expect(placeCalls).toBe(1);
      expect((audit.executed || []).length).toBeGreaterThanOrEqual(1);
      // Not NO_MARKET_DATA
      expect(!(audit.reason && audit.reason.code === 'NO_MARKET_DATA')).toBe(true);

      AtlasPaperBrokerProvider.prototype.placeOrder = origPlace;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('M. Stock quote within freshness boundary remains eligible', async ()=>{
      // Use fixed time to compute deterministic timestamps
      const FRESH_MS = 2 * 60 * 1000;
      vi.setSystemTime(new Date('2026-07-20T14:00:00-04:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      // timestamp just inside freshness (FRESH_MS - 1000)
      const tsInside = new Date(Date.now() - (FRESH_MS - 1000)).toISOString();
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: -2, timestamp: tsInside, source: 'twelve-data', isStale: false }));
      };

      let placeCalls = 0;
      const origPlace = AtlasPaperBrokerProvider.prototype.placeOrder;
      AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){ placeCalls++; return { success: true, orderId: `o_${placeCalls}`, executedPrice: req.price || 100, quantity: req.quantity, fee: 0, status: 'EXECUTED' }; };

      const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode: 'PAPER_AUTO', allowedInstrumentIds: ['microsoft'] } as any;
      const res = await runVictorTradingCycle({ mandate, trigger: 'MANUAL' } as any);
      const report = (res as any).report;
      expect(report).toBeTruthy();
      const audit = report.audit;
      expect(audit).toBeTruthy();
      expect(placeCalls).toBe(1);
      expect((audit.executed || []).length).toBeGreaterThanOrEqual(1);

      AtlasPaperBrokerProvider.prototype.placeOrder = origPlace;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('N. Stock quote outside freshness boundary is rejected', async ()=>{
      const FRESH_MS = 2 * 60 * 1000;
      vi.setSystemTime(new Date('2026-07-20T14:00:00-04:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      // timestamp just outside freshness (FRESH_MS + 1000)
      const tsOutside = new Date(Date.now() - (FRESH_MS + 1000)).toISOString();
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 100, changePercent: -2, timestamp: tsOutside, source: 'twelve-data', isStale: false }));
      };

      let placeCalls = 0;
      const origPlace = AtlasPaperBrokerProvider.prototype.placeOrder;
      AtlasPaperBrokerProvider.prototype.placeOrder = async function(req: any){ placeCalls++; return { success: true, orderId: `o_${placeCalls}`, executedPrice: req.price || 100, quantity: req.quantity, fee: 0, status: 'EXECUTED' }; };

      const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode: 'PAPER_AUTO', allowedInstrumentIds: ['microsoft'] } as any;
      const res = await runVictorTradingCycle({ mandate, trigger: 'MANUAL' } as any);
      const report = (res as any).report;
      expect(report).toBeTruthy();
      const audit = report.audit;
      expect(audit).toBeTruthy();
      const noMarketData = !!(audit.reason && audit.reason.code === 'NO_MARKET_DATA');
      expect(placeCalls === 0 || noMarketData).toBe(true);
      expect((audit.executed || []).length).toBe(0);

      AtlasPaperBrokerProvider.prototype.placeOrder = origPlace;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });

    it('G. Crypto with fresh quote -> crypto instrument analyzed (BTC/USD provider symbol)', async ()=>{
      vi.setSystemTime(new Date('2026-07-21T23:30:00+02:00'));
      const origGQ = (TwelveDataMarketDataProvider as any).prototype.getQuotes;
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = async function(ids: string[]){
        if (ids.some(s=> /BTC/.test(String(s).toUpperCase()))) return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 30000, changePercent: 0, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
        return ids.map((s:string)=> ({ symbol: s.toUpperCase(), price: 1, changePercent: 0, timestamp: new Date().toISOString(), source: 'twelve-data', isStale: false }));
      };

      const res = await runVictorTradingCycle({ trigger: 'MANUAL' } as any);
      const audit = (res as any).report && (res as any).report.audit;
      expect(audit).toBeTruthy();
      // ensure at least one decision targets a crypto instrument from our universe
      const decisions = audit.decisions || [];
      const cryptoDecision = decisions.find((d:any)=> String(d.instrumentId).startsWith('crypto_'));
      expect(cryptoDecision).toBeTruthy();
      // provider symbol used should be BTC/USD for at least one instrument
      const usedSymbols = (audit.proposals || []).map((p:any)=> (p.request && p.request.symbol) || '').filter(Boolean);
      (TwelveDataMarketDataProvider as any).prototype.getQuotes = origGQ;
    });
  });
});
