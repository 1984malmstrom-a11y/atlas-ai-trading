import { calculateTradeOutcome } from './trade-outcome';
import { createTradeReview, type TradeReview } from './trade-review';

export function buildTradeReview(args: {
  executionId: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  totalFees: number;
  holdingMinutes: number;
  confidenceAtEntry: number | null;
  createdAt: string;
}): TradeReview {
  const outcome = calculateTradeOutcome({
    entryPrice: args.entryPrice,
    exitPrice: args.exitPrice,
    quantity: args.quantity,
    totalFees: args.totalFees,
  });

  return createTradeReview({
    executionId: args.executionId,
    symbol: args.symbol,
    entryPrice: args.entryPrice,
    exitPrice: args.exitPrice,
    quantity: args.quantity,
    totalFees: args.totalFees,
    pnlSek: outcome.pnlSek,
    pnlPercent: outcome.pnlPercent,
    winner: outcome.winner,
    holdingMinutes: args.holdingMinutes,
    confidenceAtEntry: args.confidenceAtEntry,
    createdAt: args.createdAt,
  });
}

export default buildTradeReview;
