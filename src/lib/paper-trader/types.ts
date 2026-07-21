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

export type CycleResult = {
  processed: number;
  executed: number;
  rejects: number;
  entries: AuditEntry[];
};

export type { Portfolio, Holding };

export default {} as any;
