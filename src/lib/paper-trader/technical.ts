// Deterministic technical analysis helper for Victor
// Does not use network, files, randomness, or mutate inputs.

export type Trend = 'bullish' | 'neutral' | 'bearish';

export type AnalysisResult = {
  trend: Trend;
  momentumPercent: number;
  volatilityPercent: number;
  technicalScore: number; // 0..100
  signal: 'BUY' | 'HOLD' | 'SELL';
  reasons: string[];
};

function avg(arr: number[]){
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function clamp(n: number, lo: number, hi: number){ return Math.max(lo, Math.min(hi, n)); }

export function analyzePriceSeries(prices: number[]): AnalysisResult{
  // Defensive: do not mutate input
  const p = prices.slice();
  const n = p.length;
  const reasons: string[] = [];

  // Validate numeric prices
  const clean = p.map(x => (typeof x === 'number' && Number.isFinite(x) ? x : NaN));
  if (clean.some(isNaN)){
    reasons.push('invalid price value');
    return { trend: 'neutral', momentumPercent: 0, volatilityPercent: 0, technicalScore: 0, signal: 'HOLD', reasons };
  }

  // Need at least 20 data points to compute long trend and produce a meaningful signal
  const MIN_REQUIRED = 20;
  if (n < MIN_REQUIRED){
    reasons.push(`insufficient data: have ${n}, need ${MIN_REQUIRED}`);
    return { trend: 'neutral', momentumPercent: 0, volatilityPercent: 0, technicalScore: 0, signal: 'HOLD', reasons };
  }

  // Short and long averages
  const last = (arr: number[], k: number) => arr.slice(Math.max(0, arr.length - k));
  const shortWindow = last(clean, 5);
  const longWindow = last(clean, 20);
  const shortAvg = avg(shortWindow);
  const longAvg = avg(longWindow);

  // momentum: compare last price to price 10 days ago
  const idx10 = Math.max(0, n - 11);
  const price10Ago = clean[idx10];
  const lastPrice = clean[clean.length - 1];
  const momentumPercent = price10Ago > 0 ? ((lastPrice - price10Ago) / price10Ago) * 100 : 0;

  // volatility: mean absolute daily percent change over available history
  const dailyPct: number[] = [];
  for (let i = 1; i < clean.length; i++){
    const prev = clean[i-1]; const cur = clean[i];
    if (prev > 0){ dailyPct.push(Math.abs((cur - prev) / prev) * 100); }
  }
  const volatilityPercent = dailyPct.length ? avg(dailyPct) : 0;

  // trend determination
  const trendDiffPercent = longAvg > 0 ? ((shortAvg - longAvg) / longAvg) * 100 : 0;
  let trend: Trend = 'neutral';
  if (trendDiffPercent > 0.5) trend = 'bullish';
  else if (trendDiffPercent < -0.5) trend = 'bearish';

  // Score model (deterministic): maps trend, momentum and volatility into 0..100
  // Normalize components into [-1,1] or [0,1]
  const trendFactor = clamp(trendDiffPercent, -10, 10) / 10; // -1..1
  const momentumFactor = clamp(momentumPercent, -10, 10) / 10; // -1..1
  const volatilityFactor = clamp(volatilityPercent, 0, 20) / 20; // 0..1

  // Combine: base 50, trend contributes +/-25, momentum +/-20, volatility subtracts up to 25
  let rawScore = 50 + trendFactor * 25 + momentumFactor * 20 - volatilityFactor * 25;
  rawScore = Math.round(rawScore * 100) / 100;
  const technicalScore = clamp(rawScore, 0, 100);

  // Signal rules
  let signal: 'BUY' | 'HOLD' | 'SELL' = 'HOLD';
  if (trend === 'bullish' && momentumPercent > 0){ signal = 'BUY'; }
  else if (trend === 'bearish' && momentumPercent < 0){ signal = 'SELL'; }
  else signal = 'HOLD';

  // Reasons (concise)
  if (trend === 'bullish') reasons.push('shortAvg > longAvg');
  if (trend === 'bearish') reasons.push('shortAvg < longAvg');
  if (momentumPercent > 0) reasons.push('momentum positive');
  if (momentumPercent < 0) reasons.push('momentum negative');
  if (volatilityPercent > 5) reasons.push('volatility elevated');

  // Ensure numeric fields are finite
  const safeMomentum = Number.isFinite(momentumPercent) ? Math.round(momentumPercent * 100) / 100 : 0;
  const safeVol = Number.isFinite(volatilityPercent) ? Math.round(volatilityPercent * 100) / 100 : 0;

  return { trend, momentumPercent: safeMomentum, volatilityPercent: safeVol, technicalScore, signal, reasons };
}

export default analyzePriceSeries;
