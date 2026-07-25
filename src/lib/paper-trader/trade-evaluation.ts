import { TradeEvaluation } from './types';

export type EvaluateTradeInput = {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
};

export function evaluateTrade(input: EvaluateTradeInput): TradeEvaluation {
  const { entryPrice, exitPrice, quantity } = input;

  const pnlSek = (exitPrice - entryPrice) * quantity;
  const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  const winner = pnlSek > 0;

  return {
    pnlSek,
    pnlPercent,
    winner,
  };
}

export default evaluateTrade;
