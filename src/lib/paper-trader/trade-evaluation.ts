import type { TradeEvaluation } from './types';
import { calculateTradeOutcome } from './trade-outcome';

export type EvaluateTradeInput = {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  totalFees?: number;
};


export function evaluateTrade(input: EvaluateTradeInput): TradeEvaluation {
  const { entryPrice, exitPrice, quantity, totalFees = 0 } = input;

  // Delegate core PnL calculation (including validation) to calculateTradeOutcome.
  const out = calculateTradeOutcome({ entryPrice, exitPrice, quantity, totalFees });

  return {
    pnlSek: out.pnlSek,
    pnlPercent: out.pnlPercent,
    winner: out.winner,
  };
}

export default evaluateTrade;
