import { describe, it, expect } from 'vitest';
import { PaperTradingEngine, Order } from './paper-trading-engine';
import { Portfolio } from '../portfolio/types';

describe('PaperTradingEngine risk integration', ()=>{
  it('stops BUY when risk engine denies', ()=>{
    const portfolio: Portfolio = { id: 'p1', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
    const engine = new PaperTradingEngine(portfolio);
    const order: Order = { id: 'o1', symbol: 'BIG', side: 'Köp', quantity: 200 }; // large notional -> >10%
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
    const order: Order = { id: 'o2', symbol: 'SMALL', side: 'Köp', quantity: 5, price: 100 };
    const res = engine.simulateExecution(order);
    expect(res.success).toBe(true);
    expect((res as any).risk).toBeDefined();
    expect((res as any).risk.score).toBeDefined();
    expect((res as any).risk.level).toBeDefined();
  });
});
