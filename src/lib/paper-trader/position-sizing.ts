export type PositionSizingInput = {
  availableCash: number;
  totalValue: number;
  requestedNotionalSek?: number;
  maxPositionPercent?: number; // fraction, default 0.10
  confidence?: number; // 0-100 — optional scaling factor from Decision Engine
  // Optional asset type string (e.g. 'Stock','Forex','Commodity') to enable
  // asset-aware sizing in future. When absent, category resolves to 'Unknown'.
  assetType?: string;
};

export type PositionSizingResult = {
  recommendedNotional: number;
  portfolioPercent: number; // recommendedNotional / totalValue (0-1)
  confidenceAdjustedNotional: number;
};

export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const { availableCash, totalValue } = input;

  // --- asset category detection (internal) ---
  // Determine asset category first so future category-specific sizing can be
  // applied without changing callers. Currently all categories use the same
  // sizing logic (preserves legacy behaviour).
  const assetCategory = mapAssetTypeToCategory(input.assetType);

  // TODO: When we add asset-specific sizing rules, branch on `assetCategory` below.
  // Example:
  // if (assetCategory === 'Forex') { /* forex sizing adjustments */ }
  // if (assetCategory === 'Commodity') { /* commodity sizing adjustments */ }
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

export type AssetCategory = 'Stock' | 'Forex' | 'Commodity' | 'Unknown';

export function mapAssetTypeToCategory(assetType?: string): AssetCategory{
  if (!assetType) return 'Unknown';
  const t = String(assetType).toUpperCase();
  if (t.includes('FOREX')) return 'Forex';
  if (t.includes('COMMODITY')) return 'Commodity';
  if (t.includes('STOCK') || t.includes('ETF')) return 'Stock';
  return 'Unknown';
}

// Detect asset category from a portfolio snapshot and symbol when available.
export function detectAssetCategory(portfolio: any | null, symbol?: string): AssetCategory{
  try{
    if (!portfolio || !symbol) return 'Unknown';
    if (!Array.isArray(portfolio.holdings)) return 'Unknown';
    const sym = String(symbol).toUpperCase();
    const found = portfolio.holdings.find((h:any) => (h && (h.symbol||'').toString().toUpperCase() === sym));
    if (!found) return 'Unknown';
    const at = (found as any).assetType;
    return mapAssetTypeToCategory(typeof at === 'string' ? at : undefined);
  }catch(_){ return 'Unknown'; }
}
