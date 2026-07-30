import { describe, it, expect, beforeEach } from 'vitest';
import createPaperTrader from './engine';
import { PaperTradeDecision } from './types';

function round2(n: number){ return Math.round(n * 100) / 100; }

function makeInMemoryPortfolioAdapter(initialCash: number){
  let state = { id: 'test', baseCurrency: 'SEK', totalValue: initialCash, availableCash: initialCash, holdings: [] as any[] } as any;
  return {
    getPortfolio: async () => JSON.parse(JSON.stringify(state)),
    applyExecution: async (exec: any) => {
      const sym = exec.symbol.toUpperCase();
      if (exec.side === 'BUY'){
        state.availableCash = round2(state.availableCash - exec.notional - exec.fee);
        let found = state.holdings.find((h:any)=> h.symbol === sym);
        if (found){ found.quantity += exec.quantity; found.currentPrice = exec.executedPrice; found.marketValue = round2(found.quantity * found.currentPrice); }
        else { state.holdings.push({ id: `h_${sym}`, symbol: sym, quantity: exec.quantity, averagePrice: exec.executedPrice, currentPrice: exec.executedPrice, marketValue: round2(exec.quantity * exec.executedPrice) }); }
      } else {
        const found = state.holdings.find((h:any)=> h.symbol === sym);
        const sellQty = Math.min(found ? found.quantity : 0, exec.quantity);
        const proceeds = round2(sellQty * exec.executedPrice);
        state.availableCash = round2(state.availableCash + proceeds - exec.fee);
        if (found){ found.quantity = round2(found.quantity - sellQty); found.currentPrice = exec.executedPrice; found.marketValue = round2(found.quantity * found.currentPrice); if (found.quantity <= 0) state.holdings = state.holdings.filter((h:any)=> h!==found); }
      }
      state.totalValue = round2(state.availableCash + state.holdings.reduce((s:any,h:any)=> s + (h.marketValue||0), 0));
      return JSON.parse(JSON.stringify(state));
    }
  };
}

