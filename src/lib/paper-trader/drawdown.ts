export type DrawdownInput = {
  currentPortfolioValue: number;
  peakPortfolioValue: number;
};

export type DrawdownResult = {
  drawdownPercent: number; // 0..100
  isDrawdownWarning: boolean;
  isDrawdownCritical: boolean;
};

export function calculateDrawdown(input: DrawdownInput): DrawdownResult {
  if (!input || !Number.isFinite(input.currentPortfolioValue) || !Number.isFinite(input.peakPortfolioValue) || input.peakPortfolioValue <= 0) {
    return { drawdownPercent: 0, isDrawdownWarning: false, isDrawdownCritical: false };
  }

  const peak = input.peakPortfolioValue;
  const current = input.currentPortfolioValue;

  let dd = ((peak - current) / peak) * 100;
  if (!Number.isFinite(dd) || dd < 0) dd = 0;
  if (dd > 100) dd = 100;

  const isDrawdownWarning = dd >= 10;
  const isDrawdownCritical = dd >= 20;

  return { drawdownPercent: dd, isDrawdownWarning, isDrawdownCritical };
}

export default {} as any;
