import { Portfolio, Holding } from '../../domain/portfolio/types';

export type TradeAction = 'BUY' | 'SELL' | 'HOLD';

export type PaperTradeDecision = {
  id: string;
  symbol: string;
  action: TradeAction;
  confidence: number; // 0-100
  referencePrice: number;
  generatedAt: string;
  reasoning?: string[];
  requestedNotionalSek?: number;
  risk?: RiskReport;
};

export type PaperTraderConfig = {
  enabled?: boolean; // default false
  minimumBuyConfidence?: number; // 0-100
  minimumSellConfidence?: number; // 0-100
  maxPositionPercent?: number; // fraction e.g. 0.10
  maxOrderValueSek?: number;
  feesBps?: number; // basis points
  slippageBps?: number; // basis points
  cooldownMs?: number;
  maxTradesPerCycle?: number;
};

export type VictorPaperTradingConfig = {
  minimumConfidence: number;
  maxPositionPercent: number;
  maxTradesPerCycle: number;
  maxTradesPerDay?: number;
  marketOpenRequired: boolean;
  maxQuoteAgeMs: number;
  allowedActions: readonly ['BUY'];
  allowedSymbols: readonly string[];
};

export const DEFAULT_VICTOR_PAPER_TRADING_CONFIG: VictorPaperTradingConfig = {
  minimumConfidence: 70,
  maxPositionPercent: 0.10,
  maxTradesPerCycle: 1,
  maxTradesPerDay: 1,
  marketOpenRequired: true,
  maxQuoteAgeMs: 15 * 60 * 1000,
  allowedActions: ['BUY'],
  allowedSymbols: ['NVDA','MSFT','AAPL'],
};

export type PersistentTrade = {
  tradeId: string;
  cycleId?: string | null;
  symbol: string;
  side: 'BUY' | 'SELL' | string;
  quantity: number;
  executionPrice: number;
  createdAt: string; // ISO
  // optional compatibility fields
  result?: string;
  status?: string;
};

export type VictorPaperTradingPreflightResult = {
  status: 'READY_TO_EXECUTE' | 'HOLD' | 'BLOCKED' | 'ERROR';
  cycleId: string;
  checkedAt: string;
  config: VictorPaperTradingConfig;
  marketStatus?: string | null;
  quotesFresh?: boolean;
  tradesToday?: number;
  candidate?: {
    symbol: string;
    action: string;
    confidence: number;
    quantity: number | null;
    estimatedPrice: number | null;
    estimatedNotional: number | null;
    estimatedFee: number | null;
    estimatedSlippage: number | null;
    reasoning: readonly string[];
  } | null;
  reason?: string | null;
  errors: readonly { code: string; message: string }[];
};

export interface PortfolioAdapter {
  getPortfolio(): Promise<Portfolio>;
  applyExecution(exec: SimulatedExecution): Promise<Portfolio>;
}

export interface AuditStore {
  append(entry: AuditEntry): Promise<void>;
  list(): Promise<AuditEntry[]>;
}

export interface Clock { now(): Date }

export interface IdGenerator { next(prefix?: string): string }

export type SimulatedExecution = {
  id: string;
  decisionId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  executedPrice: number;
  notional: number;
  fee: number;
  generatedAt: string;
};

export type AuditEntry = {
  id: string;
  timestamp: string;
  kind: 'RECEIVED' | 'HOLD' | 'REJECT' | 'EXECUTION';
  decision?: PaperTradeDecision;
  reason?: { code: string; message: string };
  execution?: SimulatedExecution;
  portfolioBefore?: Portfolio;
  portfolioAfter?: Portfolio;
};

export type DecisionResult = {
  accepted: boolean;
  code?: string;
  message?: string;
  execution?: SimulatedExecution | null;
};

export type RiskReport = {
  allowed: boolean;
  score: number; // 0-100
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  recommendedNotional?: number;
  exposure?: {
    largestHoldingPercent: number;
    totalInvestedPercent: number;
    cashPercent: number;
  };
  diversification?: {
    holdingCount: number;
    concentrationScore: number;
    isConcentrated: boolean;
  };
  positionSizing?: {
    recommendedNotional: number;
    confidenceAdjustedNotional: number;
  };
  drawdown?: {
    drawdownPercent: number;
    isDrawdownWarning: boolean;
    isDrawdownCritical: boolean;
  };
};

export type TradeEvaluation = {
  pnlSek: number;
  pnlPercent: number;
  winner: boolean;
};

export type PerformanceSummary = {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRatePercent: number;
  totalPnlSek: number;
  averagePnlSek: number;
  averageWinnerSek: number;
  averageLoserSek: number;
  profitFactor: number | null;
  expectancySek: number;
};

export type PerformanceReflection = {
  status: 'INSUFFICIENT_DATA' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  confidenceMultiplier: number;
  reasons: string[];
};

export type PerformanceProfile = {
  summary: PerformanceSummary;
  reflection: PerformanceReflection;
};

export type CycleResult = {
  // Number of actionable BUY/SELL candidates processed in the cycle.
  // `processedCandidates` intentionally counts candidate decisions
  // (BUY/SELL) that entered the candidate-processing loop.
  processedCandidates: number;
  executed: number;
  rejects: number;
  entries: AuditEntry[];
};

export type { Portfolio, Holding };

export default {} as any;
