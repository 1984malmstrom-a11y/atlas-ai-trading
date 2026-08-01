// Lightweight market structure signal builders: Volume confirmation, Trend quality, Support/Resistance
// No external providers. Deterministic and pure functions suitable for unit tests.

function normSym(sym: string){ return String(sym || '').toUpperCase().replace(/[^A-Z0-9]/g,'_'); }

export type MSig = { id: string; type: string; origin: string; direction: 'BULLISH'|'BEARISH'|'NEUTRAL'; strength: number; symbols?: string[] };

// Build volume confirmation signal from historical volumes and prices.
export function buildVolumeSignal(symbol: string, volumes: number[] | undefined, prices: number[] | undefined): MSig | null {
  try{
    const s = normSym(symbol);
    // Require explicit volume series and minimum observations
    if (!Array.isArray(volumes) || volumes.length < 10) return null;
    if (!Array.isArray(prices) || prices.length < 2) return null;
    // Use last observed volume and compare to average of prior observations (exclude last)
    const lastVol = Number(volumes[volumes.length - 1]) || 0;
    const prior = volumes.slice(0, volumes.length - 1).map(v => Number(v || 0)).filter(n => isFinite(n) && n > 0);
    if (!Array.isArray(prior) || prior.length < 9) return null;
    const avg = prior.reduce((a,b) => a + b, 0) / Math.max(1, prior.length);
    if (!isFinite(avg) || avg <= 0) return null;
    const rel = lastVol / avg;
    if (!isFinite(rel) || rel <= 0) return null;
    // Price direction based on last two closes
    const lastPrice = Number(prices[prices.length - 1]);
    const prevPrice = Number(prices[prices.length - 2]);
    const priceDir = lastPrice > prevPrice ? 1 : (lastPrice < prevPrice ? -1 : 0);
    let direction: 'BULLISH'|'BEARISH'|'NEUTRAL' = 'NEUTRAL';
    let strength = 0;
    // Require a clearly elevated relative volume (conservative thresholds)
    if (rel >= 1.5){
      if (priceDir > 0) direction = 'BULLISH';
      else if (priceDir < 0) direction = 'BEARISH';
      else direction = 'NEUTRAL';
      // Combine relative volume magnitude and last price move magnitude conservatively
      const priceMove = Math.abs((lastPrice - prevPrice) / Math.max(1, Math.abs(prevPrice)));
      strength = Math.min(1, Math.max(0, (Math.log(rel) / Math.log(3)) * 0.7 + Math.min(0.3, priceMove)));
    } else if (rel <= 0.7){
      direction = 'NEUTRAL';
      strength = Math.max(0, 0.1 - (0.7 - rel) * 0.2);
    } else {
      direction = 'NEUTRAL';
      strength = 0.1;
    }
    strength = Math.max(0, Math.min(1, Number(Number(strength).toFixed(3))));
    return { id: `volume_confirmation_${s}`, type: 'VOLUME_CONFIRMATION', origin: 'SYMBOL_VOLUME_HISTORY', direction, strength, symbols: [s] };
  }catch(_){ return null; }
}

