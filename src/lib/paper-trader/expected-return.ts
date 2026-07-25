export type ExpectedReturnInput = {
  momentumPercent: number;
  confidence: number;
};

export type ExpectedReturnEstimate = {
  expectedReturnPercent: number;
  reasons: string[];
};

function clamp(v: number, lo: number, hi: number){
  return v < lo ? lo : (v > hi ? hi : v);
}

export function estimateExpectedReturn(input: ExpectedReturnInput): ExpectedReturnEstimate | null {
  const { momentumPercent, confidence } = input;
  if (!Number.isFinite(momentumPercent) || !Number.isFinite(confidence)) return null;

  const confClamped = clamp(confidence, 0, 100);
  const confidenceFactor = confClamped / 100;

  // Primary rule: momentumPercent is the base
  let expected = momentumPercent * confidenceFactor;

  // Clamp to allowed range
  const clamped = clamp(expected, -20, 20);

  const reasons: string[] = [];
  reasons.push('MOMENTUM_BASED_ESTIMATE');
  if (confidenceFactor !== 1) reasons.push('CONFIDENCE_SCALED');
  if (clamped !== expected) reasons.push('EXPECTED_RETURN_CLAMPED');

  return { expectedReturnPercent: Math.round(clamped * 100) / 100, reasons };
}

export default estimateExpectedReturn;
