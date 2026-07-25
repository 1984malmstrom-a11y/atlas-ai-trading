import type { TradeEvaluation, PerformanceSummary } from './types';

export function calculatePerformance(evaluations: TradeEvaluation[]): PerformanceSummary {
  const totalTrades = Array.isArray(evaluations) ? evaluations.length : 0;
  if (totalTrades === 0){
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakEvenTrades: 0,
      winRatePercent: 0,
      totalPnlSek: 0,
      averagePnlSek: 0,
      averageWinnerSek: 0,
      averageLoserSek: 0,
      profitFactor: null,
      expectancySek: 0,
    };
  }

  let winningTrades = 0;
  let losingTrades = 0;
  let breakEvenTrades = 0;
  let totalPnlSek = 0;
  let grossProfit = 0;
  let grossLoss = 0; // negative sum
  let sumWinner = 0;
  let countWinner = 0;
  let sumLoser = 0;
  let countLoser = 0;

  for (const e of evaluations){
    const pnl = typeof e.pnlSek === 'number' && Number.isFinite(e.pnlSek) ? e.pnlSek : 0;
    totalPnlSek += pnl;
    if (pnl > 0 && e.winner === true){
      winningTrades++;
      grossProfit += pnl;
      sumWinner += pnl;
      countWinner++;
    } else if (pnl < 0){
      losingTrades++;
      grossLoss += pnl; // negative
      sumLoser += pnl;
      countLoser++;
    } else {
      breakEvenTrades++;
    }
  }

  const winRatePercent = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const averagePnlSek = totalPnlSek / totalTrades;
  const averageWinnerSek = countWinner > 0 ? (sumWinner / countWinner) : 0;
  const averageLoserSek = countLoser > 0 ? (sumLoser / countLoser) : 0;
  const profitFactor = countLoser === 0 ? null : (grossProfit / Math.abs(grossLoss));
  const expectancySek = averagePnlSek;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    breakEvenTrades,
    winRatePercent,
    totalPnlSek,
    averagePnlSek,
    averageWinnerSek,
    averageLoserSek,
    profitFactor,
    expectancySek,
  };
}

export default calculatePerformance;
