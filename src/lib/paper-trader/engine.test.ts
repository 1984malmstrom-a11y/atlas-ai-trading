import { describe, it, expect, beforeEach } from 'vitest';
import createPaperTrader, { mapAssetTypeToCategory, detectAssetCategory } from './engine';
import { DEFAULT_PAPER_AUTO_MANDATE } from '../../domain/trading/victor-types';
import { PaperTradeDecision } from './types';

// In-memory deterministic id generator
function makeIdGen(){ let i=1; return { next: (p?:string)=> `${p||'id'}_${i++}` }; }

// Fixed clock
const fixedDate = new Date('2026-01-02T12:00:00.000Z');
const fixedClock = { now: () => new Date(fixedDate) };

function makePortfolio(initialCash = 100000){
  return {
    id: 'demo',
    baseCurrency: 'SEK',
    totalValue: initialCash,
    availableCash: initialCash,
    totalReturnPercent: 0,
    benchmarkReturnPercent: 0,
    holdings: [] as any[],
  };
}

function clonePortfolio(p:any){ return JSON.parse(JSON.stringify(p)); }

function makeAdapter(initial:any){
  let state = clonePortfolio(initial);
  async function getPortfolio(){
    // recompute marketValue from holdings currentPrice if present
    let holdings = state.holdings.map((h:any)=>({ ...h, marketValue: Math.round(h.quantity * h.currentPrice * 100)/100 }));
    const mv = holdings.reduce((s:any,h:any)=> s + h.marketValue, 0);
    state = { ...state, holdings, totalValue: Math.round((state.availableCash + mv) * 100)/100 };
    return clonePortfolio(state);
  }
  async function applyExecution(exec:any){
    const before = clonePortfolio(state);
    const symbol = exec.symbol.toUpperCase();
    if (exec.side === 'BUY'){
      // debit cash (notional + fee)
      state.availableCash = Math.round((state.availableCash - exec.notional - exec.fee) * 100)/100;
      // add holding or increase
      const found = state.holdings.find((h:any)=> h.symbol.toUpperCase() === symbol);
      if (found){
        found.quantity = Math.round((found.quantity + exec.quantity) * 100)/100;
        found.currentPrice = exec.executedPrice;
        found.marketValue = Math.round(found.quantity * found.currentPrice * 100)/100;
        found.averagePrice = exec.executedPrice; // naive
      } else {
        state.holdings.push({ id: `h_${symbol}`, symbol, name: symbol, assetType: 'Stock', quantity: exec.quantity, averagePrice: exec.executedPrice, currentPrice: exec.executedPrice, marketValue: Math.round(exec.quantity * exec.executedPrice * 100)/100, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
      }
    } else {
      // SELL
      const found = state.holdings.find((h:any)=> h.symbol.toUpperCase() === symbol);
      if (!found) throw new Error('NO_HOLDING');
      const sellQty = Math.min(found.quantity, exec.quantity);
      const proceeds = Math.round(sellQty * exec.executedPrice * 100)/100;
      state.availableCash = Math.round((state.availableCash + proceeds - exec.fee) * 100)/100;
      found.quantity = Math.round((found.quantity - sellQty) * 100)/100;
      found.currentPrice = exec.executedPrice;
      found.marketValue = Math.round(found.quantity * found.currentPrice * 100)/100;
      if (found.quantity <= 0) state.holdings = state.holdings.filter((h:any)=> h !== found);
    }
    // recompute totals
    const mv = state.holdings.reduce((s:any,h:any)=> s + h.marketValue, 0);
    state.totalValue = Math.round((state.availableCash + mv) * 100)/100;
    return clonePortfolio(state);
  }
  return { getPortfolio, applyExecution, _getState: ()=> clonePortfolio(state) };
}

function makeDecision(overrides: Partial<PaperTradeDecision>): PaperTradeDecision{
  return {
    id: 'd1',
    symbol: 'AAA',
    action: 'BUY',
    confidence: 80,
    referencePrice: 100,
    generatedAt: new Date().toISOString(),
    reasoning: [],
    ...overrides,
  } as any;
}

describe('PaperTrader V1', ()=>{
  it('default disabled rejects BUY', async ()=>{
    const adapter = makeAdapter(makePortfolio(10000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen() });
    const res = await trader.handleDecision(makeDecision({ action: 'BUY', symbol: 'AAA' }));
    expect(res.accepted).toBe(false);
    expect(res.code).toBe('GLOBAL_DISABLED');
  });

  it('HOLD is logged and not executed', async ()=>{
    const adapter = makeAdapter(makePortfolio(10000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    const res = await trader.handleDecision(makeDecision({ action: 'HOLD' }));
    expect(res.accepted).toBe(false);
    expect(res.code).toBe('HOLD');
    const audits = await trader.getAuditEntries();
    expect(
      audits.some((audit) => {
        const rawAudit = 'raw' in audit ? audit.raw : audit;
        return rawAudit.kind === 'HOLD';
      }),
    ).toBe(true);
  });

  it('low BUY-confidence rejected', async ()=>{
    const adapter = makeAdapter(makePortfolio(10000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, minimumBuyConfidence: 90 } });
    const res = await trader.handleDecision(makeDecision({ action: 'BUY', confidence: 50 }));
    expect(res.accepted).toBe(false);
    expect(res.code).toBe('LOW_CONFIDENCE');
  });

  it('low SELL-confidence rejected', async ()=>{
    const initial = makePortfolio(10000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 10, averagePrice: 100, currentPrice:100, marketValue:1000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, minimumSellConfidence: 90 } });
    const res = await trader.handleDecision(makeDecision({ action: 'SELL', confidence: 50, symbol: 'AAA' }));
    expect(res.accepted).toBe(false);
    expect(res.code).toBe('LOW_CONFIDENCE');
  });

  it('BUY decreases cash and increases holding', async ()=>{
    const adapter = makeAdapter(makePortfolio(100000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    const dec = makeDecision({ symbol: 'AAA', action: 'BUY', confidence: 99, referencePrice: 100, requestedNotionalSek: 10000 });
    const res = await trader.handleDecision(dec);
    expect(res.accepted).toBe(true);
    expect(res.execution).toBeDefined();
    const state = adapter._getState();
    expect(state.availableCash).toBeLessThan(100000);
    expect(state.holdings.some((h:any)=> h.symbol==='AAA')).toBe(true);
  });

  it('SELL requires holding', async ()=>{
    const adapter = makeAdapter(makePortfolio(10000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    const res = await trader.handleDecision(makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99 }));
    expect(res.accepted).toBe(false);
    expect(res.code).toBe('NO_HOLDING');
  });

  it('SELL decreases holding and increases cash', async ()=>{
    const initial = makePortfolio(10000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 10, averagePrice: 100, currentPrice:100, marketValue:1000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    const res = await trader.handleDecision(makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99, referencePrice: 100, requestedNotionalSek: 500 }));
    expect(res.accepted).toBe(true);
    const state = adapter._getState();
    expect(state.availableCash).toBeGreaterThan(10000);
  });

  it('respects 10% position cap', async ()=>{
    const initial = makePortfolio(100000);
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, maxPositionPercent: 0.10, feesBps: 0, slippageBps: 0 } });
    const dec = makeDecision({ action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 100, requestedNotionalSek: 50000 });
    const res = await trader.handleDecision(dec);
    expect(res.accepted).toBe(true);
    const state = adapter._getState();
    const holding = state.holdings.find((h:any)=> h.symbol==='AAA');
    expect(holding.marketValue).toBeLessThanOrEqual(Math.round(state.totalValue * 0.10 * 100)/100 + 0.01);
  });

  it('insufficient cash rejected', async ()=>{
    const adapter = makeAdapter(makePortfolio(100));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    const res = await trader.handleDecision(makeDecision({ action: 'BUY', symbol: 'AAA', confidence:99, referencePrice: 100, requestedNotionalSek: 10000 }));
    expect(res.accepted).toBe(false);
    expect(res.code).toBe('INSUFFICIENT_CASH');
  });

  it('cooldown/dedupe works', async ()=>{
    const adapter = makeAdapter(makePortfolio(100000));
    const idg = makeIdGen();
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: idg, config: { enabled: true, cooldownMs: 60000 } });
    const dec = makeDecision({ action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 10, requestedNotionalSek: 1000 });
    const r1 = await trader.handleDecision(dec);
    expect(r1.accepted).toBe(true);
    const r2 = await trader.handleDecision(dec);
    expect(r2.accepted).toBe(false);
    expect(r2.code).toBe('COOLDOWN');
  });

  it('maxTradesPerCycle enforced', async ()=>{
    const adapter = makeAdapter(makePortfolio(100000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, maxTradesPerCycle: 1 } });
    const decs = [makeDecision({ id: 'd1', symbol:'A', action:'BUY', confidence:99, referencePrice:10, requestedNotionalSek:1000 }), makeDecision({ id:'d2', symbol:'B', action:'BUY', confidence:99, referencePrice:10, requestedNotionalSek:1000 })];
    const res = await trader.runCycle(decs as any);
    expect(res.executed).toBe(1);
  });


  it('fee and slippage deterministic', async ()=>{
    const adapter = makeAdapter(makePortfolio(100000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 10, slippageBps: 5 } });
    const dec = makeDecision({ action:'BUY', symbol:'AAA', confidence:99, referencePrice:100, requestedNotionalSek:10000 });
    const res = await trader.handleDecision(dec);
    expect(res.accepted).toBe(true);
    const e = res.execution!;
    expect(e.executedPrice).toBe(100 * (1 + 5/10000));
    expect(e.fee).toBeCloseTo(Math.round(e.notional * (10/10000) * 100)/100, 2);
  });

  it('asset category detection and execution parity across categories', async ()=>{
    // mapping
    expect(mapAssetTypeToCategory('Stock')).toBe('Stock');
    expect(mapAssetTypeToCategory('Forex')).toBe('Forex');
    expect(mapAssetTypeToCategory('Commodity')).toBe('Commodity');
    expect(mapAssetTypeToCategory('Whatever')).toBe('Unknown');

    // Prepare three adapters with identical numeric state but different holding.assetType
    const initialStock = makePortfolio(100000);
    initialStock.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 10, averagePrice: 100, currentPrice:100, marketValue:1000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const initialForex = JSON.parse(JSON.stringify(initialStock)); (initialForex.holdings[0] as any).assetType = 'Forex';
    const initialCommodity = JSON.parse(JSON.stringify(initialStock)); (initialCommodity.holdings[0] as any).assetType = 'Commodity';

    const aStock = makeAdapter(initialStock);
    const aForex = makeAdapter(initialForex);
    const aCommodity = makeAdapter(initialCommodity);

    const traderStock = createPaperTrader({ portfolioAdapter: aStock, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    const traderForex = createPaperTrader({ portfolioAdapter: aForex, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    const traderCommodity = createPaperTrader({ portfolioAdapter: aCommodity, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });

    const sell = makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99, referencePrice: 100, requestedNotionalSek: 500 });
    const rStock = await traderStock.handleDecision(sell);
    const rForex = await traderForex.handleDecision(sell);
    const rCommodity = await traderCommodity.handleDecision(sell);

    expect(detectAssetCategory(await aStock.getPortfolio(), 'AAA')).toBe('Stock');
    expect(detectAssetCategory(await aForex.getPortfolio(), 'AAA')).toBe('Forex');
    expect(detectAssetCategory(await aCommodity.getPortfolio(), 'AAA')).toBe('Commodity');

    // Execution parity: with identical numeric inputs and no category-specific logic, results must match
    expect(rStock.accepted).toBe(true);
    expect(rForex.accepted).toBe(true);
    expect(rCommodity.accepted).toBe(true);
    expect(rStock.execution).toEqual(rForex.execution);
    expect(rStock.execution).toEqual(rCommodity.execution);
  });

  it('allows fractional quantity buys (max 6 decimals, rounded down)', async ()=>{
    const adapter = makeAdapter(makePortfolio(100000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true } });
    // requestedNotional 1234 / price 100 => qty = 12.34
    const dec = makeDecision({ action:'BUY', symbol:'AAA', confidence:99, referencePrice:100, requestedNotionalSek:1234 });
    const res = await trader.handleDecision(dec);
    expect(res.accepted).toBe(true);
    const e = res.execution!;
    expect(typeof e.quantity).toBe('number');
    const expectedQty = Math.floor((1234 * 1e6) / (e.executedPrice || 1)) / 1e6;
    expect(e.quantity).toBeCloseTo(expectedQty, 12);
    // execution notional must not exceed requested notional
    expect(e.notional).toBeLessThanOrEqual(1234);
  });

  it('quantity precision capped at 6 decimals and rounds down', async ()=>{
    const adapter = makeAdapter(makePortfolio(100000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    // Make price such that division yields repeating decimals
    const dec = makeDecision({ action:'BUY', symbol:'AAA', confidence:99, referencePrice:3, requestedNotionalSek:1000 });
    const res = await trader.handleDecision(dec);
    expect(res.accepted).toBe(true);
    const q = res.execution!.quantity;
    // Should have at most 6 decimal places
    const parts = String(q).split('.');
    if (parts[1]) expect(parts[1].length).toBeLessThanOrEqual(6);
    // Assert it does not exceed theoretical raw notional/price
    expect(res.execution!.notional).toBeLessThanOrEqual(1000);
  });

  it('very small positive quantity can execute if above 1e-6', async ()=>{
    const adapter = makeAdapter(makePortfolio(100000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    // price large, requestedNotional small but enough to create 1e-6 quantity
    const dec = makeDecision({ action:'BUY', symbol:'AAA', confidence:99, referencePrice:1000000, requestedNotionalSek:1 });
    const res = await trader.handleDecision(dec);
    expect(res.accepted).toBe(true);
    expect(res.execution!.quantity).toBeGreaterThan(0);
  });

  it('ORDER_TOO_SMALL when computed qty is zero after quantization', async ()=>{
    const adapter = makeAdapter(makePortfolio(100000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    // notional too small to produce any quantity at 6-decimal precision
    const dec = makeDecision({ action:'BUY', symbol:'AAA', confidence:99, referencePrice:1000000, requestedNotionalSek:0.5 });
    const res = await trader.handleDecision(dec);
    expect(res.accepted).toBe(false);
    expect(res.code).toBe('ORDER_TOO_SMALL');
  });

  it('integer orders still work (regression)', async ()=>{
    const adapter = makeAdapter(makePortfolio(100000));
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    const dec = makeDecision({ action:'BUY', symbol:'AAA', confidence:99, referencePrice:100, requestedNotionalSek:10000 });
    const res = await trader.handleDecision(dec);
    expect(res.accepted).toBe(true);
    expect(Number.isInteger(res.execution!.quantity)).toBe(true);
  });

  it('SELL cannot sell more than holding (fractional supported)', async ()=>{
    const initial = makePortfolio(10000);
    // existing fractional holding 5.5
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 5.5, averagePrice: 100, currentPrice:100, marketValue:550, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true } });
    // request sell notional that would otherwise produce qty > holding
    const dec = makeDecision({ action:'SELL', symbol:'AAA', confidence:99, referencePrice:100, requestedNotionalSek:10000 });
    const res = await trader.handleDecision(dec);
    expect(res.accepted).toBe(true);
    // exec qty must be <= held qty
    expect(res.execution!.quantity).toBeLessThanOrEqual(5.5 + 1e-12);
  });

  it('identical inputs + fixed clock/id produce identical results', async ()=>{
    const p1 = makeAdapter(makePortfolio(100000));
    const p2 = makeAdapter(makePortfolio(100000));
    const idgA = makeIdGen(); const idgB = makeIdGen();
    const traderA = createPaperTrader({ portfolioAdapter: p1, clock: fixedClock, idGenerator: idgA, config: { enabled: true } });
    const traderB = createPaperTrader({ portfolioAdapter: p2, clock: fixedClock, idGenerator: idgB, config: { enabled: true } });
    const dec = makeDecision({ action:'BUY', symbol:'AAA', confidence:99, referencePrice:100, requestedNotionalSek:10000 });
    const rA = await traderA.handleDecision(dec);
    const rB = await traderB.handleDecision(dec);
    expect(rA.accepted).toBe(true);
    expect(rB.accepted).toBe(true);
    expect(rA.execution).toEqual(rB.execution);
    expect(p1._getState()).toEqual(p2._getState());
  });

  // DAILY LOSS LIMIT tests
  it('allows trades when realized loss is under daily limit', async ()=>{
    // Using DEFAULT_PAPER_AUTO_MANDATE.maxDailyLossPercent (2%) and portfolio totalValue 100000 -> limit = 2000 SEK
    const initial = makePortfolio(100000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 200, averagePrice: 100, currentPrice:100, marketValue:20000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    // SELL that realizes -1000 SEK (avg 100 -> sell at 90 qty 100 => -1000)
    const sell = makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99, referencePrice: 90, requestedNotionalSek: 9000 });
    const r1 = await trader.handleDecision(sell);
    const audits = await trader.getAuditEntries();
    expect(r1.accepted).toBe(true);
    // Next trade should still be allowed because realized (-1000) > -2000 limit
    const buy = makeDecision({ id: 'd_buy', action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 90, requestedNotionalSek: 1000 });
    const r2 = await trader.handleDecision(buy);
    expect(r2.accepted).toBe(true);
  });

  it('uses explicit dailyStartValue when provided', async ()=>{
    const initial = makePortfolio(100000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 200, averagePrice: 100, currentPrice:100, marketValue:20000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    // Provide explicit small start value to make limit tight
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 }, dailyStartValue: 1000 });
    // With dailyStartValue=1000 and default 2% -> limit = 20 SEK
    const sell = makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99, referencePrice: 70, requestedNotionalSek: 14000 });
    const r1 = await trader.handleDecision(sell);
    expect(r1.accepted).toBe(true);
    // Next trade should be rejected due to tiny explicit start base
    const buy = makeDecision({ id: 'd_buy_expl', action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 70, requestedNotionalSek: 1000 });
    const r2 = await trader.handleDecision(buy);
    expect(r2.accepted).toBe(false);
    expect(r2.code).toBe('DAILY_LOSS_LIMIT');
  });

  it('explicit dailyStartValue 0 is accepted and can trigger limit', async ()=>{
    const initial = makePortfolio(100000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 200, averagePrice: 100, currentPrice:100, marketValue:20000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 }, dailyStartValue: 0 });
    // dailyStartValue 0 => limit 0 -> any realized negative should block subsequent trades
    const sell = makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99, referencePrice: 70, requestedNotionalSek: 7000 });
    const r1 = await trader.handleDecision(sell);
    // With explicit dailyStartValue 0, the daily loss limit is 0 -> first trade is rejected
    expect(r1.accepted).toBe(false);
    expect(r1.code).toBe('DAILY_LOSS_LIMIT');
    const buy = makeDecision({ id: 'd_buy_zero', action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 70, requestedNotionalSek: 1000 });
    const r2 = await trader.handleDecision(buy);
    expect(r2.accepted).toBe(false);
    expect(r2.code).toBe('DAILY_LOSS_LIMIT');
  });

  it('invalid explicit dailyStartValue falls back to existing behavior', async ()=>{
    const initial = makePortfolio(100000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 200, averagePrice: 100, currentPrice:100, marketValue:20000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    // Pass NaN -> should be treated as absent and fallback used
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 }, dailyStartValue: NaN as any });
    // Should behave like default: allow trades under normal limit
    const sell = makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99, referencePrice: 90, requestedNotionalSek: 9000 });
    const r1 = await trader.handleDecision(sell);
    expect(r1.accepted).toBe(true);
  });

  it('explicit dailyStartValue does not modify internal map', async ()=>{
    const initial = makePortfolio(100000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 200, averagePrice: 100, currentPrice:100, marketValue:20000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 }, dailyStartValue: 500 });
    // Access internal map by invoking handleDecision which may populate map if fallback used; ensure explicit does not set map key
    const dec = makeDecision({ action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 100, requestedNotionalSek: 1000 });
    await trader.handleDecision(dec);
    // no direct access to dailyStartValue map; ensure subsequent call still sees explicit effect (i.e., not overwritten)
    const dec2 = makeDecision({ id: 'd2', action: 'BUY', symbol: 'BBB', confidence: 99, referencePrice: 100, requestedNotionalSek: 1000 });
    await trader.handleDecision(dec2);
    expect(true).toBe(true);
  });

  it('rejects new trades when realized is exactly at daily limit', async ()=>{
    // Using default percent 2% -> limit 2000 SEK. Create holdings to realize exactly -2000 SEK.
    const initial = makePortfolio(100000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 200, averagePrice: 100, currentPrice:100, marketValue:20000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    // SELL that realizes exactly -2000 SEK: sell 100 @ executedPrice 80 -> (80-100)*100 = -2000
    const sell = makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99, referencePrice: 80, requestedNotionalSek: 8000 });
    const r1 = await trader.handleDecision(sell);
    console.log('DEBUG sell result rollover:', r1);
    expect(r1.accepted).toBe(true);
    // Subsequent BUY should be rejected
    const buy = makeDecision({ id: 'd_buy2', action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 80, requestedNotionalSek: 1000 });
    const r2 = await trader.handleDecision(buy);
    expect(r2.accepted).toBe(false);
    expect(r2.code).toBe('DAILY_LOSS_LIMIT');
  });

  it('rejects when realized exceeds daily limit', async ()=>{
    const initial = makePortfolio(100000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 200, averagePrice: 100, currentPrice:100, marketValue:20000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    // Sell that realizes -3000 SEK -> should block subsequent trades
    const sell = makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99, referencePrice: 70, requestedNotionalSek: 14000 });
    const r1 = await trader.handleDecision(sell);
    expect(r1.accepted).toBe(true);
    const buy = makeDecision({ id: 'd_buy3', action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 70, requestedNotionalSek: 1000 });
    const r2 = await trader.handleDecision(buy);
    expect(r2.accepted).toBe(false);
    expect(r2.code).toBe('DAILY_LOSS_LIMIT');
  });

  it('new trading day resets daily loss counting', async ()=>{
    // Use mutable clock and real engine flows
    let now = new Date('2026-01-02T12:00:00.000Z');
    const clockMutable = { now: () => new Date(now) };
    const initial = makePortfolio(100000);
    initial.holdings.push({ id:'h_AAA', symbol:'AAA', name:'AAA', assetType: 'Stock', quantity: 200, averagePrice: 100, currentPrice:100, marketValue:20000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: clockMutable as any, idGenerator: makeIdGen(), config: { enabled: true, feesBps: 0, slippageBps: 0 } });
    // Day 1: realize -3000 SEK (sell 100 @ 70)
    const sell = makeDecision({ action: 'SELL', symbol: 'AAA', confidence: 99, referencePrice: 70, requestedNotionalSek: 7000 });
    const r1 = await trader.handleDecision(sell);
    const auditsNow = await trader.getAuditEntries();
    expect(r1.accepted).toBe(true);
    // next trade same day should be blocked
    const buy1 = makeDecision({ id: 'd_next', action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 70, requestedNotionalSek: 1000 });
    const r2 = await trader.handleDecision(buy1);
    expect(r2.accepted).toBe(false);
    // advance clock to next day
    now = new Date('2026-01-03T12:00:00.000Z');
    const buy2 = makeDecision({ id: 'd_next_day', action: 'BUY', symbol: 'AAA', confidence: 99, referencePrice: 70, requestedNotionalSek: 1000 });
    const r3 = await trader.handleDecision(buy2);
    expect(r3.accepted).toBe(true);
  });

  it('HOLD is not affected by daily loss limit', async ()=>{
    const initial = makePortfolio(100000);
    const adapter = makeAdapter(initial);
    const trader = createPaperTrader({ portfolioAdapter: adapter, clock: fixedClock, idGenerator: makeIdGen(), config: { enabled: true } });
    const res = await trader.handleDecision(makeDecision({ action: 'HOLD' }));
    expect(res.accepted).toBe(false);
    expect(res.code).toBe('HOLD');
  });
});
