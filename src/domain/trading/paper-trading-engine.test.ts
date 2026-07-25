import { describe, it, expect, vi } from 'vitest';
import { PaperTradingEngine, Order } from './paper-trading-engine';
import { Portfolio } from '../portfolio/types';
import * as decMod from '../../lib/paper-trader/decision-engine';

describe('PaperTradingEngine risk integration', ()=>{
  it('stops BUY when risk engine denies', ()=>{
    const portfolio: Portfolio = { id: 'p1', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    const engine = new PaperTradingEngine(portfolio);
    const order: Order = { id: 'o1', symbol: 'BIG', side: 'Köp', quantity: 200, expectedReturnPercent: 0 }; // large notional -> >10%
    const res = engine.simulateExecution(order);
    expect(res.success).toBe(false);
    // expect unified risk object present
    expect((res as any).risk).toBeDefined();
    expect((res as any).risk.score).toBeDefined();
    expect((res as any).risk.level).toBeDefined();
    expect((res as any).risk.reasons).toBeDefined();
  });

  it('includes riskScore and riskLevel when BUY allowed', ()=>{
    const portfolio: Portfolio = { id: 'p2', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    const engine = new PaperTradingEngine(portfolio);
    const order: Order = { id: 'o2', symbol: 'SMALL', side: 'Köp', quantity: 5, price: 100, expectedReturnPercent: 10 };
    // Ensure Decision Engine returns a positionSizing with confidenceAdjustedNotional so BUY proceeds
    const fakeDecision = { accepted: true, risk: { allowed: true, score: 80, level: 'LOW', reasons: [], positionSizing: { recommendedNotional: 500, confidenceAdjustedNotional: 500 } } };
    const spy = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> fakeDecision as any);
    const res = engine.simulateExecution(order);
    spy.mockRestore();
    expect(res.success).toBe(true);
    expect((res as any).risk).toBeDefined();
    expect((res as any).risk.score).toBeDefined();
    expect((res as any).risk.level).toBeDefined();
  });

  it('confidence 100 results in full requested notional executed', ()=>{
    const portfolio: Portfolio = { id: 'pA', baseCurrency: 'SEK', totalValue: 20000, availableCash: 20000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    const engine = new PaperTradingEngine(portfolio);
    engine.slippageMin = 0; engine.slippageMax = 0;
    const order: Order = { id: 'oA', symbol: 'X', side: 'Köp', quantity: 10, price: 100, expectedReturnPercent: 10 }; // requested notional = 1000
    const fakeDecision = { accepted: true, risk: { allowed: true, score: 90, level: 'LOW', reasons: [], positionSizing: { confidenceAdjustedNotional: 1000 } } };
    const spy = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> fakeDecision as any);
    const res = engine.simulateExecution(order);
    spy.mockRestore();
    expect(res.success).toBe(true);
    const tx = (res as any).transaction;
    const actualNotional = tx.quantity * tx.executedPrice;
    expect(actualNotional).toBeCloseTo(1000, 6);
    // cash reduced by notional + fee
    const expectedFee = Math.abs(actualNotional) * engine.feePercent;
    expect((res as any).portfolio.availableCash).toBeCloseTo(portfolio.availableCash - actualNotional - expectedFee, 6);
  });

  it('confidence 50 results in half the notional/quantity', ()=>{
    const portfolio: Portfolio = { id: 'pB', baseCurrency: 'SEK', totalValue: 20000, availableCash: 20000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    const engine = new PaperTradingEngine(portfolio);
    engine.slippageMin = 0; engine.slippageMax = 0;
    const order: Order = { id: 'oB', symbol: 'Y', side: 'Köp', quantity: 10, price: 100, expectedReturnPercent: 10 }; // requested notional = 1000
    const fakeDecision = { accepted: true, risk: { allowed: true, score: 50, level: 'LOW', reasons: [], positionSizing: { confidenceAdjustedNotional: 500 } } };
    const spy = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> fakeDecision as any);
    const res = engine.simulateExecution(order);
    spy.mockRestore();
    expect(res.success).toBe(true);
    const tx = (res as any).transaction;
    const actualNotional = tx.quantity * tx.executedPrice;
    expect(actualNotional).toBeCloseTo(500, 6);
    expect(tx.quantity).toBe(5);
  });

  it('confidence 0 is denied and no execution occurs', ()=>{
    const portfolio: Portfolio = { id: 'pC', baseCurrency: 'SEK', totalValue: 20000, availableCash: 20000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    const engine = new PaperTradingEngine(portfolio);
    engine.slippageMin = 0; engine.slippageMax = 0;
    const order: Order = { id: 'oC', symbol: 'Z', side: 'Köp', quantity: 10, price: 100, expectedReturnPercent: 10 };
    const fakeDecision = { accepted: true, risk: { allowed: true, score: 0, level: 'LOW', reasons: [], positionSizing: { confidenceAdjustedNotional: 0 } } };
    const spy = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> fakeDecision as any);
    const res = engine.simulateExecution(order);
    spy.mockRestore();
    expect(res.success).toBe(false);
    expect((res as any).portfolio.availableCash).toBe(portfolio.availableCash);
  });

  it('confidenceAdjustedNotional larger than requested notional never exceeds order quantity/notional', ()=>{
    const portfolio: Portfolio = { id: 'pD', baseCurrency: 'SEK', totalValue: 20000, availableCash: 20000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    const engine = new PaperTradingEngine(portfolio);
    engine.slippageMin = 0; engine.slippageMax = 0;
    const order: Order = { id: 'oD', symbol: 'W', side: 'Köp', quantity: 10, price: 100, expectedReturnPercent: 10 }; // requested notional = 1000
    const fakeDecision = { accepted: true, risk: { allowed: true, score: 95, level: 'LOW', reasons: [], positionSizing: { confidenceAdjustedNotional: 2000 } } };
    const spy = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> fakeDecision as any);
    const res = engine.simulateExecution(order);
    spy.mockRestore();
    expect(res.success).toBe(true);
    const tx = (res as any).transaction;
    const actualNotional = tx.quantity * tx.executedPrice;
    // should not exceed requested notional
    expect(actualNotional).toBeLessThanOrEqual(1000 + 1e-9);
    expect(tx.quantity).toBeLessThanOrEqual(order.quantity);
  });

  it('SELL uses original quantity and is unaffected by confidenceAdjustedNotional', ()=>{
    const portfolio: Portfolio = { id: 'pE', baseCurrency: 'SEK', totalValue: 2000, availableCash: 0, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [{ id: 'h1', symbol: 'S', name: 'S', assetType: 'Stock', quantity: 10, averagePrice: 50, currentPrice: 100, marketValue: 1000, unrealizedPnl: 0, unrealizedPnlPercent: 0, portfolioWeight: 0 }] };
    const engine = new PaperTradingEngine(portfolio);
    engine.slippageMin = 0; engine.slippageMax = 0;
    const order: Order = { id: 'oE', symbol: 'S', side: 'Sälj', quantity: 5, price: 100 };
    // If evaluateDecision were called it would throw; ensure SELL path does not call it
    const spy = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> { throw new Error('evaluateDecision should not be called for SELL'); });
    const res = engine.simulateExecution(order);
    spy.mockRestore();
    expect(res.success).toBe(true);
    const tx = (res as any).transaction;
    expect(tx.quantity).toBe(order.quantity);
    // cash increased by proceed = notional - fee
    const expectedProceed = order.quantity * order.price! - Math.abs(order.quantity * order.price!) * engine.feePercent;
    expect((res as any).portfolio.availableCash).toBeCloseTo(expectedProceed, 6);
  });

  it('invalid sizing results (undefined, NaN, negative) are denied safely', ()=>{
    const basePortfolio: Portfolio = { id: 'pF', baseCurrency: 'SEK', totalValue: 20000, availableCash: 20000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    const engine = new PaperTradingEngine(JSON.parse(JSON.stringify(basePortfolio)));
    engine.slippageMin = 0; engine.slippageMax = 0;
    const order: Order = { id: 'oF1', symbol: 'I', side: 'Köp', quantity: 10, price: 100, expectedReturnPercent: 10 };

    // undefined
    const spy1 = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> ({ accepted: true, risk: { allowed: true, score: 10, level: 'LOW', reasons: [], /* positionSizing absent */ } } as any));
    const r1 = engine.simulateExecution(order);
    spy1.mockRestore();
    expect(r1.success).toBe(false);

    // NaN
    const spy2 = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> ({ accepted: true, risk: { allowed: true, score: 10, level: 'LOW', reasons: [], positionSizing: { confidenceAdjustedNotional: NaN } } } as any));
    const r2 = engine.simulateExecution(order);
    spy2.mockRestore();
    expect(r2.success).toBe(false);

    // negative
    const spy3 = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> ({ accepted: true, risk: { allowed: true, score: 10, level: 'LOW', reasons: [], positionSizing: { confidenceAdjustedNotional: -100 } } } as any));
    const r3 = engine.simulateExecution(order);
    spy3.mockRestore();
    expect(r3.success).toBe(false);
  });

  it('fractional quantity regression: supports fractional executed quantity exactly', ()=>{
    const portfolio: Portfolio = { id: 'pG', baseCurrency: 'SEK', totalValue: 20000, availableCash: 20000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    const engine = new PaperTradingEngine(portfolio);
    engine.slippageMin = 0; engine.slippageMax = 0;
    const order: Order = { id: 'oG', symbol: 'F', side: 'Köp', quantity: 10, price: 100, expectedReturnPercent: 10 };
    // confidenceAdjustedNotional 550 should lead to quantity 5.5 at price 100
    const fakeDecision = { accepted: true, risk: { allowed: true, score: 60, level: 'LOW', reasons: [], positionSizing: { confidenceAdjustedNotional: 550 } } };
    const spy = vi.spyOn(decMod, 'evaluateDecision' as any).mockImplementation(()=> fakeDecision as any);
    const res = engine.simulateExecution(order);
    spy.mockRestore();
    expect(res.success).toBe(true);
    const tx = (res as any).transaction;
    expect(tx.quantity).toBeCloseTo(5.5, 12);
    expect(tx.quantity * tx.executedPrice).toBeCloseTo(550, 6);
  });
});
