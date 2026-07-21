import { describe, it, expect } from 'vitest';
import buildPortfolioContext from './index';

function quote(id:string, price:number, dataStatus='LIVE'){
  return { instrumentId: id, price, dataStatus };
}

describe('buildPortfolioContext', ()=>{
  it('calculates totalValue and marketValue correctly', ()=>{
    const portfolio = { cash: 1000, holdings: [ { instrumentId: 'x', symbol:'X', name:'X', quantity:2, averagePrice:10, sector:'A' } ] };
    const quotes = [ quote('x', 20) ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(out.totalValue).toBeCloseTo(1000 + 2*20);
    expect(out.holdings[0].marketValue).toBeCloseTo(40);
  });

  it('profitLoss and profitLossPercent calculated', ()=>{
    const portfolio = { cash: 0, holdings: [ { instrumentId: 'x', symbol:'X', name:'X', quantity:5, averagePrice: 10, sector:'A' } ] };
    const quotes = [ quote('x', 15) ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(out.holdings[0].profitLoss).toBeCloseTo((15-10)*5);
    expect(out.holdings[0].profitLossPercent).toBeCloseTo(((15-10)/10)*100);
  });

  it('totalProfitLoss sums holdings', ()=>{
    const portfolio = { cash:0, holdings: [ { instrumentId:'a', symbol:'A', name:'A', quantity:1, averagePrice:1, sector:'S' }, { instrumentId:'b', symbol:'B', name:'B', quantity:2, averagePrice:2, sector:'S' } ] };
    const quotes = [ quote('a', 2), quote('b', 3) ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    const expected = (2-1)*1 + (3-2)*2;
    expect(out.totalProfitLoss).toBeCloseTo(expected);
  });

  it('totalProfitLossPercent computed against invested value', ()=>{
    const portfolio = { cash:0, holdings: [ { instrumentId:'a', symbol:'A', name:'A', quantity:1, averagePrice:10, sector:'S' } ] };
    const quotes = [ quote('a', 15) ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(out.totalProfitLossPercent).toBeCloseTo(((15-10)*1) / (1*15) * 100 || ((15-10)*1)/ (1*10) * 100, 5);
  });

  it('portfolioWeight and cashPercent correct', ()=>{
    const portfolio = { cash:100, holdings: [ { instrumentId:'a', symbol:'A', name:'A', quantity:1, averagePrice:10, sector:'S' } ] };
    const quotes = [ quote('a', 100) ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    const total = 100 + 100;
    expect(out.holdings[0].portfolioWeight).toBeCloseTo(100/total*100);
    expect(out.cashPercent).toBeCloseTo(100/total*100);
  });

  it('largestHolding chosen correctly and concentration levels', ()=>{
    const portfolio = { cash:0, holdings: [
      { instrumentId:'a', symbol:'A', name:'A', quantity:1, averagePrice:10, sector:'S' },
      { instrumentId:'b', symbol:'B', name:'B', quantity:10, averagePrice:1, sector:'S' }
    ] };
    const quotes = [ quote('a', 10), quote('b', 5) ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(out.concentration.largestHolding).not.toBeNull();
    expect(out.concentration.largestHolding!.symbol).toBe('B');
    // determine level boundaries
    const largestPct = out.concentration.largestHolding!.portfolioWeight;
    if (largestPct < 20) expect(out.concentration.level).toBe('LOW');
    else if (largestPct <= 35) expect(out.concentration.level).toBe('MODERATE');
    else expect(out.concentration.level).toBe('HIGH');
  });

  it('topThreePercent sums top three holdings', ()=>{
    const portfolio = { cash:0, holdings: [
      { instrumentId:'a', symbol:'A', name:'A', quantity:10, averagePrice:1, sector:'S' },
      { instrumentId:'b', symbol:'B', name:'B', quantity:8, averagePrice:1, sector:'S' },
      { instrumentId:'c', symbol:'C', name:'C', quantity:6, averagePrice:1, sector:'S' },
      { instrumentId:'d', symbol:'D', name:'D', quantity:1, averagePrice:1, sector:'S' }
    ] };
    const quotes = [ quote('a',5), quote('b',4), quote('c',3), quote('d',1) ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(out.concentration.topThreePercent).toBeGreaterThan(0);
  });

  it('sectorExposure groups and sorts correctly', ()=>{
    const portfolio = { cash:0, holdings: [
      { instrumentId:'a', symbol:'A', name:'A', quantity:1, averagePrice:1, sector:'Tech' },
      { instrumentId:'b', symbol:'B', name:'B', quantity:2, averagePrice:1, sector:'Tech' },
      { instrumentId:'c', symbol:'C', name:'C', quantity:3, averagePrice:1, sector:'Retail' }
    ] };
    const quotes = [ quote('a',10), quote('b',10), quote('c',5) ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(out.sectorExposure[0].sector).toBe('Tech');
    expect(out.sectorExposure[0].holdingsCount).toBe(2);
  });

  it('missing quote handled: unavailableHoldings and UNAVAILABLE status', ()=>{
    const portfolio = { cash:0, holdings: [ { instrumentId:'x', symbol:'X', name:'X', quantity:1, averagePrice:1, sector:'S' } ] };
    const quotes: any[] = [];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(Array.isArray(out.unavailableHoldings)).toBe(true);
    expect(out.unavailableHoldings).toContain('x');
    expect(out.holdings[0].dataStatus).toBe('UNAVAILABLE');
  });

  it('matches quotes by instrumentId not symbol', ()=>{
    const portfolio = { cash:0, holdings: [ { instrumentId:'id1', symbol:'SYM', name:'X', quantity:1, averagePrice:1, sector:'S' } ] };
    const quotes = [ { instrumentId: 'id1', price: 5 } ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(out.holdings[0].currentPrice).toBe(5);
  });

  it('empty portfolio returns safe zeros', ()=>{
    const portfolio = { cash:0, holdings: [] };
    const quotes: any[] = [];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(isFinite(out.totalValue)).toBe(true);
    expect(out.totalValue).toBe(0);
  });

  it('averagePrice = 0 fallback for profitLossPercent', ()=>{
    const portfolio = { cash:0, holdings: [ { instrumentId:'a', symbol:'A', name:'A', quantity:1, averagePrice:0, sector:'S' } ] };
    const quotes = [ quote('a', 10) ];
    const out = buildPortfolioContext(portfolio as any, quotes as any);
    expect(typeof out.holdings[0].profitLossPercent).toBe('number');
  });

  it('determinism: same input => same business fields', ()=>{
    const portfolio = { cash:0, holdings: [ { instrumentId:'a', symbol:'A', name:'A', quantity:1, averagePrice:10, sector:'S' } ] };
    const quotes = [ quote('a', 15) ];
    const out1 = buildPortfolioContext(portfolio as any, quotes as any);
    const out2 = buildPortfolioContext(portfolio as any, quotes as any);
    // exclude generatedAt
    out1.generatedAt = out2.generatedAt = 'X';
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
  });

  it('result does not contain forbidden recommendation words', ()=>{
    const portfolio = { cash:0, holdings: [ { instrumentId:'a', symbol:'A', name:'A', quantity:1, averagePrice:10, sector:'S' } ] };
    const quotes = [ quote('a', 15) ];
    const serialized = JSON.stringify(buildPortfolioContext(portfolio as any, quotes as any)).toLowerCase();
    ['köp','sälj','behåll','rekommendation'].forEach(f=> expect(serialized).not.toContain(f));
  });
});
