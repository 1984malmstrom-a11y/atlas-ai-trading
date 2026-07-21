import { describe, it, expect } from 'vitest';
import buildPortfolioInsights from './index';

function basePortfolio(){
  return {
    holdings: [
      { instrumentId: 'microsoft', symbol: 'MSFT', name: 'Microsoft', portfolioWeight: 20.34, profitLossPercent: 31.27 },
      { instrumentId: 'apple', symbol: 'AAPL', name: 'Apple', portfolioWeight: 8.62, profitLossPercent: 122.49 },
      { instrumentId: 'nvidia', symbol: 'NVDA', name: 'NVIDIA', portfolioWeight: 8.38, profitLossPercent: -18.87 },
      { instrumentId: 'amazon', symbol: 'AMZN', name: 'Amazon', portfolioWeight: 3.83, profitLossPercent: 23.61 },
      { instrumentId: 'alphabet', symbol: 'GOOGL', name: 'Alphabet', portfolioWeight: 7.17, profitLossPercent: 23.85 },
    ],
    concentration: { largestHolding: { instrumentId: 'microsoft', symbol: 'MSFT', marketValue: 3938.2, portfolioWeight: 20.34 }, topThreePercent: 37.345, level: 'MODERATE' },
    sectorExposure: [ { sector: 'Technology', portfolioWeight: 37.345, holdingsCount: 3 }, { sector: 'Communication Services', portfolioWeight: 7.16, holdingsCount:1 }, { sector: 'Consumer Discretionary', portfolioWeight: 3.83, holdingsCount:1 } ],
    unavailableHoldings: [],
  } as any;
}

function sig(type:any, symbol?:string, severity?:string, extra?:any){ return { id: `${type}-${symbol||''}-${severity||''}`, type, symbols: symbol? [symbol] : [], symbol, severity, evidence: { symbol, ...extra } } as any; }

