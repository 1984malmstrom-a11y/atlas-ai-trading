import { Portfolio, Holding } from '../../domain/portfolio/types';
import type { DecisionEvidence } from './evidence-aggregator';
import type { EvidenceConsistency } from './evidence-consistency-analyzer';
import type { EvidenceInformedDecision } from './evidence-informed-decision-policy';
import type { HistoricalContext } from './historical-context-engine';
// Note: TradeEvaluation defined below to avoid circular type-only import issues

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
  // Optional array of signal identifiers produced by decision engines
  signals?: string[];
  // Optional evidence fields (enriched by runtime before execution)
  decisionEvidence?: DecisionEvidence | null;
  evidenceConsistency?: EvidenceConsistency | null;
  evidenceInformedDecision?: EvidenceInformedDecision | null;
  historicalContext?: HistoricalContext | null;
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
  list(): Promise<AuditStoreItem[]>;
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
  kind: 'RECEIVED' | 'HOLD' | 'REJECT' | 'EXECUTION' | 'EVALUATION' | 'DECISION_SUMMARY' | 'TRADE_FEEDBACK' | 'ADAPTIVE_DECISION_CONTEXT' | 'CYCLE_INTELLIGENCE_SNAPSHOT';
  decision?: PaperTradeDecision;
  reason?: { code: string; message: string };
  execution?: SimulatedExecution;
  portfolioBefore?: Portfolio;
  portfolioAfter?: Portfolio;
  evaluation?: TradeEvaluation;
};

export type AuditStoreEnvelope = {
  id: string;
  timestamp: string;
  summary: Record<string, unknown>;
  raw: AuditEntry;
};

export type AuditStoreItem = AuditEntry | AuditStoreEnvelope;

export type DecisionResult = {
  accepted: boolean;
  code?: string;
  message?: string;
  execution?: SimulatedExecution | null;
  transaction?: SimulatedExecution | null;
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

// TradeEvaluation is imported from ./trade-evaluation (type-only)
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

// Strategy-specific performance profiles mapping can be added later
// when the project defines a concrete `TradingStrategy` type.

export type DecisionSummary = {
  cycleId: string;
  timestamp: string;
  analyzedSymbols: string[];
  eligibleSymbols: string[];
  skippedSymbols: string[];
  decisions: Array<{ id: string; symbol: string; action: string; confidence?: number; expectedReturnPercent?: number | null; risk?: RiskReport | null }>;
  executedTrades: Array<{ id?: string; symbol: string; side: string; quantity?: number; executedPrice?: number; notional?: number }>;
  rejectedTradesCount: number;
  confidenceAverage?: number | null;
  topReason?: string | null;
  riskBlocks?: Record<string, number> | null;
  overallConclusion: 'EXECUTED' | 'REJECTED' | 'NO_ACTION';
  marketSession?: { marketOpen: boolean | null; nextOpenInstant?: string | null } | null;
  cycleDurationMs?: number | null;
  skippedReasonsBySymbol?: Record<string, string[]> | null;
  confidenceDistribution?: Record<string, number> | null;
  strongestBullishReason?: string | null;
  strongestBearishReason?: string | null;
  cashBefore?: number | null;
  cashAfter?: number | null;
  portfolioValueBefore?: number | null;
  portfolioValueAfter?: number | null;
  decisionReasons?: DecisionReason[] | null;
  shadowDecisionSummary?: {
    evaluatedCount: number;
    agreementCount: number;
    disagreementCount: number;
    agreementRate: number; // 0-100
    recommendedActionDistribution: { BUY: number; SELL: number; HOLD: number };
    disagreementByTransition: Record<string, number> | {};
  } | null;
  shadowPerformanceSummary?: {
    evaluatedCount: number;
    shadowBetterCount: number;
    actualBetterCount: number;
    equalCount: number;
    notEvaluableCount: number;
    shadowBetterRate: number;
    actualBetterRate: number;
    netShadowAdvantage: number;
    actualTotalScore: number;
    shadowTotalScore: number;
    assessment: 'SHADOW_SIGNIFICANTLY_BETTER'|'SHADOW_SLIGHTLY_BETTER'|'EQUAL_PERFORMANCE'|'ACTUAL_SLIGHTLY_BETTER'|'ACTUAL_SIGNIFICANTLY_BETTER'|'INSUFFICIENT_DATA';
  } | null;
};

export type DecisionReason = {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD' | string;
  confidence?: number | null;
  primaryReason?: string | null;
  supportingReasons?: string[] | null;
  riskWarnings?: string[] | null;
  marketSessionReason?: string | null;
  rejectedByRiskEngine?: boolean;
  rejectedByMarketHours?: boolean;
  rejectedByFreshness?: boolean;
  rejectedByPositionLimits?: boolean;
};

export type TradeFeedback = {
  cycleId: string;
  tradeId: string;
  symbol: string;
  action: 'BUY' | 'SELL' | string;
  confidenceAtExecution?: number | null;
  expectedDirection?: string | null;
  executedPrice?: number | null;
  executedAt?: string | null;
  evaluationStatus: 'PENDING' | 'COMPLETE';
  evaluationDueAt: string | null;
  decisionReasons?: DecisionReason[] | null;
};

export type OutcomeEvaluation = {
  tradeId: string;
  evaluatedAt: string;
  currentPrice?: number | null;
  priceChangePercent?: number | null;
  absolutePnL?: number | null;
  expectedDirectionCorrect: boolean;
  confidenceAccurate: boolean;
  evaluationResult: 'WIN' | 'LOSS' | 'NEUTRAL';
  outcomeReason?: string | null;
};

export type LessonCategory = 'CONFIDENCE_TOO_HIGH' | 'CONFIDENCE_TOO_LOW' | 'RISK_TOO_AGGRESSIVE' | 'RISK_TOO_CONSERVATIVE' | 'CORRECT_DECISION' | 'NEUTRAL';

export type LearningSignal = {
  tradeId: string;
  symbol?: string | null;
  generatedAt: string;
  evaluationResult: 'WIN' | 'LOSS' | 'NEUTRAL';
  confidenceAtExecution?: number | null;
  confidenceAccurate: boolean;
  expectedDirectionCorrect: boolean;
  lessonCategory: LessonCategory;
  suggestedConfidenceAdjustment?: number | null; // additive percentage points
  suggestedRiskAdjustment?: number | null; // positive => increase risk tolerance, negative => reduce
  summary?: string | null;
};

// Minimal standardized types for future market news data
export type MarketNewsItem = {
  id: string;
  symbol: string;
  headline: string;
  source: string;
  publishedAt: string; // ISO timestamp
  fetchedAt: string; // ISO timestamp when ingested
  url?: string;
};

export type MarketNewsSnapshot = {
  symbol: string;
  items: MarketNewsItem[];
  fetchedAt: string; // ISO timestamp for snapshot
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
