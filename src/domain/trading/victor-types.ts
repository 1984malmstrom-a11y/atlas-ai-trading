export type VictorTradingMode =
  | 'ADVISORY'
  | 'PAPER_MANUAL'
  | 'PAPER_AUTO'
  | 'LIVE_MANUAL'
  | 'LIVE_AUTO';

export type VictorTradingMandate = {
  mode: VictorTradingMode;
  allowedInstrumentIds: string[];
  maxTradesPerDay: number;
  maxTradesPerCycle: number;
  maxOrderValueSek: number;
  maxPositionPercent: number;
  maxDailyLossPercent: number;
  minimumBuyConfidence: number;
  minimumSellConfidence: number;
  allowAutomaticBuys: boolean;
  allowAutomaticSells: boolean;
};

export type VictorTradeDecision = {
  instrumentId: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  targetPositionPercent?: number;
  orderValueSek?: number;
  thesis: string;
  signals: string[];
  risks: string[];
  timeHorizon: 'INTRADAY' | 'SWING' | 'LONG_TERM';
  generatedAt: string;
};

export const DEFAULT_PAPER_AUTO_MANDATE: VictorTradingMandate = {
  mode: 'PAPER_AUTO',
  allowedInstrumentIds: ['investor', 'novo-nordisk', 'atlas-copco', 'microsoft', 'telia'],
  maxTradesPerDay: 4,
  maxTradesPerCycle: 2,
  maxOrderValueSek: 25000,
  // Internal representation: decimal fraction (10% == 0.10)
  maxPositionPercent: 0.10,
  maxDailyLossPercent: 2,
  minimumBuyConfidence: 0.72,
  minimumSellConfidence: 0.78,
  allowAutomaticBuys: true,
  allowAutomaticSells: true,
};
