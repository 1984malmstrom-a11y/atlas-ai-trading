export type PositionSizingInput = {
  availableCash: number;
  totalValue: number;
  requestedNotionalSek?: number;
  maxPositionPercent?: number; // fraction, default 0.10
  confidence?: number; // 0-100 — optional scaling factor from Decision Engine
};

export type PositionSizingResult = {
  recommendedNotional: number;
  portfolioPercent: number; // recommendedNotional / totalValue (0-1)
  confidenceAdjustedNotional: number;
};

export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const { availableCash, totalValue } = input;
  const maxPositionPercent = (typeof input.maxPositionPercent === 'number' && Number.isFinite(input.maxPositionPercent)) ? input.maxPositionPercent : 0.10;

  // Validate numeric inputs conservatively
  const safeCash = Number.isFinite(availableCash) && availableCash > 0 ? availableCash : 0;
  const safeTotal = Number.isFinite(totalValue) && totalValue > 0 ? totalValue : 0;

  const cap = safeTotal > 0 ? (safeTotal * maxPositionPercent) : 0;
  const allowedMax = Math.min(cap, safeCash);

  let recommended = 0;
  if (typeof input.requestedNotionalSek === 'number' && Number.isFinite(input.requestedNotionalSek) && input.requestedNotionalSek > 0) {
    recommended = Math.min(input.requestedNotionalSek, allowedMax);
  } else {
    // No explicit request: recommend the full allowed maximum
    recommended = allowedMax;
  }

  if (!Number.isFinite(recommended) || recommended < 0) recommended = 0;

  const portfolioPercent = safeTotal > 0 ? (recommended / safeTotal) : 0;

  // Apply confidence scaling — default to 100 when undefined
  const confidence = (typeof input.confidence === 'number' && Number.isFinite(input.confidence) && input.confidence >= 0) ? input.confidence : 100;
  const confidenceAdjustedNotional = Math.max(0, recommended * (confidence / 100));

  return { recommendedNotional: recommended, portfolioPercent, confidenceAdjustedNotional };
}

export default {} as any;
