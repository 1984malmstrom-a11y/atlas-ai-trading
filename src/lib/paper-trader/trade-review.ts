export type TradeReview = {
  executionId: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  totalFees: number;

  pnlSek: number;
  pnlPercent: number;
  winner: boolean;

  holdingMinutes: number;

  confidenceAtEntry: number | null;

  createdAt: string;
};

export function createTradeReview(args: TradeReview): TradeReview {
  if (!args || typeof args !== 'object') throw new Error('invalid args');

  if (typeof args.executionId !== 'string' || args.executionId.trim() === '') {
    throw new Error('executionId must not be empty');
  }
  if (typeof args.symbol !== 'string' || args.symbol.trim() === '') {
    throw new Error('symbol must not be empty');
  }
  if (typeof args.holdingMinutes !== 'number' || args.holdingMinutes < 0) {
    throw new Error('holdingMinutes must be >= 0');
  }
  if (typeof args.createdAt !== 'string' || args.createdAt.trim() === '') {
    throw new Error('createdAt must not be empty');
  }

  const out: TradeReview = {
    executionId: args.executionId,
    symbol: args.symbol,
    entryPrice: args.entryPrice,
    exitPrice: args.exitPrice,
    quantity: args.quantity,
    totalFees: args.totalFees,
    pnlSek: args.pnlSek,
    pnlPercent: args.pnlPercent,
    winner: args.winner,
    holdingMinutes: args.holdingMinutes,
    confidenceAtEntry: args.confidenceAtEntry,
    createdAt: args.createdAt,
  };

  return Object.freeze(out);
}