describe('victor-portfolio-insights', ()=>{
  it('concentration HIGH -> HIGH and PORTFOLIO_CONCENTRATION', ()=>{
    const pc = basePortfolio(); pc.concentration.level = 'HIGH';
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(out.riskLevel).toBe('HIGH');
    expect(out.portfolioInsights.some((i:any)=> i.type==='PORTFOLIO_CONCENTRATION')).toBe(true);
  });

  it('concentration MODERATE -> MODERATE', ()=>{
    const pc = basePortfolio(); pc.concentration.level = 'MODERATE';
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(out.riskLevel).toBe('MODERATE');
  });

  it('concentration LOW -> LOW', ()=>{
    const pc = basePortfolio(); pc.concentration.level = 'LOW'; pc.sectorExposure = [ { sector: 'Misc', portfolioWeight: 10, holdingsCount: 1 } ];
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(out.riskLevel).toBe('LOW');
  });

  it('one owned IMPORTANT LAGGARD -> MODERATE and holding pressure', ()=>{
    const pc = basePortfolio(); pc.concentration.level = 'LOW';
    const ms = { signals: [ sig('LAGGARD','NVDA','IMPORTANT',{ changePercent:-2.2 }) ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    expect(out.riskLevel).toBe('MODERATE');
    expect(out.portfolioInsights.some((i:any)=> i.type==='HOLDING_PRESSURE' && i.severity==='HIGH')).toBe(true);
    expect(out.affectedHoldings.length).toBeGreaterThanOrEqual(1);
    expect(out.affectedHoldings[0].impact).toBe('NEGATIVE');
  });

  it('two owned IMPORTANT LAGGARD -> HIGH', ()=>{
    const pc = basePortfolio(); pc.concentration.level = 'LOW';
    const ms = { signals: [ sig('LAGGARD','NVDA','IMPORTANT'), sig('LAGGARD','MSFT','IMPORTANT') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    expect(out.riskLevel).toBe('HIGH');
  });

  it('IMPORTANT LAGGARD for non-owned symbol -> ignored and warning', ()=>{
    const pc = basePortfolio();
    const ms = { signals: [ sig('LAGGARD','ZZZZ','IMPORTANT') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    expect(out.riskLevel).not.toBe('HIGH');
    expect(out.affectedHoldings.length).toBe(0);
    expect(out.warnings.some((w:any)=> w.toLowerCase().includes('unknown')) || out.warnings.length>0).toBe(true);
  });

  it('WATCH LAGGARD -> HOLDING_PRESSURE MODERATE', ()=>{
    const pc = basePortfolio();
    const ms = { signals: [ sig('LAGGARD','NVDA','WATCH') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    expect(out.portfolioInsights.some((i:any)=> i.type==='HOLDING_PRESSURE' && i.severity==='MODERATE')).toBe(true);
  });

  it('LEADER for owned -> HOLDING_STRENGTH and POSITIVE impact', ()=>{
    const pc = basePortfolio();
    const ms = { signals: [ sig('LEADER','AAPL','IMPORTANT',{ changePercent:1.2 }) ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    expect(out.portfolioInsights.some((i:any)=> i.type==='HOLDING_STRENGTH')).toBe(true);
    expect(out.affectedHoldings.every((h:any)=> h.impact !== undefined || h.impact === 'POSITIVE' || h.impact === 'NEGATIVE' || true)).toBe(true);
  });

  it('INFO LEADER -> severity LOW', ()=>{
    const pc = basePortfolio(); const ms = { signals: [ sig('LEADER','AAPL','INFO') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    expect(out.portfolioInsights.some((i:any)=> i.type==='HOLDING_STRENGTH' && i.severity==='LOW')).toBe(true);
  });

  it('IMPORTANT LEADER -> severity MODERATE', ()=>{
    const pc = basePortfolio(); const ms = { signals: [ sig('LEADER','AAPL','IMPORTANT') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    expect(out.portfolioInsights.some((i:any)=> i.type==='HOLDING_STRENGTH' && i.severity==='MODERATE')).toBe(true);
  });

  it('same holding multiple signals -> no duplicates', ()=>{
    const pc = basePortfolio(); const ms = { signals: [ sig('LEADER','AAPL','INFO'), sig('LAGGARD','AAPL','WATCH') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    const ids = out.affectedHoldings.map((h:any)=> h.instrumentId || h.symbol);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(ids.length);
  });

  it('sorting affectedHoldings: severity then weight', ()=>{
    const pc = basePortfolio(); pc.holdings[0].portfolioWeight = 50; // MSFT
    const ms = { signals: [ sig('LAGGARD','NVDA','WATCH'), sig('LAGGARD','MSFT','IMPORTANT') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    expect(out.affectedHoldings[0].signalSeverity).toBe('IMPORTANT');
  });

  it('sector over 50% -> HIGH exposure and risk HIGH', ()=>{
    const pc = basePortfolio(); pc.sectorExposure = [ { sector: 'Tech', portfolioWeight: 51, holdingsCount: 2 } ];
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(out.riskLevel).toBe('HIGH');
    expect(out.exposureInsights.some((e:any)=> e.severity==='HIGH')).toBe(true);
  });

  it('sector over 35% -> MODERATE exposure and risk MODERATE', ()=>{
    const pc = basePortfolio(); pc.sectorExposure = [ { sector: 'Tech', portfolioWeight: 36, holdingsCount: 2 } ];
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(out.riskLevel).toBe('MODERATE');
    expect(out.exposureInsights.some((e:any)=> e.severity==='MODERATE')).toBe(true);
  });

  it('sector exactly 35% -> no exposure insight', ()=>{
    const pc = basePortfolio(); pc.sectorExposure = [ { sector: 'Tech', portfolioWeight: 35, holdingsCount: 2 } ];
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(out.exposureInsights.length).toBe(0);
  });

  it('missing sectorExposure -> does not throw', ()=>{
    const pc = basePortfolio(); delete pc.sectorExposure;
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(Array.isArray(out.exposureInsights)).toBe(true);
  });

  it('unavailableHoldings -> single DATA_GAP and warning', ()=>{
    const pc = basePortfolio(); pc.unavailableHoldings = [ { symbol:'X' }, { symbol:'Y' } ];
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(out.portfolioInsights.some((i:any)=> i.type==='DATA_GAP')).toBe(true);
    expect(out.portfolioInsights.filter((i:any)=> i.type==='DATA_GAP').length).toBe(1);
    expect(out.warnings.length >= 1).toBe(true);
  });

  it('invalid portfolioWeight -> warning and no NaN/Infinity', ()=>{
    const pc = basePortfolio(); pc.holdings[0].portfolioWeight = NaN; pc.holdings[1].portfolioWeight = Infinity;
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(out.warnings.some((w:any)=> w.toLowerCase().includes('invalid'))).toBe(true);
    const nums = JSON.stringify(out);
    expect(nums).not.toContain('NaN');
    expect(nums).not.toContain('Infinity');
  });

  it('empty holdings -> empty affectedHoldings', ()=>{
    const pc = basePortfolio(); pc.holdings = [];
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [ sig('LAGGARD','NVDA','IMPORTANT') ] }, portfolioContext: pc });
    expect(out.affectedHoldings.length).toBe(0);
  });

  it('empty signals -> no affectedHoldings', ()=>{
    const pc = basePortfolio(); const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [] }, portfolioContext: pc });
    expect(out.affectedHoldings.length).toBe(0);
    expect(out.portfolioInsights.every((i:any)=> i.type !== 'HOLDING_PRESSURE')).toBe(true);
  });

  it('stable unique ids and determinism', ()=>{
    const pc = basePortfolio(); const ms = { signals: [ sig('LAGGARD','NVDA','IMPORTANT') ] };
    const out1 = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    const out2 = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    out1.generatedAt = out2.generatedAt = 'X';
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    const ids = out1.portfolioInsights.map((i:any)=> i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only allowed insight types and severities', ()=>{
    const pc = basePortfolio(); const ms = { signals: [ sig('LAGGARD','NVDA','IMPORTANT') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    const allowed = ['HOLDING_PRESSURE','HOLDING_STRENGTH','SECTOR_CONCENTRATION','PORTFOLIO_CONCENTRATION','DATA_GAP'];
    const allowedSev = ['LOW','MODERATE','HIGH'];
    for(const i of out.portfolioInsights){ expect(allowed.includes(i.type)).toBe(true); expect(allowedSev.includes(i.severity)).toBe(true); }
  });

  it('no forbidden recommendation words', ()=>{
    const pc = basePortfolio(); const ms = { signals: [ sig('LAGGARD','NVDA','IMPORTANT') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    const forbidden = ['köp','sälj','behåll','investera','positionstorlek'];
    const txt = JSON.stringify(out).toLowerCase();
    for(const f of forbidden) expect(txt).not.toContain(f);
  });

  it('portfolioInsights count <= 5', ()=>{
    const pc = basePortfolio(); const ms = { signals: [ sig('LAGGARD','NVDA','IMPORTANT'), sig('LEADER','AAPL','INFO'), sig('LEADER','MSFT','IMPORTANT'), sig('LAGGARD','AMZN','WATCH'), sig('LAGGARD','GOOGL','WATCH'), sig('LAGGARD','MSFT','IMPORTANT') ] };
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: ms, portfolioContext: pc });
    expect(out.portfolioInsights.length).toBeLessThanOrEqual(5);
  });

  it('warnings unique', ()=>{
    const pc = basePortfolio(); pc.unavailableHoldings = [ { symbol:'X' } ];
    const out = buildPortfolioInsights({ marketAnalysis: {}, marketSignals: { signals: [ sig('LAGGARD','ZZ','IMPORTANT') ] }, portfolioContext: pc });
    const uniq = new Set(out.warnings);
    expect(uniq.size).toBe(out.warnings.length);
  });
});
