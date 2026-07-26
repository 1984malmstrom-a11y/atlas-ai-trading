export type TradeOutcome = {
  pnlSek: number;
  pnlPercent: number;
  winner: boolean;
};

export function calculateTradeOutcome(args: {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  totalFees: number;
}): TradeOutcome {
  const { entryPrice, exitPrice, quantity, totalFees } = args;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new Error('entryPrice must be > 0');
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) throw new Error('exitPrice must be > 0');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('quantity must be > 0');
  if (!Number.isFinite(totalFees) || totalFees < 0) throw new Error('totalFees must be >= 0');

  const gross = (exitPrice - entryPrice) * quantity;
  const net = gross - totalFees;
  const pnlPercent = (net / (entryPrice * quantity)) * 100;
  const winner = net > 0;

  return { pnlSek: net, pnlPercent, winner };
}

export default calculateTradeOutcome;
