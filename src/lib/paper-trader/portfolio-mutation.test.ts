import { describe, it, expect } from 'vitest';
import { computeNextPortfolioState } from './portfolio-mutation';
import { Portfolio } from '../../domain/portfolio/types';

function makePortfolio(): Portfolio {
  return { id: 'p', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] };
}

describe('computeNextPortfolioState', ()=>{
  it('BUY new holding reduces cash and adds holding', ()=>{
    const p = makePortfolio();
    const exec: any = { id: 'e1', decisionId: 'd1', symbol: 'aaa', side: 'BUY', quantity: 10, executedPrice: 100, notional: 1000, fee: 1, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    expect(next.availableCash).toBe(100000 - 1000 - 1);
    expect(next.holdings.length).toBe(1);
    const h = next.holdings[0] as any;
    expect(h.symbol).toBe('AAA');
    expect(h.quantity).toBe(10);
    expect(h.averagePrice).toBe(100);
    expect(h.currentPrice).toBe(100);
    expect(h.marketValue).toBe(Math.round(10 * 100 * 100)/100);
  });

  it('BUY existing holding increases quantity and updates currentPrice/marketValue but preserves averagePrice', ()=>{
    const p = makePortfolio();
    (p as any).holdings.push({ id: 'h_AAA', symbol: 'AAA', name: 'AAA', assetType: 'Stock', quantity: 5, averagePrice: 90, currentPrice: 90, marketValue: 450, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const exec: any = { id: 'e2', decisionId: 'd2', symbol: 'aaa', side: 'BUY', quantity: 5, executedPrice: 110, notional: 550, fee: 2, generatedAt: new Date().toISOString() };
    const beforeClone = JSON.parse(JSON.stringify(p));
    const next = computeNextPortfolioState(p, exec);
    // input not mutated
    expect(p).toEqual(beforeClone);
    // state updated
    const found = next.holdings.find((h:any)=> h.symbol === 'AAA') as any;
    expect(found.quantity).toBe(10);
    expect(found.currentPrice).toBe(110);
    expect(found.averagePrice).toBe(90); // preserved
    expect(next.availableCash).toBe(Math.round((100000 - 550 - 2) * 100)/100);
  });

  it('partial SELL decreases holding and increases cash', ()=>{
    const p = makePortfolio();
    (p as any).holdings.push({ id: 'h_AAA', symbol: 'AAA', name: 'AAA', assetType: 'Stock', quantity: 10, averagePrice: 100, currentPrice: 100, marketValue: 1000, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const exec: any = { id: 'e3', decisionId: 'd3', symbol: 'AAA', side: 'SELL', quantity: 4, executedPrice: 120, notional: 480, fee: 1, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    const found = next.holdings.find((h:any)=> h.symbol === 'AAA') as any;
    expect(found.quantity).toBe(Math.round((10 - 4) * 100)/100);
    expect(found.currentPrice).toBe(120);
    expect(next.availableCash).toBe(Math.round((100000 + Math.round(4 * 120 * 100)/100 - 1) * 100)/100);
  });

  it('full SELL removes holding', ()=>{
    const p = makePortfolio();
    (p as any).holdings.push({ id: 'h_AAA', symbol: 'AAA', name: 'AAA', assetType: 'Stock', quantity: 3, averagePrice: 50, currentPrice: 50, marketValue: 150, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const exec: any = { id: 'e4', decisionId: 'd4', symbol: 'aaa', side: 'SELL', quantity: 5, executedPrice: 60, notional: 300, fee: 2, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    expect(next.holdings.find((h:any)=> h.symbol === 'AAA')).toBeUndefined();
    expect(next.availableCash).toBe(Math.round((100000 + Math.round(3 * 60 * 100)/100 - 2) * 100)/100);
  });
});
