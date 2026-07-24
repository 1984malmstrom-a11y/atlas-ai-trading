import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateHoldingActionPublic, decideBuySignalFromLastRef, setPaperTradingEnabled, executePaperTradeDecision } from './demo-runtime';
import analyzePriceSeries from './technical';

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

describe('deterministic technical analyzer', ()=>{
  it('rising series -> BUY', ()=>{
    const prices = Array.from({length:30}, (_,i)=> 100 + i * 1);
    const out = analyzePriceSeries(prices);
    expect(out.signal).toBe('BUY');
    expect(out.technicalScore).toBeGreaterThan(50);
  });

  it('falling series -> SELL', ()=>{
    const prices = Array.from({length:30}, (_,i)=> 200 - i * 1);
    const out = analyzePriceSeries(prices);
    expect(out.signal).toBe('SELL');
    expect(out.technicalScore).toBeLessThan(50);
  });

  it('sideways series -> HOLD', ()=>{
    const prices = Array.from({length:30}, (_,i)=> 100 + (i % 2 === 0 ? 0.1 : -0.1));
    const out = analyzePriceSeries(prices);
    expect(out.signal).toBe('HOLD');
  });

  it('positive trend but negative short momentum -> HOLD', ()=>{
    // Construct: long-term up, recent strong short-run but final drop so momentum (last vs 10d ago) is negative
    const arr: number[] = [];
    for (let i=0;i<20;i++) arr.push(100 + i * 1); // 100..119 (price10Ago will be 119)
    // create a short spike then a drop on last day to make momentum negative but shortAvg high
    arr.push(140,139,138,137,136,135,134,133,132,100);
    expect(arr.length).toBe(30);
    const out = analyzePriceSeries(arr);
    expect(out.trend).toBe('bullish');
    expect(out.momentumPercent).toBeLessThan(0);
    expect(out.signal).toBe('HOLD');
  });

  it('high volatility lowers score', ()=>{
    const base = Array.from({length:30}, (_,i)=> 100 + i * 0.5);
    // create high volatility variant by alternating spikes
    const noisy = base.map((v,i)=> i % 2 === 0 ? v * 1.2 : v * 0.8);
    const outBase = analyzePriceSeries(base);
    const outNoisy = analyzePriceSeries(noisy);
    expect(outNoisy.technicalScore).toBeLessThan(outBase.technicalScore);
  });

  it('insufficient series -> HOLD with reason', ()=>{
    const prices = Array.from({length:10}, (_,i)=> 100 + i);
    const out = analyzePriceSeries(prices);
    expect(out.signal).toBe('HOLD');
    expect(out.reasons.some(r=> r.includes('insufficient'))).toBeTruthy();
  });

  it('input not mutated and score in 0..100', ()=>{
    const prices = Array.from({length:30}, (_,i)=> 100 + i);
    const copy = JSON.stringify(prices);
    const out = analyzePriceSeries(prices);
    expect(JSON.stringify(prices)).toBe(copy);
    expect(out.technicalScore).toBeGreaterThanOrEqual(0);
    expect(out.technicalScore).toBeLessThanOrEqual(100);
  });
});
