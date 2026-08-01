import { describe, it, expect } from 'vitest';
import { evaluateRisk, PortfolioSnapshot, TradeDecision, mapAssetTypeToCategory, detectAssetCategory } from './risk-engine';

describe('RiskEngine basic rules', ()=>{
  it('rejects when position would exceed 10% cap', ()=>{
    const portfolio = { availableCash: 100000, totalValue: 100000, holdings: [{ symbol: 'ABC', quantity: 10, currentPrice: 500, marketValue: 5000 }] };
    const decision = { side: 'BUY' as const, symbol: 'ABC', requestedNotionalSek: 6000 };
    const res = evaluateRisk({ portfolio, decision, maxPositionPercent: 0.10 });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('POSITION_SIZE_EXCEEDS_LIMIT');
    // score: 100 - 40 = 60 -> MEDIUM
    expect(res.score).toBe(60);
    expect(res.level).toBe('MEDIUM');
  });

  it('applies cash-after-buy penalty correctly', ()=>{
    const portfolio = { availableCash: 15000, totalValue: 100000, holdings: [] };
    const decision = { side: 'BUY' as const, symbol: 'CASH', requestedNotionalSek: 6000 };
    const res = evaluateRisk({ portfolio, decision });
    // cashAfter = 9000 < 10000 -> -30 => score 70 -> MEDIUM
    expect(res.score).toBe(70);
    expect(res.level).toBe('MEDIUM');
    expect(res.allowed).toBe(true);
  });

  it('applies todaysTradeCount >=80% penalty correctly', ()=>{
    const portfolio = { availableCash: 100000, totalValue: 100000, holdings: [] };
    const decision = { side: 'BUY' as const, symbol: 'T80', requestedNotionalSek: 100 };
    const res = evaluateRisk({ portfolio, decision, todaysTradeCount: 4, dailyTradeLimit: 5 });
    // todaysTradeCount 4 >= 0.8*5 => -20 => score 80 -> LOW
    expect(res.score).toBe(80);
    expect(res.level).toBe('LOW');
    expect(res.allowed).toBe(true);
  });

  it('rejects when daily trade limit reached', ()=>{
    const portfolio = { availableCash: 100000, totalValue: 100000, holdings: [] };
    const decision = { side: 'BUY' as const, symbol: 'XYZ', requestedNotionalSek: 1000 };
    const res = evaluateRisk({ portfolio, decision, todaysTradeCount: 5, dailyTradeLimit: 5 });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('DAILY_TRADE_LIMIT_REACHED');
  });

  it('rejects when cash insufficient', ()=>{
    const portfolio = { availableCash: 500, totalValue: 100000, holdings: [] };
    const decision = { side: 'BUY' as const, symbol: 'XYZ', requestedNotionalSek: 1000 };
    const res = evaluateRisk({ portfolio, decision });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('INSUFFICIENT_CASH');
  });

  it('allows when all rules pass', ()=>{
    const portfolio = { availableCash: 100000, totalValue: 100000, holdings: [{ symbol: 'AAA', quantity: 1, currentPrice: 100, marketValue: 100 }] };
    const decision = { side: 'BUY' as const, symbol: 'AAA', requestedNotionalSek: 5000 };
    const res = evaluateRisk({ portfolio, decision, todaysTradeCount: 0, dailyTradeLimit: 5 });
    expect(res.allowed).toBe(true);
    expect(res.reasons.length).toBe(0);
  });

  it('rejects BUY without a valid notional (and no quantity/refPrice)', ()=>{
    const portfolio: PortfolioSnapshot = { availableCash: 100000, totalValue: 100000, holdings: [] };
    const decision: TradeDecision = { side: 'BUY', symbol: 'NOP' };
    const res = evaluateRisk({ portfolio, decision });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('INVALID_RISK_INPUT');
  });

  it('uses quantity * referencePrice when notional missing', ()=>{
    const portfolio: PortfolioSnapshot = { availableCash: 100000, totalValue: 100000, holdings: [] };
    const decision: TradeDecision = { side: 'BUY', symbol: 'QRP', quantity: 10, referencePrice: 100 };
    const res = evaluateRisk({ portfolio, decision });
    // computed notional = 1000, within caps and cash available
    expect(res.allowed).toBe(true);
    expect(res.reasons.length).toBe(0);
  });

  it('rejects when portfolio numbers are NaN or negative', ()=>{
    const bad1: PortfolioSnapshot = { availableCash: NaN, totalValue: 100000, holdings: [] };
    const decision: TradeDecision = { side: 'BUY', symbol: 'X', requestedNotionalSek: 100 };
    const r1 = evaluateRisk({ portfolio: bad1, decision });
    expect(r1.allowed).toBe(false);
    expect(r1.reasons).toContain('INVALID_RISK_INPUT');

    const bad2: PortfolioSnapshot = { availableCash: 1000, totalValue: -1, holdings: [] };
    const r2 = evaluateRisk({ portfolio: bad2, decision });
    expect(r2.allowed).toBe(false);
    expect(r2.reasons).toContain('INVALID_RISK_INPUT');
  });

  it('rejects when maxPositionPercent is NaN', ()=>{
    const portfolio: PortfolioSnapshot = { availableCash: 100000, totalValue: 100000, holdings: [] };
    const decision: TradeDecision = { side: 'BUY', symbol: 'M', requestedNotionalSek: 100 };
    const res = evaluateRisk({ portfolio, decision, maxPositionPercent: NaN });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('INVALID_RISK_INPUT');
  });

  it('rejects when todaysTradeCount is negative', ()=>{
    const portfolio: PortfolioSnapshot = { availableCash: 100000, totalValue: 100000, holdings: [] };
    const decision: TradeDecision = { side: 'BUY', symbol: 'T', requestedNotionalSek: 100 };
    const res = evaluateRisk({ portfolio, decision, todaysTradeCount: -1 });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('INVALID_RISK_INPUT');
  });

  it('rejects when existing holding has invalid marketValue', ()=>{
    const portfolio: PortfolioSnapshot = { availableCash: 100000, totalValue: 100000, holdings: [{ symbol: 'BAD', quantity: 1, marketValue: NaN }] };
    const decision: TradeDecision = { side: 'BUY', symbol: 'BAD', requestedNotionalSek: 10 };
    const res = evaluateRisk({ portfolio, decision });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('INVALID_RISK_INPUT');
  });

  it('maps asset types to categories and preserves risk behavior for stocks', ()=>{
    // Stock mapping
    expect(mapAssetTypeToCategory('Stock')).toBe('Stock');
    expect(mapAssetTypeToCategory('ETF')).toBe('Stock');

    // Forex mapping
    expect(mapAssetTypeToCategory('Forex')).toBe('Forex');

    // Commodity mapping
    expect(mapAssetTypeToCategory('Commodity')).toBe('Commodity');

    // Unknown mapping
    expect(mapAssetTypeToCategory('SomethingElse')).toBe('Unknown');

    // Detect from portfolio holdings
    const portfolio: PortfolioSnapshot = { availableCash: 100000, totalValue: 100000, holdings: [ { symbol: 'EUR_USD', quantity: 1000, averagePrice: 1.2, currentPrice: 1.2, marketValue: 1200, /* assetType present */ } as any ] };
    // attach assetType dynamically to simulate holdings with assetType
    (portfolio.holdings![0] as any).assetType = 'Forex';
    expect(detectAssetCategory(portfolio, 'EUR_USD')).toBe('Forex');

    // Commodity detection
    const p2: PortfolioSnapshot = { availableCash: 100000, totalValue: 100000, holdings: [ { symbol: 'XAU_USD', quantity: 1, averagePrice: 2000, currentPrice: 2000, marketValue: 2000 } as any ] };
    (p2.holdings![0] as any).assetType = 'Commodity';
    expect(detectAssetCategory(p2, 'XAU_USD')).toBe('Commodity');

    // Unknown when no holding
    const p3: PortfolioSnapshot = { availableCash: 100000, totalValue: 100000, holdings: [] };
    expect(detectAssetCategory(p3, 'NOPE')).toBe('Unknown');

    // Regression: ensure risk result for a stock scenario remains consistent
    const portStock: PortfolioSnapshot = { availableCash: 100000, totalValue: 100000, holdings: [{ symbol: 'ABC', quantity: 10, currentPrice: 500, marketValue: 5000, } as any] };
    (portStock.holdings![0] as any).assetType = 'Stock';
    const decision = { side: 'BUY' as const, symbol: 'ABC', requestedNotionalSek: 6000 };
    const res = evaluateRisk({ portfolio: portStock, decision, maxPositionPercent: 0.10 });
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain('POSITION_SIZE_EXCEEDS_LIMIT');
    expect(res.score).toBe(60);
    expect(res.level).toBe('MEDIUM');
  });
});
