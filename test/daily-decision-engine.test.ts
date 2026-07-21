import { describe, it, expect } from 'vitest';
import { dailyDecisionEngine } from '../src/domain/analysis/daily-decision-engine';
import { getMockPortfolio } from '../src/data/mock-portfolio';
import mockAnalysis from '../src/data/mock-analysis-data';

describe('DailyDecisionEngine', () => {
  it('suggests BUY when rules satisfied', () => {
    const portfolio = getMockPortfolio();
    const tech = mockAnalysis.mockTechnical.find(t=>t.symbol==='NEW-ASSET')!;
    const fund = mockAnalysis.mockFundamental.find(f=>f.symbol==='NEW-ASSET')!;
    const news = mockAnalysis.mockNews.find(n=>n.symbol==='NEW-ASSET')!;
    const risk = mockAnalysis.mockRisk.find(r=>r.symbol==='NEW-ASSET')!;
    const decision = dailyDecisionEngine({ portfolio, technical: tech, fundamental: fund, news, risk });
    expect(decision.action).toBe('BUY');
  });

  it('returns deterministic result for same input', () => {
    const portfolio = getMockPortfolio();
    const tech = mockAnalysis.mockTechnical.find(t=>t.symbol==='NEW-ASSET')!;
    const fund = mockAnalysis.mockFundamental.find(f=>f.symbol==='NEW-ASSET')!;
    const news = mockAnalysis.mockNews.find(n=>n.symbol==='NEW-ASSET')!;
    const risk = mockAnalysis.mockRisk.find(r=>r.symbol==='NEW-ASSET')!;
    const d1 = dailyDecisionEngine({ portfolio, technical: tech, fundamental: fund, news, risk });
    const d2 = dailyDecisionEngine({ portfolio, technical: tech, fundamental: fund, news, risk });
    expect(d1.action).toBe(d2.action);
    expect(d1.confidence).toBe(d2.confidence);
  });
});
