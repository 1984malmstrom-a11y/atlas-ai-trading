// Simple observe-only Fundamental Analysis Engine (mocked)
export function analyzeFundamentals(input: any) {
  // Accept explicit score in input for test determinism, otherwise derive from ticker
  let score: number;
  if (input && typeof input.score !== 'undefined' && input.score !== null) {
    const n = Number(input.score);
    score = Number.isFinite(n) ? Math.round(Math.max(0, Math.min(100, n))) : 0;
  } else {
    const id = String((input && (input.symbol || input.ticker)) || 'ZZ').toUpperCase();
    let s = 0;
    for (let i = 0; i < id.length; i++) s = (s + id.charCodeAt(i) * (i + 1)) >>> 0;
    score = s % 101;
  }

  let signal: 'BUY' | 'HOLD' | 'SELL' = 'HOLD';
  if (score >= 75) signal = 'BUY';
  else if (score >= 50) signal = 'HOLD';
  else signal = 'SELL';

  // Deterministic reasons based on signal and score (2-4 short items)
  const reasons: string[] = [];
  if (signal === 'BUY') {
    reasons.push('Strong earnings');
    reasons.push('Revenue growth');
    if (score >= 90) reasons.push('High margin');
    if (score >= 95) reasons.push('Exceptional cash flow');
  } else if (signal === 'HOLD') {
    reasons.push('Stable earnings');
    reasons.push('Neutral growth');
    if (score >= 65) reasons.push('Improving margins');
    if (score >= 80) reasons.push('Increasing cash reserves');
  } else {
    reasons.push('Weak earnings');
    reasons.push('Declining revenue');
    if (score <= 30) reasons.push('High leverage');
    if (score <= 15) reasons.push('Liquidity concerns');
  }

  // Ensure 2-4 reasons
  while (reasons.length > 4) reasons.pop();
  if (reasons.length < 2) reasons.push('No clear drivers');

  return { status: 'success', score, signal, reasons } as const;
}

export default analyzeFundamentals;
