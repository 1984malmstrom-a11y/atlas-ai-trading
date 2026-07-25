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

  const confidence = score;
  return { action, confidence, reasons };
}

export default {} as any;
