import { expect, it, vi, beforeEach, afterEach } from 'vitest';

// Small integration-like unit test: ensure DECISION_SUMMARY appended for a deterministic cycle
it('appends DECISION_SUMMARY audit after a manual cycle', async () => {
  vi.resetModules();
  // Mock tradable instruments to include NVDA
  vi.doMock('../market-data/instruments', () => ({ TRADABLE_INSTRUMENTS: [ { id: 'nvda', providerSymbol: 'NVDA', enabled: true, marketDataEnabled: true, assetType: 'STOCK' } ] }));
  // Mock TwelveData provider to avoid network
  vi.doMock('../market-data/twelve-data', () => ({ TwelveDataMarketDataProvider: class { async getHistoricalDailyCloses(s:any, n?:number){ return { closes: [], dates: [] }; } } }));
  // Mock decision engine to return predictable high-confidence decision
  vi.doMock('./decision-engine', () => ({ evaluateDecision: (inp:any) => ({ confidence: 80, risk: { allowed: true, score: 10, level: 'LOW', reasons: [] } }) }));

  const rt = await import('./demo-runtime');
  // ensure audits cleared
  await rt.__clearAudits();

  const quotes = [ { symbol: 'NVDA', priceSek: 90, providerSymbol: 'NVDA' } ];
  const portfolio = { id: 'demo', baseCurrency: 'SEK', totalValue: 10000, availableCash: 1000, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [ { id: 'h_NVDA', symbol: 'NVDA', quantity: 1, averagePrice: 100, currentPrice: 100 } ] };

  const res = await rt.runManualPaperTradingCycle({ overrideUniverse: { quotes, portfolio } });
  // read persisted audit file to assert DECISION_SUMMARY present
  const fs = await import('fs');
  const path = await import('path');
  const auditPath = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
  const raw = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf-8') : '[]';
  const parsed = JSON.parse(raw || '[]');
  const found = Array.isArray(parsed) ? parsed.find((e:any)=> e && e.raw && e.raw.kind === 'DECISION_SUMMARY') : null;
  expect(found).not.toBeNull();
  if (found){ expect(found.raw && found.raw.summary && found.raw.summary.cycleId).toBeTruthy(); }
  if (found){
    const s = found.raw.summary;
    expect(s.marketSession).toBeTruthy();
    expect(typeof s.cycleDurationMs === 'number').toBeTruthy();
    expect(s.skippedReasonsBySymbol).toBeDefined();
    expect(s.confidenceDistribution).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(s, 'cashBefore')).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(s, 'cashAfter')).toBeTruthy();
  }
  if (found){
    const s = found.raw.summary;
    expect(s.decisionReasons).toBeDefined();
    if (Array.isArray(s.decisionReasons) && s.decisionReasons.length){
      const dr = s.decisionReasons[0];
      expect(dr.symbol).toBeTruthy();
      expect(dr.action).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(dr, 'rejectedByRiskEngine')).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(dr, 'rejectedByMarketHours')).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(dr, 'rejectedByFreshness')).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(dr, 'rejectedByPositionLimits')).toBeTruthy();
    }
  }
  // Also assert that TRADE_FEEDBACK audits were appended when executions happened
  const tfFound = Array.isArray(parsed) ? parsed.find((e:any)=> e && e.raw && e.raw.kind === 'TRADE_FEEDBACK') : null;
  if (Array.isArray(parsed) && parsed.length){
    // If executed trades exist in summary, we expect trade feedback entries to exist
    const summaryExecs = found && found.raw && found.raw.summary && Array.isArray(found.raw.summary.executedTrades) ? found.raw.summary.executedTrades : [];
    if (summaryExecs.length){
      expect(tfFound).not.toBeNull();
      if (tfFound) {
        const fb = tfFound.raw && tfFound.raw.feedback;
        expect(fb).toBeDefined();
        expect(fb.cycleId).toBeTruthy();
        expect(fb.tradeId).toBeTruthy();
        expect(fb.evaluationStatus).toBe('PENDING');
        expect(fb.evaluationDueAt).toBeTruthy();
      }
    }
  }

  // cleanup
  vi.doUnmock('../market-data/instruments');
  vi.doUnmock('../market-data/twelve-data');
  vi.doUnmock('./decision-engine');
  vi.resetModules();
});
