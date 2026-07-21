import { describe, it, expect } from 'vitest';
import analyzePortfolio from '../src/domain/portfolio/victor-portfolio-intelligence-engine';
import LocalStoragePortfolioStore from '../src/client/portfolio/local-storage-portfolio-store';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import VictorPortfolioIntelligencePanel from '../src/components/atlas/VictorPortfolioIntelligencePanel';

describe('Victor Portfolio Intelligence Engine', ()=>{
  it('handles empty portfolio', async ()=>{
    const r = await analyzePortfolio(undefined);
    expect(r.holdingsCount).toBe(0);
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it('calculates weights and largest holding', async ()=>{
    const snap = { holdings: [ { symbol: 'A', quantity: 10, currentPrice: 10 }, { symbol: 'B', quantity: 1, currentPrice: 100 } ] };
    const r = await analyzePortfolio(snap as any);
    expect(r.totalValue).toBeGreaterThan(0);
    expect(r.holdingsCount).toBe(2);
    expect(r.largestHolding).toBeDefined();
  });

  it('detects concentration risk thresholds', async ()=>{
    const snap = { holdings: [ { symbol: 'X', quantity: 100, currentPrice: 10 }, { symbol: 'Y', quantity: 1, currentPrice: 1 } ] };
    const r = await analyzePortfolio(snap as any);
    expect(r.largestHoldingWeight).toBeGreaterThan(15);
    expect(r.risks.length).toBeGreaterThan(0);
  });

  it('computes sector exposure and correlated holdings', async ()=>{
    const snap = { holdings: [ { symbol: 'AA', quantity: 10, currentPrice: 10, sector: 'Tech', country: 'SE' }, { symbol: 'BB', quantity: 5, currentPrice: 20, sector: 'Tech', country: 'SE' }, { symbol: 'CC', quantity: 1, currentPrice: 100, sector: 'Health', country: 'US' } ] };
    const r = await analyzePortfolio(snap as any);
    expect(r.sectorExposure.length).toBeGreaterThanOrEqual(1);
    expect(r.correlatedHoldings.length).toBeGreaterThanOrEqual(1);
  });
});

describe('LocalStoragePortfolioStore SSR-safety', ()=>{
  it('does not throw when window is undefined', ()=>{
    const store = LocalStoragePortfolioStore();
    // in test environment we don't have window/localStorage; load should return null
    const res = store.load();
    expect(res === null || typeof res === 'object').toBeTruthy();
  });
});

describe('Panel rendering', ()=>{
  it('shows empty UI for empty report', ()=>{
    const html = renderToStaticMarkup(<VictorPortfolioIntelligencePanel report={{ holdingsCount:0 }} />);
    expect(html.includes('Din portfölj är tom')).toBe(true);
  });

  it('renders full report without undefined or NaN', ()=>{
    const report = { holdingsCount: 2, totalValue: 1000, largestHolding: { symbol: 'A' }, largestHoldingWeight: 30, diversificationScore: 40, concentrationScore: 70, portfolioRiskScore: 60, profileAlignmentScore: 50, sectorExposure: [{ name: 'Tech', percentage: 60 }], risks: ['r1'], recommendations: ['rec'] };
    const html = renderToStaticMarkup(<VictorPortfolioIntelligencePanel report={report as any} />);
    expect(html.includes('undefined')).toBe(false);
    expect(html.includes('NaN')).toBe(false);
    expect(html.includes('Tech: 60%')).toBe(true);
  });
});
