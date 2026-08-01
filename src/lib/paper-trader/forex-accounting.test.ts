import { describe, it, expect } from 'vitest';
import { computeNextPortfolioState } from './portfolio-mutation';

describe('Forex accounting BUY->MTM->SELL', ()=>{
  it('performs buy, updates holding, marks to market, and sells with correct cash and holdings', ()=>{
    const initial = { availableCash: 100000, holdings: [], totalValue: 100000 } as any;
    // BUY 500 EUR at 11 SEK/EUR => notional 5500 SEK
    const buyExec = { symbol: 'EUR_USD', side: 'BUY', quantity: 500, executedPrice: 11, notional: 5500, fee: 5 } as any;
    const afterBuy = computeNextPortfolioState(initial, buyExec);
    expect(afterBuy.availableCash).toBeCloseTo(100000 - 5500 - 5);
    expect(Array.isArray(afterBuy.holdings)).toBeTruthy();
    const h = afterBuy.holdings.find((x:any)=> x.symbol === 'EUR_USD' || x.symbol === 'EUR_USD');
    expect(h).toBeTruthy();
    if (h){
      expect(h.quantity).toBe(500);
      expect(h.averagePrice).toBe(11);
    }

    // Mark-to-market: simulate price change to 12 SEK/EUR
    // Update holding currentPrice manually to simulate MTM
    const mtm = JSON.parse(JSON.stringify(afterBuy));
    const holding = mtm.holdings.find((x:any)=> x.symbol === 'EUR_USD');
    holding.currentPrice = 12;
    holding.marketValue = Math.round(holding.quantity * holding.currentPrice * 100)/100;
    const unrealized = holding.marketValue - (holding.averagePrice * holding.quantity);
    expect(unrealized).toBeCloseTo(500);

    // SELL full holding at 12 SEK/EUR
    const sellExec = { symbol: 'EUR_USD', side: 'SELL', quantity: 500, executedPrice: 12, notional: 6000, fee: 5 } as any;
    const afterSell = computeNextPortfolioState(afterBuy, sellExec);
    // cash should be initial - buyNotional - buyFee + sellProceeds - sellFee
    const expectedCash = 100000 - 5500 - 5 + 6000 - 5;
    expect(afterSell.availableCash).toBeCloseTo(expectedCash);
    // holding removed
    expect((afterSell.holdings || []).find((x:any)=> x.symbol === 'EUR_USD')).toBeUndefined();
  });
});
