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

  it('new stock holding gets Stock assetType', ()=>{
    const p = makePortfolio();
    const exec: any = { id: 'es1', decisionId: 'd1', symbol: 'microsoft', side: 'BUY', quantity: 2, executedPrice: 150, notional: 300, fee: 0, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    const h = next.holdings.find((x:any)=> x.symbol === 'MICROSOFT') as any;
    expect(h).toBeDefined();
    expect(h.assetType).toBe('Stock');
  });

  it('EUR_USD creates Forex holding', ()=>{
    const p = makePortfolio();
    const exec: any = { id: 'es2', decisionId: 'd2', symbol: 'EUR_USD', side: 'BUY', quantity: 1000, executedPrice: 1.05, notional: 1050, fee: 0, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    const h = next.holdings.find((x:any)=> x.symbol === 'EUR_USD') as any;
    expect(h).toBeDefined();
    expect(h.assetType).toBe('Forex');
  });

  it('XAU_USD creates Commodity holding', ()=>{
    const p = makePortfolio();
    const exec: any = { id: 'es3', decisionId: 'd3', symbol: 'XAU_USD', side: 'BUY', quantity: 1, executedPrice: 1900, notional: 1900, fee: 0, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    const h = next.holdings.find((x:any)=> x.symbol === 'XAU_USD') as any;
    expect(h).toBeDefined();
    expect(h.assetType).toBe('Commodity');
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
    expect(found.assetType).toBe('Stock');
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
    expect(found.assetType).toBe('Stock');
    expect(next.availableCash).toBe(Math.round((100000 + Math.round(4 * 120 * 100)/100 - 1) * 100)/100);
  });

  it('full SELL removes holding', ()=>{
    const p = makePortfolio();
    (p as any).holdings.push({ id: 'h_AAA', symbol: 'AAA', name: 'AAA', assetType: 'Stock', quantity: 3, averagePrice: 50, currentPrice: 50, marketValue: 150, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const exec: any = { id: 'e4', decisionId: 'd4', symbol: 'aaa', side: 'SELL', quantity: 5, executedPrice: 60, notional: 300, fee: 2, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    expect(next.holdings.find((h:any)=> h.symbol === 'AAA')).toBeUndefined();
    // previously Stock
    expect(next.availableCash).toBe(Math.round((100000 + Math.round(3 * 60 * 100)/100 - 2) * 100)/100);
  });

  it('existing holding preserves assetType on additional BUY', ()=>{
    const p = makePortfolio();
    (p as any).holdings.push({ id: 'h_EUR_USD', symbol: 'EUR_USD', name: 'EUR/USD', assetType: 'Forex', quantity: 100, averagePrice: 1.1, currentPrice: 1.1, marketValue: 110, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const exec: any = { id: 'e5', decisionId: 'd5', symbol: 'EUR_USD', side: 'BUY', quantity: 50, executedPrice: 1.2, notional: 60, fee: 0, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    const found = next.holdings.find((h:any)=> h.symbol === 'EUR_USD') as any;
    expect(found.assetType).toBe('Forex');
  });

  it('partial SELL preserves assetType', ()=>{
    const p = makePortfolio();
    (p as any).holdings.push({ id: 'h_XAU_USD', symbol: 'XAU_USD', name: 'Gold Spot', assetType: 'Commodity', quantity: 2, averagePrice: 1800, currentPrice: 1800, marketValue: 3600, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    const exec: any = { id: 'e6', decisionId: 'd6', symbol: 'XAU_USD', side: 'SELL', quantity: 1, executedPrice: 1850, notional: 1850, fee: 0, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    const found = next.holdings.find((h:any)=> h.symbol === 'XAU_USD') as any;
    expect(found).toBeDefined();
    expect(found.assetType).toBe('Commodity');
  });

  it('unknown symbol falls back to Stock', ()=>{
    const p = makePortfolio();
    const exec: any = { id: 'eu1', decisionId: 'd7', symbol: 'UNKNOWN_X', side: 'BUY', quantity: 1, executedPrice: 10, notional: 10, fee: 0, generatedAt: new Date().toISOString() };
    const next = computeNextPortfolioState(p, exec);
    const found = next.holdings.find((h:any)=> h.symbol === 'UNKNOWN_X') as any;
    expect(found).toBeDefined();
    expect(found.assetType).toBe('Stock');
  });
});
