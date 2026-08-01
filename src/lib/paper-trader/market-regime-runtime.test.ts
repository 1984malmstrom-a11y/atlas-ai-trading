import { expect, it, vi } from 'vitest';

async function runCycleWithTech(techMock: any){
  vi.resetModules();
  vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'tst', providerSymbol: 'TST', enabled: true, marketDataEnabled: true, assetType: 'STOCK' } ] }));
  vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: (_d?: any) => ({ open: true }) }));
  vi.doMock('../market-data/twelve-data', () => ({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(_s:string, _n:number){ return { closes: Array.from({ length: 30 }, (_,i)=> 100 + i), dates: [] }; } } }));
  vi.doMock('./technical', () => ({ default: (_closes:any[]) => techMock }));
  vi.doMock('./decision-engine', () => ({ evaluateDecision: (_:any) => ({ confidence: 80, risk: { allowed: true, score: 20, level: 'LOW', reasons: [] } }) }));

  const rt = await import('./demo-runtime');
  // clear audits
  try{ await rt.__clearAudits(); }catch(_){ }
  // set deterministic portfolio
  rt.__setTestPortfolio({ getPortfolio: async ()=> ({ availableCash: 100000, totalValue: 100000, holdings: [] }), applyExecution: async (exec:any)=> ({ availableCash: 100000 - (exec.notional || 0), totalValue: 100000 - (exec.notional || 0), holdings: [] }) });

  // capture decision
  let captured: any = null;
  const mockTrader = { handleDecision: vi.fn(async (dec:any)=>{ captured = dec; const executedPrice = dec.referencePrice || 100; const qty = Math.floor(((dec.risk && dec.risk.positionSizing && dec.risk.positionSizing.confidenceAdjustedNotional) || dec.requestedNotionalSek || 0) / executedPrice); return { accepted: true, execution: { id: 'ex1', quantity: qty, executedPrice, notional: qty * executedPrice } }; }) };
  rt.__setTestTrader(mockTrader as any);

  // create a holding that triggers a SELL evaluation (price <= avg*0.95)
  const override = { quotes: [ { symbol: 'TST', price: 90, priceSek: 90 } ], portfolio: { availableCash: 100000, totalValue: 100000, holdings: [ { symbol: 'TST', quantity: 1, averagePrice: 100, currentPrice: 90 } ] } };
  await rt.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override });
  return captured;
}

it('attaches STRONG_UPTREND for bullish technical setup and does not change action', async ()=>{
  const tech = { trend: 'UP', momentumPercent: 6, volatilityPercent: 10, technicalScore: 80 };
  const dec = await runCycleWithTech(tech);
  expect(dec).toBeTruthy();
  expect(dec.action).toBe('SELL');
  expect(dec.marketRegime).toBeTruthy();
  expect(dec.marketRegime.regime).toBe('STRONG_UPTREND');
});

it('attaches HIGH_VOLATILITY when volatility high (priority) and does not change action', async ()=>{
  const tech = { trend: 'UP', momentumPercent: 6, volatilityPercent: 80, technicalScore: 80 };
  const dec = await runCycleWithTech(tech);
  expect(dec).toBeTruthy();
  expect(dec.action).toBe('SELL');
  expect(dec.marketRegime).toBeTruthy();
  expect(dec.marketRegime.regime).toBe('HIGH_VOLATILITY');
});

it('attaches UNCERTAIN when inputs incomplete', async ()=>{
  const tech = { /* empty analysis */ };
  const dec = await runCycleWithTech(tech);
  expect(dec).toBeTruthy();
  expect(dec.action).toBe('SELL');
  expect(dec.marketRegime).toBeTruthy();
  expect(dec.marketRegime.regime).toBe('UNCERTAIN');
});
