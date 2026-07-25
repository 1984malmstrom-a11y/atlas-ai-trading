export type SignalScoreInput = {
  expectedReturnPercent: number;
};

export type SignalScoreResult = {
  score: number; // 0-100
  reasons: string[];
};

export function calculateSignalScore(input: SignalScoreInput): SignalScoreResult {
  const reasons: string[] = [];
  const exp = typeof input.expectedReturnPercent === 'number' && Number.isFinite(input.expectedReturnPercent) ? input.expectedReturnPercent : 0;

  let score = 50;
  if (exp > 5) { score += 20; reasons.push('EXPECT_GT_5'); }
  if (exp > 10) { score += 20; reasons.push('EXPECT_GT_10'); }
  if (exp < -5) { score -= 20; reasons.push('EXPECT_LT_-5'); }
  if (exp < -10) { score -= 20; reasons.push('EXPECT_LT_-10'); }

  // Extra adjustment for extreme expectations so large magnitudes can exceed bounds before clamping
  if (exp >= 100) score += 10;
  if (exp <= -100) score -= 10;

  if (!Number.isFinite(score)) score = 0;
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return { score, reasons };
}

export default {} as any;