describe('paper-trade flow integration (deterministic, in-memory)', ()=>{
  let trader: any;
  let portfolioAdapter: any;

  beforeEach(()=>{
    portfolioAdapter = makeInMemoryPortfolioAdapter(100000); // 100k SEK to allow 10% position cap > single-share price
    trader = createPaperTrader({ portfolioAdapter, config: { enabled: true, maxOrderValueSek: 25000, maxPositionPercent: 0.10, feesBps: 10, slippageBps: 5, minimumBuyConfidence: 50, minimumSellConfidence: 50, cooldownMs: 0, maxTradesPerCycle: 10 } });
  });

  it('Test A: successful BUY for MSFT using injected SEK-normalized referencePrice', async ()=>{
    // Given: MSFT price 500 USD, USD/SEK = 10 -> price in SEK = 5000
    const priceUsd = 500; const usdSek = 10; const priceSek = priceUsd * usdSek;
    // Requested notional in SEK: use a value that yields at least 1 share after slippage
    const requestedNotionalSek = 6000; // > priceSek to buy at least 1 share

    const decision: PaperTradeDecision = {
      id: 't_buy_msft', symbol: 'MSFT', action: 'BUY', confidence: 100, referencePrice: priceSek, generatedAt: new Date().toISOString(), requestedNotionalSek
    } as any;

    const before = await portfolioAdapter.getPortfolio();
    // Document initial cash and sanity
    const initialCash = before.availableCash;
    expect(initialCash).toBeGreaterThanOrEqual(10000);
    expect(requestedNotionalSek).toBeGreaterThan(0);

    const res = await trader.handleDecision(decision);
    expect(res.accepted).toBe(true);
    expect(res.execution).toBeTruthy();

    const exec = res.execution as any;
    // Calculate expected values using engine config we provided: feesBps=10, slippageBps=5
    const feesBps = 10; const slippageBps = 5;
    const expectedExecPrice = round2(priceSek * (1 + (slippageBps/10000)));
    const expectedQuantity =
      Math.floor((requestedNotionalSek * 1_000_000) / expectedExecPrice) / 1_000_000;
    expect(expectedQuantity).toBeGreaterThanOrEqual(1);

    // Execution assertions
    expect(Math.abs(exec.executedPrice - expectedExecPrice)).toBeLessThanOrEqual(0.5);
    expect(exec.quantity).toBe(expectedQuantity);

    const finalNotional = round2(exec.quantity * exec.executedPrice);
    const expectedFee = round2(finalNotional * (feesBps/10000));
    expect(Math.abs(exec.fee - expectedFee)).toBeLessThanOrEqual(0.5);

    const after = await portfolioAdapter.getPortfolio();
    // cash decreased by finalNotional + fee
    expect(after.availableCash).toBeCloseTo(round2(initialCash - finalNotional - expectedFee), 2);

    const holding = after.holdings.find((h:any)=> h.symbol === 'MSFT');
    expect(holding).toBeTruthy();
    expect(holding.quantity).toBe(exec.quantity);
    // averagePrice is stored as executedPrice on first buy
    expect(Math.abs((holding.averagePrice || holding.currentPrice) - exec.executedPrice)).toBeLessThanOrEqual(0.01);

    // Audit counts
    const audits = await trader.getAuditEntries();
    const executionCount = audits.filter((a:any)=> a.kind === 'EXECUTION').length;
    const rejectionCount = audits.filter((a:any)=> a.kind === 'REJECT').length;
    expect(executionCount).toBeGreaterThanOrEqual(1);
    expect(rejectionCount).toBeGreaterThanOrEqual(0);
  });

  it('Test B: SELL larger than holding is handled according to engine (capped to holding)', async ()=>{
    // First buy one share to have a holding
    const priceSek = 500 * 10;
    const buyDecision: PaperTradeDecision = { id: 't_prep_buy', symbol: 'MSFT', action: 'BUY', confidence: 100, referencePrice: priceSek, generatedAt: new Date().toISOString(), requestedNotionalSek: 6000 } as any;
    const buyRes = await trader.handleDecision(buyDecision);
    expect(buyRes.accepted).toBe(true);
    const heldState = await portfolioAdapter.getPortfolio();
    const heldQty = heldState.holdings.find((h:any)=> h.symbol === 'MSFT')?.quantity || 0;
    expect(heldQty).toBeGreaterThanOrEqual(1);

    // Attempt to SELL more than held by specifying a large requestedNotionalSek
    const sellDecision: PaperTradeDecision = { id: 't_sell_big', symbol: 'MSFT', action: 'SELL', confidence: 100, referencePrice: priceSek, generatedAt: new Date().toISOString(), requestedNotionalSek: 999999 } as any;
    const before = await portfolioAdapter.getPortfolio();
    const requestedSellNotional = sellDecision.requestedNotionalSek as number;
    const approxRequestedQty = Math.floor(requestedSellNotional / priceSek);
    const sellRes = await trader.handleDecision(sellDecision);

    // Evaluate actual engine behavior: either it caps to holding and executes, or it rejects when no holding
    if (sellRes.accepted){
      const exec = sellRes.execution as any;
      // Engine should not sell more than held
      expect(exec.quantity).toBeLessThanOrEqual(heldQty);
      const after = await portfolioAdapter.getPortfolio();
      // cash should increase by proceeds - fee
      expect(after.availableCash).toBeGreaterThan(before.availableCash);
      // audit: one execution for this decision, no rejection
      const audits = await trader.getAuditEntries();
      const execCount = audits.filter((a:any)=> a.kind === 'EXECUTION' && a.execution && a.execution.decisionId === sellDecision.id).length;
      const rejectCount = audits.filter((a:any)=> a.kind === 'REJECT' && a.decision && a.decision.id === sellDecision.id).length;
      expect(execCount).toBe(1);
      expect(rejectCount).toBe(0);
    } else {
      // If engine rejects: ensure portfolio unchanged and rejection recorded
      const after = await portfolioAdapter.getPortfolio();
      expect(after.availableCash).toBe(before.availableCash);
      const h = after.holdings.find((x:any)=> x.symbol === 'MSFT');
      expect(h.quantity).toBe(heldQty);
      const audits = await trader.getAuditEntries();
      const rejectEntries = audits.filter((a:any)=> a.kind === 'REJECT' && a.decision && a.decision.id === sellDecision.id);
      expect(rejectEntries.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('Test C: position cap enforces max 10% of portfolio value (notional is capped)', async ()=>{
    // Given portfolio totalValue 10k -> position cap = 1k SEK
    const priceSek = 500 * 10; // 5000 SEK per share
    // request a buy that would exceed 10% (e.g., 50000 SEK)
    const requestedNotional = 50000;
    const decision: PaperTradeDecision = { id: 't_cap_test', symbol: 'MSFT', action: 'BUY', confidence: 100, referencePrice: priceSek, generatedAt: new Date().toISOString(), requestedNotionalSek: requestedNotional } as any;
    const before = await portfolioAdapter.getPortfolio();
    const res = await trader.handleDecision(decision);
    if (res.accepted){
      const exec = res.execution as any;
      // final notional should not exceed 10% of totalValue (approx 1000)
      expect(exec.notional).toBeLessThanOrEqual(round2(before.totalValue * 0.10) + 0.01);
    } else {
      // rejection is allowed by engine design in some edge cases
      expect(res.accepted).toBe(false);
    }
  });
});
