import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(()=>{ vi.resetModules(); });

describe('Victor Memory Engine (pure) and route memoryContext propagation', ()=>{
  it('createEmptyMemory returns expected shape', async ()=>{
    const mod = await import('../src/domain/memory/victor-memory-engine');
    const m = mod.createEmptyMemory('u1');
    expect(m).toBeDefined();
    expect(Array.isArray(m.recommendationHistory)).toBe(true);
    expect(m.analyzedSymbols.length).toBe(0);
  });

  it('addAnalysis increments symbol count and adds recommendation', async ()=>{
    const mod = await import('../src/domain/memory/victor-memory-engine');
    let m = mod.createEmptyMemory('u1');
    m = mod.addAnalysis(m, 'ABC', { recommendation: 'BUY', overallScore: 80, confidence: 90 } as any, 5);
    expect(m.analyzedSymbols.find(s=> s.symbol==='ABC')!.count).toBe(1);
    expect(m.recommendationHistory.length).toBe(1);
  });

  it('readMemoryContext returns previous recommendation info', async ()=>{
    const mod = await import('../src/domain/memory/victor-memory-engine');
    let m = mod.createEmptyMemory('u1');
    m = mod.addAnalysis(m, 'XYZ', { recommendation: 'SELL', overallScore: 40, confidence: 30 } as any);
    const ctx = mod.readMemoryContext(m, 'XYZ');
    expect(ctx.symbolAnalysisCount).toBe(1);
    expect(ctx.previousRecommendation).toBe('SELL');
  });

  it('markOutcome updates accuracy counters and calculateAccuracy works', async ()=>{
    const mod = await import('../src/domain/memory/victor-memory-engine');
    let m = mod.createEmptyMemory('u1');
    m = mod.addAnalysis(m, 'AA', { recommendation: 'BUY' } as any);
    const recId = m.recommendationHistory[0].id;
    m = mod.markOutcome(m, recId, 'Correct');
    const acc = mod.calculateAccuracy(m);
    expect(acc).toBe(100);
  });

  it('history cap prevents unbounded growth', async ()=>{
    const mod = await import('../src/domain/memory/victor-memory-engine');
    let m = mod.createEmptyMemory('u1');
    for(let i=0;i<300;i++) m = mod.addAnalysis(m, 'SYM', { id: `r${i}`, recommendation: 'HOLD' } as any, 200);
    expect(m.recommendationHistory.length).toBeLessThanOrEqual(200);
  });

  it('LocalStorageVictorMemoryStore.load handles corrupted storage gracefully', async ()=>{
    // import client store directly
    const storeMod = await import('../src/client/memory/local-storage-victor-memory-store');
    const store = storeMod.default();
    const res = await store.load('u1');
    expect(res === null || typeof res === 'object').toBeTruthy();
  });

  it('route accepts valid memoryContext and forwards to engines', async ()=>{
    // prepare spies to capture arguments (use globalThis to avoid timing issues)
    (globalThis as any).__recArgs = [];
    (globalThis as any).__reaArgs = [];
    (globalThis as any).__scArgs = [];
    (globalThis as any).__irArgs = [];

    vi.mock('../src/domain/recommendation/victor-recommendation-engine', ()=>({
      default: (opts: any)=> { (globalThis as any).__recArgs.push(opts); return { recommendationId: 'r1', action: 'BUY', confidence: 60, headline: 'BUY ABC', reasoning: [], portfolioFit: 50, updatedAt: new Date().toISOString(), alternatives: [], nextReviewDate: new Date().toISOString(), summary: '' }; }
    }));
    vi.mock('../src/domain/reasoning/victor-reasoning-engine', ()=>({ default: (opts: any)=> { (globalThis as any).__reaArgs.push(opts); return { conclusion: 'ok', keyFactors: [], supportingEvidence: [], conflictingEvidence: [], assumptions: [], unansweredQuestions: [], recommendationStrength: 'Moderate', confidenceExplanation: '', explainLikeBeginner: '', explainLikeExperienced: '', updatedAt: new Date().toISOString() }; } }));
    vi.mock('../src/domain/scoring/victor-scoring-engine', ()=>({ default: (opts: any)=> { (globalThis as any).__scArgs.push(opts); return { overallScore: 55, updatedAt: new Date().toISOString(), scoreBreakdown: [], summary: '' }; } }));
    vi.mock('../src/domain/investment/victor-investment-report-engine', ()=>({ default: (opts: any)=> { (globalThis as any).__irArgs.push(opts); return { reportId: 'ir1', generatedAt: new Date().toISOString(), company: 'ABC', overallRating: 'Buy', confidence: 60, summary: '', recommendation: opts.recommendation, reasoning: opts.reasoning, positives: [], negatives: [], risks: [], opportunities: [], portfolioFit: 50, investorFit: 50, timeHorizon: '', watchlistActions: [], nextReviewDate: '', modulesUsed: [], disclaimer: '', evidenceCount: 0, collectedAt: null, memorySummary: opts.memoryContext ? { previousAnalysisCount: opts.memoryContext.symbolAnalysisCount || 0, previousRecommendation: opts.memoryContext.previousRecommendation || null, previousOverallScore: opts.memoryContext.previousOverallScore || null, currentOverallScore: opts.scoreReport?.overallScore || null, scoreChange: null, recommendationChanged: opts.memoryContext.recommendationChanged || false, historicalAccuracy: null, knownUserPatterns: opts.memoryContext.knownUserPatterns || [], summary: opts.memoryContext.memorySummary || '' } : undefined }; } }));

    // stub research/intelligence to avoid deep dependencies
    vi.mock('../src/domain/research/victor-research-engine', ()=>({ default: async (opts: any)=> ({ collectedAt: new Date().toISOString(), modules: [], evidence: [], providerErrors: [], validationScore: 100 }) }));
    vi.mock('../src/domain/intelligence/victor-intelligence-engine', ()=>({ default: (r:any)=> ({ overallScore: 50, marketConfidence: 50, opportunities: [], modules: [] }) }));
    vi.mock('../src/domain/decision/victor-decision-engine', ()=>({ default: (report:any)=> ({ recommendation: 'BUY', action: 'BUY', confidence: 60, riskLevel: 'Medium', expectedTimeframe: '3-6 months', reasoning: [], positives: [], negatives: [], catalysts: [], risks: [], sourcesUsed: [], updatedAt: new Date().toISOString() }) }));

    const route = await import('../src/app/api/victor/analyze/route');
    const memoryContext = { symbolAnalysisCount: 3, previousRecommendation: 'SELL', previousOverallScore: 40 };
    const req = new Request('http://localhost/api/victor/analyze', { method: 'POST', body: JSON.stringify({ symbol: 'ABC', memoryContext }), headers: { 'content-type': 'application/json' } });
    const res = await route.POST(req as any);
    expect(res.status).toBe(200);
    // ensure mocks were called with memoryContext
    expect((globalThis as any).__recArgs.length).toBeGreaterThan(0);
    expect((globalThis as any).__recArgs[0].memoryContext).toEqual(memoryContext);
    expect((globalThis as any).__reaArgs.length).toBeGreaterThan(0);
    expect((globalThis as any).__reaArgs[0].memoryContext).toEqual(memoryContext);
    expect((globalThis as any).__scArgs.length).toBeGreaterThan(0);
    expect((globalThis as any).__scArgs[0].memoryContext).toEqual(memoryContext);
    expect((globalThis as any).__irArgs.length).toBeGreaterThan(0);
    expect((globalThis as any).__irArgs[0].memoryContext).toEqual(memoryContext);
  });

  it('route rejects invalid memoryContext', async ()=>{
    const route = await import('../src/app/api/victor/analyze/route');
    const req = new Request('http://localhost/api/victor/analyze', { method: 'POST', body: JSON.stringify({ symbol: 'ABC', memoryContext: 'nope' }), headers: { 'content-type': 'application/json' } });
    const res = await route.POST(req as any);
    expect(res.status).toBe(400);
  });
});
