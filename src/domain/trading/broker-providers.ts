const _so = 'server' + '-only';
void import(_so).catch(()=>{});

import { PaperTradingEngine, Order as EngineOrder } from './paper-trading-engine';
import { getPortfolio, savePortfolio } from '../portfolio/portfolio-service';

export type BrokerAccount = { id: string; cash: number; currency: string };
export type BrokerPosition = { instrumentId: string; symbol: string; quantity: number; marketValue: number; currency: string };

export type BrokerOrderRequest = {
  instrumentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number;
  clientOrderId?: string;
  expectedReturnPercent?: number;
  // optional reference market price used for execution simulation
  price?: number;
};

export type BrokerOrderResult = {
  success: boolean;
  orderId: string;
  executedPrice?: number;
  quantity?: number;
  fee?: number;
  status: 'EXECUTED' | 'REJECTED' | 'PENDING';
  reason?: string;
};

export interface BrokerProvider {
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  placeOrder(order: BrokerOrderRequest): Promise<BrokerOrderResult>;
}

// AtlasPaperBrokerProvider: wraps existing PaperTradingEngine and portfolio service
export class AtlasPaperBrokerProvider implements BrokerProvider {
  private engine: PaperTradingEngine;
  constructor(){
    const portfolio = getPortfolio();
    this.engine = new PaperTradingEngine(portfolio);
  }

  async getAccount(): Promise<BrokerAccount> {
    const p = (this.engine as any).portfolio;
    return { id: 'paper-demo', cash: p.availableCash, currency: p.baseCurrency || 'SEK' };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const p = (this.engine as any).portfolio;
    return p.holdings.map((h: any) => ({ instrumentId: h.id || h.symbol, symbol: h.symbol, quantity: h.quantity, marketValue: h.marketValue, currency: h.currency || p.baseCurrency || 'SEK' }));
  }

  async placeOrder(order: BrokerOrderRequest): Promise<BrokerOrderResult> {
    // Early validation: reject invalid quantities before touching the engine
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
      return { success: false, orderId: order.clientOrderId || `o_${Date.now()}`, status: 'REJECTED', reason: 'INVALID_QUANTITY' } as any;
    }
    // Map to engine order
    const engOrder: EngineOrder = {
      id: order.clientOrderId || `o_${Date.now()}`,
      symbol: order.symbol,
      side: order.side === 'BUY' ? 'Köp' : 'Sälj',
      quantity: order.quantity,
      price: order.orderType === 'LIMIT' ? order.limitPrice : (typeof order.price === 'number' ? order.price : undefined),
      expectedReturnPercent: typeof order.expectedReturnPercent === 'number' && Number.isFinite(order.expectedReturnPercent) ? order.expectedReturnPercent : undefined,
    };
    // If this is a MARKET order and we have no reference price, reject to avoid default=100 bug
    if (order.orderType === 'MARKET' && (typeof engOrder.price !== 'number' || !isFinite(engOrder.price) || engOrder.price <= 0)){
      return { success: false, orderId: engOrder.id, status: 'REJECTED', reason: 'MISSING_MARKET_PRICE' } as any;
    }
    const res = this.engine.simulateExecution(engOrder);
    if (!res.success) return { success: false, orderId: engOrder.id, status: 'REJECTED', reason: res.code || res.message } as any;
    const tx = res.transaction;
    const newPortfolio = res.portfolio;
    try{
      // Persist updated portfolio atomically; only persist on successful execution
      await savePortfolio(newPortfolio);
      // Recreate engine with updated portfolio so subsequent calls see latest state
      this.engine = new PaperTradingEngine(newPortfolio);
    }catch(e){
      // If persistence fails, report rejection to avoid inconsistent state
      return { success: false, orderId: engOrder.id, status: 'REJECTED', reason: 'PERSISTENCE_FAILED' } as any;
    }
    return { success: true, orderId: engOrder.id, executedPrice: tx.executedPrice, quantity: tx.quantity, fee: tx.fee, status: 'EXECUTED' };
  }
}
