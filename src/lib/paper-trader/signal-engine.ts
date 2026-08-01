export type SignalInput = {
  expectedReturnPercent: number; // e.g., 5 = 5%
  symbol?: string;
};

export type SignalResult = {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number; // 0-100
  reasons: string[];
};

import { calculateSignalScore } from './signal-score';

export function evaluateSignal(input: SignalInput): SignalResult {
  const exp = typeof input.expectedReturnPercent === 'number' && Number.isFinite(input.expectedReturnPercent) ? input.expectedReturnPercent : 0;
  // Delegate scoring entirely to calculateSignalScore
  const scored = calculateSignalScore({ expectedReturnPercent: exp });
  const score = scored.score;
  const reasons = scored.reasons; // reuse array from score (no deep copy)

  let action: SignalResult['action'] = 'HOLD';
  if (score >= 70) action = 'BUY';
  else if (score <= 30) action = 'SELL';

  // Directional confidence:
  // - For BUY: confidence == score (higher score -> stronger BUY)
  // - For SELL: confidence == 100 - score (lower score -> stronger SELL)
  // - For HOLD: express a limited confidence representing neutrality (peak at score=50)
  let confidence: number;
  if (action === 'BUY'){
    confidence = score;
  } else if (action === 'SELL'){
    confidence = 100 - score;
  } else {
    // HOLD: maximum confidence at perfectly neutral score (50), falling off linearly
    // This keeps HOLD from being interpreted as a strong directional signal.
    confidence = Math.max(0, 50 - Math.abs(score - 50));
  }
  // Ensure within bounds
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return { action, confidence, reasons };
}

export default {} as any;
