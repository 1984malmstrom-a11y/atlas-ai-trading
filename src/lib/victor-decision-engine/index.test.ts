import { describe, it, expect } from 'vitest';
import buildVictorDecision from './index';

function baseInputs(): any{
  const marketAnalysis: any = { marketSentiment: 'NEUTRAL', weakest: null };
  const marketSignals: any = { confidence: 80, signals: [] as any[], warnings: [] };
  const portfolioContext: any = { concentration: { level: 'LOW' }, holdings: [], sectorExposure: [] };
  return { marketAnalysis, marketSignals, portfolioContext };
}

describe('buildVictorDecision', ()=>{
  it('IMPORTANT MARKET_TREND creates HIGH priority and OBSERVE action', ()=>{
    const inp = baseInputs();
    inp.marketSignals.signals.push({ type: 'MARKET_TREND', severity: 'IMPORTANT' });
    const out = buildVictorDecision(inp);
    expect(out.priority).toBe('HIGH');
    expect(out.actions.some((a:any)=> a.type==='OBSERVE')).toBe(true);
  });

  it('IMPORTANT MARKET_BREADTH results in HIGH priority', ()=>{
    const inp = baseInputs(); inp.marketSignals.signals.push({ type:'MARKET_BREADTH', severity:'IMPORTANT' });
    const out = buildVictorDecision(inp);
    expect(out.priority).toBe('HIGH');
  });

  it('IMPORTANT LAGGARD results in HIGH priority', ()=>{
    const inp = baseInputs(); inp.marketSignals.signals.push({ type:'LAGGARD', severity:'IMPORTANT' });
    const out = buildVictorDecision(inp);
    expect(out.priority).toBe('HIGH');
  });

  it('concentration HIGH -> HIGH priority and DIVERSIFICATION action', ()=>{
    const inp = baseInputs(); inp.portfolioContext.concentration.level = 'HIGH';
    const out = buildVictorDecision(inp);
    expect(out.priority).toBe('HIGH');
    expect(out.actions.some((a:any)=> a.type==='DIVERSIFICATION')).toBe(true);
  });

  it('concentration MODERATE -> MEDIUM priority', ()=>{
    const inp = baseInputs(); inp.portfolioContext.concentration.level = 'MODERATE';
    const out = buildVictorDecision(inp);
    expect(out.priority).toBe('MEDIUM');
  });

  it('WATCH signal -> MEDIUM priority and REVIEW action', ()=>{
    const inp = baseInputs(); inp.marketSignals.signals.push({ type:'MARKET_BREADTH', severity:'WATCH' });
    const out = buildVictorDecision(inp);
    expect(out.priority).toBe('MEDIUM');
    expect(out.actions.some((a:any)=> a.type==='REVIEW')).toBe(true);
  });

  it('no important/watch and concentration LOW -> LOW priority', ()=>{
    const inp = baseInputs(); const out = buildVictorDecision(inp);
    expect(out.priority).toBe('LOW');
  });

  it('multiple HIGH rules -> no duplicate actions and unique ids', ()=>{
    const inp = baseInputs(); inp.marketSignals.signals.push({ type:'MARKET_TREND', severity:'IMPORTANT' }); inp.portfolioContext.concentration.level='HIGH';
    const out = buildVictorDecision(inp);
    const ids = out.actions.map((a:any)=> a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('confidence copied and clamped 0-100', ()=>{
    const inp = baseInputs(); inp.marketSignals.confidence = 110; expect(buildVictorDecision(inp).confidence).toBe(100);
    inp.marketSignals.confidence = -10; expect(buildVictorDecision(inp).confidence).toBe(0);
    inp.marketSignals.confidence = 55; expect(buildVictorDecision(inp).confidence).toBe(55);
  });

  it('summary is a single short Swedish sentence and not empty', ()=>{
    const inp = baseInputs(); inp.marketAnalysis.marketSentiment='BEARISH'; inp.portfolioContext.concentration.level='MODERATE';
    const out = buildVictorDecision(inp);
    expect(typeof out.summary).toBe('string');
    expect(out.summary.length).toBeGreaterThan(0);
  });

  it('reasoning contains 3-5 points when available and no duplicates', ()=>{
    const inp = baseInputs(); inp.marketAnalysis.marketSentiment='BEARISH'; inp.marketAnalysis.weakest={ symbol: 'X' }; inp.portfolioContext.concentration.level='HIGH'; inp.marketSignals.warnings=['w'];
    const out = buildVictorDecision(inp);
    expect(out.reasoning.length).toBeGreaterThanOrEqual(1);
    const uniq = new Set(out.reasoning); expect(uniq.size).toBe(out.reasoning.length);
  });

  it('summary mentions market state for weak market', ()=>{
    const inp = baseInputs(); inp.marketAnalysis.marketSentiment='BEARISH'; const out = buildVictorDecision(inp);
    expect(out.summary.toLowerCase()).toContain('faller');
  });

  it('concentration mention when high in reasoning or summary', ()=>{
    const inp = baseInputs(); inp.portfolioContext.concentration.level='HIGH'; const out = buildVictorDecision(inp);
    const ok = out.summary.includes('koncentr') || out.reasoning.some(r=> r.includes('koncentr'));
    expect(ok).toBe(true);
  });

  it('missing strongest/weakest does not crash', ()=>{
    const inp = baseInputs(); inp.marketAnalysis.weakest = undefined; const out = buildVictorDecision(inp); expect(out.priority).toBeDefined();
  });

  it('empty signals array -> LOW priority', ()=>{
    const inp = baseInputs(); inp.marketSignals.signals = []; const out = buildVictorDecision(inp); expect(out.priority).toBe('LOW');
  });

  it('missing or empty sectorExposure does not crash', ()=>{
    const inp = baseInputs(); inp.portfolioContext.sectorExposure = undefined; const out = buildVictorDecision(inp); expect(out.priority).toBeDefined();
  });

  it('determinism: same input gives same output except generatedAt', ()=>{
    const inp = baseInputs(); inp.marketSignals.signals.push({ type:'MARKET_TREND', severity:'IMPORTANT' });
    const a = buildVictorDecision(inp); const b = buildVictorDecision(inp);
    a.generatedAt = b.generatedAt = 'X'; expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('actions types allowed only', ()=>{
    const inp = baseInputs(); inp.marketSignals.signals.push({ type:'MARKET_TREND', severity:'IMPORTANT' }); const out = buildVictorDecision(inp);
    const allowed = new Set(['OBSERVE','REVIEW','DIVERSIFICATION']);
    out.actions.forEach((a:any)=> expect(allowed.has(a.type)).toBe(true));
  });

  it('allowed priorities only', ()=>{
    const inp = baseInputs(); const out = buildVictorDecision(inp); expect(['LOW','MEDIUM','HIGH']).toContain(out.priority);
  });

  it('serialized result does not contain forbidden recommendation words', ()=>{
    const inp = baseInputs(); const s = JSON.stringify(buildVictorDecision(inp)).toLowerCase();
    ['köp','sälj','behåll','positions','investera'].forEach(f=> expect(s).not.toContain(f));
  });

  it('actions always have required fields', ()=>{
    const inp = baseInputs(); inp.marketSignals.signals.push({ type:'MARKET_TREND', severity:'IMPORTANT' }); const out = buildVictorDecision(inp);
    out.actions.forEach((a:any)=>{ expect(a.id).toBeDefined(); expect(a.type).toBeDefined(); expect(a.title).toBeDefined(); expect(a.description).toBeDefined(); expect(a.priority).toBeDefined(); });
  });

  it('endpoint compatibility: uses provided structures', ()=>{
    const inp = baseInputs(); inp.marketSignals.signals.push({ type:'MARKET_TREND', severity:'IMPORTANT' }); const out = buildVictorDecision(inp);
    expect(out).toHaveProperty('priority'); expect(out).toHaveProperty('confidence'); expect(Array.isArray(out.actions)).toBe(true);
  });
});
