export type TradeFeedbackVerdict =
  | "STRONG_WIN"
  | "WIN"
  | "BREAK_EVEN"
  | "LOSS"
  | "LARGE_LOSS";

export type TradeFeedback = {
  executionId: string;
  verdict: TradeFeedbackVerdict;
  pnlSek: number;
  pnlPercent: number;
  winner: boolean;
  summary: string;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function createTradeFeedback(args: {
  executionId: string;
  pnlSek: number;
  pnlPercent: number;
  winner: boolean;
}): TradeFeedback {
  if (!args || typeof args !== 'object') throw new Error('invalid args');
  const { executionId, pnlSek, pnlPercent, winner } = args;
  if (!executionId || String(executionId).trim().length === 0) throw new Error('executionId required');
  if (!isFiniteNumber(pnlSek)) throw new Error('pnlSek must be finite');
  if (!isFiniteNumber(pnlPercent)) throw new Error('pnlPercent must be finite');

  let verdict: TradeFeedbackVerdict;
  if (pnlPercent >= 10) verdict = 'STRONG_WIN';
  else if (pnlPercent > 0 && pnlPercent < 10) verdict = 'WIN';
  else if (pnlPercent === 0) verdict = 'BREAK_EVEN';
  else if (pnlPercent < 0 && pnlPercent > -10) verdict = 'LOSS';
  else verdict = 'LARGE_LOSS';

  const summaryMap: Record<TradeFeedbackVerdict, string> = {
    STRONG_WIN: 'Stark vinst',
    WIN: 'Vinst',
    BREAK_EVEN: 'Nollresultat',
    LOSS: 'Förlust',
    LARGE_LOSS: 'Stor förlust',
  };

  const feedback: TradeFeedback = {
    executionId: String(executionId),
    verdict,
    pnlSek,
    pnlPercent,
    winner,
    summary: summaryMap[verdict],
  };

  return Object.freeze(feedback);
}

export default createTradeFeedback;
