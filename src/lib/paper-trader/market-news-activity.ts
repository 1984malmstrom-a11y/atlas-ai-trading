import type { MarketNewsIntelligenceSummary } from './cycle-intelligence-snapshot';

export type MarketNewsActivity = {
  title: string;
  message: string;
};

export function createMarketNewsActivity(
  summary: MarketNewsIntelligenceSummary
): MarketNewsActivity {
  // Do not mutate input
  const symbol = (summary as any).symbol as string;
  const freshCount = Number((summary as any).freshCount || 0);
  const staleCount = Number((summary as any).staleCount || 0);
  const invalidCount = Number((summary as any).invalidCount || 0);

  const parts: string[] = [];

  if (freshCount > 0) {
    const freshPhrase =
      freshCount === 1 ? `1 färsk nyhet kunde användas.` : `${freshCount} färska nyheter kunde användas.`;
    parts.push(freshPhrase);
  } else {
    parts.push(`Inga färska nyheter kunde användas.`);
  }

  if (staleCount > 0) {
    const stalePhrase =
      staleCount === 1 ? `1 äldre nyhet.` : `${staleCount} äldre nyheter.`;
    parts.push(stalePhrase);
  }

  if (invalidCount > 0) {
    const invalidPhrase =
      invalidCount === 1 ? `1 ogiltig artikel.` : `${invalidCount} ogiltiga artiklar.`;
    parts.push(invalidPhrase);
  }

  const message = parts.join(' ');

  return {
    title: `Nyhetsanalys för ${symbol}`,
    message,
  };
}
