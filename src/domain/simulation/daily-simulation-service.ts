import { getMockPortfolio } from '../../data/mock-portfolio';
import mockAnalysis from '../../data/mock-analysis-data';
import dailyDecisionEngine from '../analysis/daily-decision-engine';
import { PaperTradingEngine, Order } from '../trading/paper-trading-engine';
import { CoachDecision } from '../analysis/types';

export type SimulationResult = {
  runAt: string;
  originalPortfolio: ReturnType<typeof getMockPortfolio>;
  updatedPortfolio: ReturnType<typeof getMockPortfolio> | null;
  decisions: CoachDecision[];
  executedTrades: any[]; // Execution objects
  deniedTrades: any[];
  summarySwe: string;
}

export function runDailySimulation(): SimulationResult {
  const original = getMockPortfolio();
  const decisions: CoachDecision[] = [];
  const executedTrades: any[] = [];
  const deniedTrades: any[] = [];

  // Build analyses keyed by symbol for matching
  const techMap = new Map(mockAnalysis.mockTechnical.map(t => [t.symbol, t] as const));
  const fundMap = new Map(mockAnalysis.mockFundamental.map(f => [f.symbol, f] as const));
  const newsMap = new Map(mockAnalysis.mockNews.map(n => [n.symbol, n] as const));
  const riskMap = new Map(mockAnalysis.mockRisk.map(r => [r.symbol, r] as const));

  // Run engine for each available analysis
  for (const tech of mockAnalysis.mockTechnical) {
    const fund = fundMap.get(tech.symbol);
    const news = newsMap.get(tech.symbol);
    const risk = riskMap.get(tech.symbol);
    if (!fund || !news || !risk) continue;
    const decision = dailyDecisionEngine({ portfolio: original, technical: tech, fundamental: fund, news, risk });
    decisions.push(decision);
  }

  // Choose at most one SELL by highest confidence. BUY decisions are left for manual approval (PENDING_APPROVAL)
  const sells = decisions.filter(d => d.action === 'SELL').sort((a,b)=> b.confidence - a.confidence);

  const toExecute: CoachDecision[] = [];
  if (sells.length) toExecute.push(sells[0]);
  let portfolioAfter = JSON.parse(JSON.stringify(original));
  const engine = new PaperTradingEngine(portfolioAfter);

  for (const d of decisions) {
    if (!toExecute.find(t=>t.id===d.id)) continue; // only execute selected (sells)
    // Build order
    const price = d.suggestedQuantity > 0 ? Math.max(1, Math.round((portfolioAfter.totalValue * d.suggestedPositionPercent) / Math.max(1,d.suggestedQuantity))) : 100;
    const order: Order = {
      id: d.id,
      symbol: d.symbol,
      side: d.action === 'BUY' ? 'Köp' : 'Sälj',
      quantity: Math.max(1, d.suggestedQuantity),
      price,
    };
    const result = engine.simulateExecution(order);
    if (result.success) {
      executedTrades.push(result.transaction);
      portfolioAfter = result.portfolio;
      // update engine's portfolio reference
      (engine as any).portfolio = portfolioAfter;
    } else {
      deniedTrades.push(result);
    }
  }

  const summarySwe = `Körning: analyserade ${decisions.length} tillgångar. Genomförda affärer: ${executedTrades.length}. Nekade: ${deniedTrades.length}.`;

  return {
    runAt: new Date().toISOString(),
    originalPortfolio: original,
    updatedPortfolio: portfolioAfter,
    decisions,
    executedTrades,
    deniedTrades,
    summarySwe,
  };
}

export default runDailySimulation;
