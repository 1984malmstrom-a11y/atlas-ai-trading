import type { PerformanceSummary, PerformanceReflection } from './types';

export function evaluatePerformanceReflection(summary: PerformanceSummary): PerformanceReflection {
  // insufficient data
  if (!summary || typeof summary.totalTrades !== 'number' || summary.totalTrades < 10){
    return { status: 'INSUFFICIENT_DATA', confidenceMultiplier: 1, reasons: ['TOO_FEW_TRADES'] };
  }

  const pf = summary.profitFactor;
  const exp = typeof summary.expectancySek === 'number' ? summary.expectancySek : 0;

  // Positive: expectancy > 0 and profitFactor present and >= 1.25
  if (exp > 0 && pf !== null && pf >= 1.25){
    return { status: 'POSITIVE', confidenceMultiplier: 1, reasons: ['EXPECTANCY_POSITIVE','PROFIT_FACTOR_GOOD'] };
  }

  // Negative: expectancy < 0 or profitFactor present and < 0.9
  if (exp < 0 || (pf !== null && pf < 0.9)){
    const reasons: string[] = [];
    if (exp < 0) reasons.push('EXPECTANCY_NEGATIVE');
    if (pf !== null && pf < 0.9) reasons.push('PROFIT_FACTOR_POOR');
    return { status: 'NEGATIVE', confidenceMultiplier: 0.5, reasons: reasons.length ? reasons : ['NEGATIVE_PERFORMANCE'] };
  }

  // Otherwise neutral
  return { status: 'NEUTRAL', confidenceMultiplier: 0.75, reasons: ['MIXED_RESULTS'] };
}

export default evaluatePerformanceReflection;