// Build a simple trend quality signal from recent prices: consecutive higher highs/lows or lower highs/lows
export function buildTrendQualitySignal(symbol: string, prices: number[] | undefined): MSig | null {
  try{
    const s = normSym(symbol);
    if (!Array.isArray(prices) || prices.length < 8) return null;
    // Define short and medium windows (in samples)
    const shortN = 3;
    const mediumN = 8;
    const pctChange = (a:number,b:number) => (b - a) / Math.max(1, Math.abs(a));

    // Helper: compute directional score in a window (positive -> bullish)
    const directionalScore = (arr: number[]) => {
      let ups = 0; let downs = 0; let valid = 0;
      for (let i = 1; i < arr.length; i++){
        const prev = Number(arr[i-1]); const cur = Number(arr[i]);
        if (!isFinite(prev) || !isFinite(cur)) continue;
        valid++;
        if (cur > prev) ups++; else if (cur < prev) downs++;
      }
      if (valid === 0) return 0;
      return (ups - downs) / valid; // -1..1
    };

    // Build short window (last shortN+1 points) and medium window (last mediumN+1 points)
    const pts = prices.slice();
    const shortWindow = pts.slice(Math.max(0, pts.length - (shortN + 1)));
    const mediumWindow = pts.slice(Math.max(0, pts.length - (mediumN + 1)));
    if (shortWindow.length < 2 || mediumWindow.length < 2) return null;

    const shortScore = directionalScore(shortWindow);
    const mediumScore = directionalScore(mediumWindow);
    // Require consensus: both positive -> bullish, both negative -> bearish
    let direction: 'BULLISH'|'BEARISH'|'NEUTRAL' = 'NEUTRAL';
    let strength = 0;
    if (shortScore > 0.4 && mediumScore > 0.2){ direction = 'BULLISH'; strength = Math.min(1, (shortScore + mediumScore) / 2); }
    else if (shortScore < -0.4 && mediumScore < -0.2){ direction = 'BEARISH'; strength = Math.min(1, (Math.abs(shortScore) + Math.abs(mediumScore)) / 2); }
    else { direction = 'NEUTRAL'; strength = 0; }

    // Prevent a single spike from producing high strength: cap by recent volatility
    const recentChanges = [] as number[];
    for (let i = Math.max(1, pts.length - 6); i < pts.length; i++){ const a = Number(pts[i-1]); const b = Number(pts[i]); if (isFinite(a) && isFinite(b) && a !== 0) recentChanges.push(Math.abs((b-a)/a)); }
    const vol = recentChanges.length ? (recentChanges.reduce((a,b)=>a+b,0)/recentChanges.length) : 0;
    // If high short-term volatility relative to trend, reduce strength
    if (vol > 0 && strength > 0){ strength = Math.max(0, strength - Math.min(0.5, vol)); }
    strength = Math.max(0, Math.min(1, Number(Number(strength).toFixed(3))));
    return { id: `trend_quality_${s}`, type: 'TREND_QUALITY', origin: 'SYMBOL_PRICE_HISTORY', direction, strength, symbols: [s] };
  }catch(_){ return null; }
}

// Simple support/resistance detection: use recent window to compute min/max and distance to current price
export function buildSupportResistanceSignal(symbol: string, prices: number[] | undefined): MSig | null {
  try{
    const s = normSym(symbol);
    if (!Array.isArray(prices) || prices.length < 10) return null;
    // Use historical window excluding the latest price to detect SR levels
    const hist = prices.slice(0, prices.length - 1).filter(p => isFinite(Number(p))).map(Number);
    if (hist.length < 9) return null;
    const last = Number(prices[prices.length - 1]);
    if (!isFinite(last)) return null;
    // Use a window of up to 40 prior points to compute support/resistance
    const window = hist.slice(-40);
    const min = Math.min(...window);
    const max = Math.max(...window);
    const range = max - min;
    if (!isFinite(range) || range <= 0) return null;
    const distToSupport = (last - min) / range; // 0 = at support, 1 = at resistance
    const distToResistance = (max - last) / range;
    const nearThreshold = 0.05; // 5% of range
    let direction: 'BULLISH'|'BEARISH'|'NEUTRAL' = 'NEUTRAL';
    let strength = 0;
    if (distToSupport <= nearThreshold){ direction = 'BULLISH'; strength = Math.max(0, Math.min(1, 1 - (distToSupport / nearThreshold))); }
    else if (distToResistance <= nearThreshold){ direction = 'BEARISH'; strength = Math.max(0, Math.min(1, 1 - (distToResistance / nearThreshold))); }
    else { direction = 'NEUTRAL'; strength = 0; }
    strength = Number(Number(strength).toFixed(3));
    return { id: `supply_demand_${s}`, type: 'SUPPLY_DEMAND_ZONE', origin: 'SYMBOL_PRICE_HISTORY', direction, strength, symbols: [s] };
  }catch(_){ return null; }
}

export default { buildVolumeSignal, buildTrendQualitySignal, buildSupportResistanceSignal };
