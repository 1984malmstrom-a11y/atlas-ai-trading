import { describe, it, expect } from 'vitest';
import { calculatePositionSize, mapAssetTypeToCategory, detectAssetCategory } from './position-sizing';

describe('calculatePositionSize', () => {
  it('requestedNotional under cap', () => {
    const res = calculatePositionSize({ availableCash: 5000, totalValue: 10000, requestedNotionalSek: 800 });
    expect(res.recommendedNotional).toBe(800);
    expect(res.portfolioPercent).toBeCloseTo(0.08);
  });

  it('requestedNotional over cap', () => {
    const res = calculatePositionSize({ availableCash: 5000, totalValue: 10000, requestedNotionalSek: 2000 });
    // cap = 10000 * 0.1 = 1000
    expect(res.recommendedNotional).toBe(1000);
    expect(res.portfolioPercent).toBeCloseTo(0.10);
  });

  it('cash less than cap', () => {
    const res = calculatePositionSize({ availableCash: 500, totalValue: 10000, requestedNotionalSek: 800 });
    // allowedMax = min(cap=1000, cash=500) => 500
    expect(res.recommendedNotional).toBe(500);
    expect(res.portfolioPercent).toBeCloseTo(0.05);
  });

  it('no requestedNotional recommends max allowed', () => {
    const res = calculatePositionSize({ availableCash: 5000, totalValue: 10000 });
    // allowedMax = min(cap=1000, cash=5000) => 1000
    expect(res.recommendedNotional).toBe(1000);
    expect(res.portfolioPercent).toBeCloseTo(0.10);
    // default confidence = 100 -> adjusted equals recommended
    expect(res.confidenceAdjustedNotional).toBe(1000);
  });

  it('confidence scaling: 100/75/50/0', () => {
    const base = { availableCash: 5000, totalValue: 10000 };
    const r100 = calculatePositionSize({ ...base, confidence: 100 });
    expect(r100.confidenceAdjustedNotional).toBe(r100.recommendedNotional);

    const r75 = calculatePositionSize({ ...base, confidence: 75 });
    expect(r75.confidenceAdjustedNotional).toBeCloseTo(r75.recommendedNotional * 0.75);

    const r50 = calculatePositionSize({ ...base, confidence: 50 });
    expect(r50.confidenceAdjustedNotional).toBeCloseTo(r50.recommendedNotional * 0.5);

    const r0 = calculatePositionSize({ ...base, confidence: 0 });
    expect(r0.confidenceAdjustedNotional).toBe(0);
  });

  it('asset category detection: stock/forex/commodity/unknown', ()=>{
    expect(mapAssetTypeToCategory('Stock')).toBe('Stock');
    expect(mapAssetTypeToCategory('ETF')).toBe('Stock');
    expect(mapAssetTypeToCategory('Forex')).toBe('Forex');
    expect(mapAssetTypeToCategory('Commodity')).toBe('Commodity');
    expect(mapAssetTypeToCategory('Blah')).toBe('Unknown');

    const p1 = { availableCash: 10000, totalValue: 10000, holdings: [{ symbol: 'EUR_USD', quantity: 1000 } as any] };
    (p1.holdings[0] as any).assetType = 'Forex';
    expect(detectAssetCategory(p1, 'EUR_USD')).toBe('Forex');

    const p2 = { availableCash: 10000, totalValue: 10000, holdings: [{ symbol: 'XAU_USD', quantity: 1 } as any] };
    (p2.holdings[0] as any).assetType = 'Commodity';
    expect(detectAssetCategory(p2, 'XAU_USD')).toBe('Commodity');

    const p3 = { availableCash: 10000, totalValue: 10000, holdings: [] };
    expect(detectAssetCategory(p3, 'NOPE')).toBe('Unknown');
  });

  it('sizing identical across categories (stock/forex/commodity)', ()=>{
    const base = { availableCash: 5000, totalValue: 10000, requestedNotionalSek: 800 };
    const stock = calculatePositionSize({ ...base, assetType: 'Stock' });
    const forex = calculatePositionSize({ ...base, assetType: 'Forex' });
    const commodity = calculatePositionSize({ ...base, assetType: 'Commodity' });
    // Results must be identical today
    expect(forex.recommendedNotional).toBe(stock.recommendedNotional);
    expect(commodity.recommendedNotional).toBe(stock.recommendedNotional);
    expect(forex.confidenceAdjustedNotional).toBe(stock.confidenceAdjustedNotional);
    expect(commodity.confidenceAdjustedNotional).toBe(stock.confidenceAdjustedNotional);
    expect(forex.portfolioPercent).toBeCloseTo(stock.portfolioPercent);
    expect(commodity.portfolioPercent).toBeCloseTo(stock.portfolioPercent);
  });
});
