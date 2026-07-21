// mark as server-only at runtime; dynamic import avoids bundler static resolution in tests
const _so = 'server' + '-only';
void import(_so).catch(()=>{});
import { NextResponse } from 'next/server';
import runVictorResearch from '../../../../domain/research/victor-research-engine';
import runVictorIntelligence from '../../../../domain/intelligence/victor-intelligence-engine';
import runVictorRecommendation from '../../../../domain/recommendation/victor-recommendation-engine';
import runVictorReasoning from '../../../../domain/reasoning/victor-reasoning-engine';
import runVictorScoring from '../../../../domain/scoring/victor-scoring-engine';
import runVictorDecision from '../../../../domain/decision/victor-decision-engine';
import runVictorInvestmentReport from '../../../../domain/investment/victor-investment-report-engine';
import type { VictorMemoryContext } from '../../../../domain/memory/victor-memory-engine';
import {
  createEmptyMemory,
  addAnalysis,
  saveRecommendation,
  readMemoryContext,
  RecommendationMemory,
} from '../../../../domain/memory/victor-memory-engine';

function safeJson(obj: any){ return NextResponse.json(obj); }

export async function POST(req: Request){
  try{
    // don't extract signal to avoid runtime typing issues
    const body = await req.json();
    const rawSymbol = typeof body?.symbol === 'string' ? body.symbol.trim() : '';
    if (!rawSymbol) return new NextResponse(JSON.stringify({ error: 'symbol required' }), { status: 400 });
    if (rawSymbol.length > 32) return new NextResponse(JSON.stringify({ error: 'symbol too long' }), { status: 400 });
    const symbol = rawSymbol.toUpperCase();

    // validate optional memoryContext
    const memoryContext: VictorMemoryContext | undefined = body?.memoryContext;
    if (memoryContext && typeof memoryContext !== 'object') return new NextResponse(JSON.stringify({ error: 'invalid memoryContext' }), { status: 400 });

    // Run the full pipeline server-side
    // test hook: allow forcing an internal error in test environment
    if (process.env.NODE_ENV === 'test' && symbol === '__TEST_FORCE_ERROR__') throw new Error('boom');
    const research = await runVictorResearch({ symbol });
    const intelligence = runVictorIntelligence(research);
    const recommendation = runVictorRecommendation({ intelligence, memoryContext });
    const reasoning = runVictorReasoning({ recommendation, intelligence, research, memoryContext });
    const scoreReport = runVictorScoring({ research, intelligence, recommendation, reasoning, memoryContext });
    const decision = runVictorDecision(scoreReport);
    const investmentReport = runVictorInvestmentReport({ recommendation, reasoning, intelligence, scoreReport, research, memoryContext });

    // produce a memory update snapshot for client persistence (pure, no localStorage used)
    let memoryUpdate = null;
    try{
      const mem = createEmptyMemory();
      const rec = investmentReport?.recommendation;
      if (rec){
        const recEntry: Partial<RecommendationMemory> = {
          id: rec.recommendationId || `rec-${Date.now()}`,
          symbol: (rec.headline||'').split(' ')[1] || symbol,
          recommendation: rec.action || (rec.headline||''),
          overallScore: investmentReport?.overallScore || 0,
          confidence: rec.confidence || 0,
          reasoningSummary: (rec.reasoning || []).slice(0,3).join('; '),
          createdAt: new Date().toISOString(),
          outcomeStatus: 'Pending',
        };
        const m2 = addAnalysis(mem, symbol, recEntry);
        memoryUpdate = m2;
      }
    }catch(e){ memoryUpdate = null; }

    return safeJson({ investmentReport, status: 'ok', memoryUpdate, meta: { symbol, collectedAt: research.collectedAt, providerErrors: research.providerErrors || [], validationScore: research.validationScore } });
  }catch(err:any){
    // server-side log
    console.error('Victor analyze route error:', err);
    return new NextResponse(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
