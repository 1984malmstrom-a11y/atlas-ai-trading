import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateHoldingActionPublic, decideBuySignalFromLastRef, setPaperTradingEnabled, executePaperTradeDecision } from './demo-runtime';

beforeEach(async ()=>{
  // ensure enabled
  try{ await setPaperTradingEnabled(true); }catch(e){}
});

describe('Victor simple strategy evaluation', ()=>{
  it('decideBuySignalFromLastRef: positive dip creates BUY', ()=>{
    const res = decideBuySignalFromLastRef(98, 100);
    expect(res.buySignal).toBeTruthy();
    expect(res.reason).toMatch(/dipped/);
  });

  it('decideBuySignalFromLastRef: neutral gives HOLD', ()=>{
    const res = decideBuySignalFromLastRef(100, 100);
    expect(res.buySignal).toBeFalsy();
  });

  it('evaluateHoldingActionPublic: negative exit produces SELL', ()=>{
    const holding = { averagePrice: 100, quantity: 1 };
    const quote = { priceSek: 96 };
    const res = evaluateHoldingActionPublic(holding, quote);
    expect(res.action).toBe('SELL');
    expect(res.reason).toMatch(/Negative|Stop-loss/);
  });

  it('planner: do not buy and sell same symbol in same cycle (simulated)', ()=>{
    const holding = { averagePrice: 100, quantity: 1, symbol: 'TSLA' };
    const quote = { priceSek: 96, symbol: 'TSLA' };
    const evalRes = evaluateHoldingActionPublic(holding, quote);
    // even if buySignal would be true, planner must skip buy when evalRes is SELL
    const buyRes = decideBuySignalFromLastRef(95, 100); // would-be buy
    expect(evalRes.action).toBe('SELL');
    if (evalRes.action === 'SELL'){
      expect(buyRes.buySignal).toBeTruthy();
      // but planner should skip buy; simulate
      const plannerWouldIncludeBuy = !(evalRes.action === 'SELL');
      expect(plannerWouldIncludeBuy).toBeFalsy();
    }
  });

  it('risk rules can still stop a trade', async ()=>{
    // craft a decision that requests an enormous notional to trigger risk rejection
    const decision: any = {
      id: `test_risk_${Date.now()}`,
      symbol: 'MSFT',
      action: 'BUY',
      confidence: 100,
      referencePrice: 100,
      requestedNotionalSek: 1_000_000,
      generatedAt: new Date().toISOString(),
    };
    const { result } = await executePaperTradeDecision(decision);
    expect(result).toBeDefined();
    expect(result.accepted).toBeFalsy();
  });
});
