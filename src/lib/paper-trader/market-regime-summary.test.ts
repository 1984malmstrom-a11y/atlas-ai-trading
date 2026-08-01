import { expect, it, vi } from 'vitest';

// Build a cycle with multiple holdings so runtime evaluates symbols and attaches marketRegime
it('DecisionSummary includes per-symbol marketRegime and distribution + dominant regime', async ()=>{
  vi.resetModules();
  // instruments
  vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 's1', providerSymbol: 'S1', enabled: true, marketDataEnabled: true, assetType: 'STOCK' }, { id: 's2', providerSymbol: 'S2', enabled: true, marketDataEnabled: true, assetType: 'STOCK' }, { id: 's3', providerSymbol: 'S3', enabled: true, marketDataEnabled: true, assetType: 'STOCK' }, { id: 's4', providerSymbol: 'S4', enabled: true, marketDataEnabled: true, assetType: 'STOCK' } ] }));
  // force market open
  vi.doMock('../../lib/us-market', () => ({ getNextNYOpenInstant: (_d?: any) => ({ open: true }) }));
  // TwelveData provider returns closes array with marker so analyzePriceSeries can vary by symbol
  vi.doMock('../market-data/twelve-data', () => ({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(sym:string){ return { closes: [ `__sym__${sym}` ], dates: [] }; } } }));
  // technical analyzer reads marker and returns tailored technical metadata per symbol
  vi.doMock('./technical', () => ({ default: (closes:any[]) => {
    const m = closes && closes[0] ? String(closes[0]) : '';
    if (m.startsWith('__sym__')){
      const s = m.slice(7);
      if (s === 'S1') return { trend: 'UP', momentumPercent: 6, volatilityPercent: 10, technicalScore: 80, priceVsMovingAverage: 0.03 };
      if (s === 'S2') return { trend: 'NONE', momentumPercent: 0.2, volatilityPercent: 5, technicalScore: 10, priceVsMovingAverage: 0.001 };
      if (s === 'S3') return { trend: 'UP', momentumPercent: 5, volatilityPercent: 80, technicalScore: 70, priceVsMovingAverage: 0.02 };
      if (s === 'S4') return {}; // incomplete
    }
    return {};
  } }));
  // decision engine predictable
  vi.doMock('./decision-engine', () => ({ evaluateDecision: (_:any) => ({ confidence: 80, risk: { allowed: true, score: 20, level: 'LOW', reasons: [] } }) }));

  const rt = await import('./demo-runtime');
  // clear audits
  await rt.__clearAudits();

  // holdings ensure SELL candidates created (price below avg)
  const holdings = [ { symbol: 'S1', quantity: 1, averagePrice: 100, currentPrice: 90 }, { symbol: 'S2', quantity: 1, averagePrice: 100, currentPrice: 90 }, { symbol: 'S3', quantity: 1, averagePrice: 100, currentPrice: 90 }, { symbol: 'S4', quantity: 1, averagePrice: 100, currentPrice: 90 } ];
  const override = { quotes: [ { symbol: 'S1', price: 90 }, { symbol: 'S2', price: 90 }, { symbol: 'S3', price: 90 }, { symbol: 'S4', price: 90 } ], portfolio: { availableCash: 100000, totalValue: 100000, holdings } };

  await rt.runManualPaperTradingCycle({ allowWhenScheduler: true, overrideUniverse: override });

  // read DECISION_SUMMARY from audit file
  const fs = await import('fs');
  const path = await import('path');
  const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
  const raw = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf-8') : '[]';
  const parsed = JSON.parse(raw || '[]');
  const found = Array.isArray(parsed) ? parsed.find((e:any)=> e && e.raw && e.raw.kind === 'DECISION_SUMMARY' && e.raw.summary && e.raw.summary.cycleId) : null;
  expect(found).not.toBeNull();
  const summary = found && found.raw && found.raw.summary ? found.raw.summary : null;
  expect(summary).toBeTruthy();
  // DecisionReason contains marketRegime per symbol
  expect(Array.isArray(summary.decisionReasons)).toBeTruthy();
  const drm = {} as Record<string,string>;
  for (const d of summary.decisionReasons){ if (d.marketRegime && d.marketRegime.regime) drm[d.symbol] = d.marketRegime.regime; }
  expect(drm['S1']).toBe('STRONG_UPTREND');
  expect(drm['S2']).toBe('RANGE_BOUND');
  expect(drm['S3']).toBe('HIGH_VOLATILITY');
  expect(drm['S4']).toBe('UNCERTAIN');

  // distribution and dominant regime
  expect(summary.marketRegimeDistribution).toBeTruthy();
  expect(summary.marketRegimeDistribution['STRONG_UPTREND']).toBe(1);
  expect(summary.marketRegimeDistribution['RANGE_BOUND']).toBe(1);
  expect(summary.marketRegimeDistribution['HIGH_VOLATILITY']).toBe(1);
  expect(summary.marketRegimeDistribution['UNCERTAIN']).toBe(1);
  // tie-break: highest count tie -> use priority (HIGH_VOLATILITY first)
  // here equal counts => HIGH_VOLATILITY should be dominant
  expect(summary.dominantMarketRegime).toBe('HIGH_VOLATILITY');

  // trading action and confidence unchanged
  for (const d of summary.decisionReasons){ expect(['SELL','BUY','HOLD']).toContain(d.action); if (d.confidence !== null) expect(typeof d.confidence).toBe('number'); }

});
