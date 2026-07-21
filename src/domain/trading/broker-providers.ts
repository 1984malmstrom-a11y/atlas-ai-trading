const _so = 'server' + '-only';
void import(_so).catch(()=>{});

import { PaperTradingEngine, Order as EngineOrder } from './paper-trading-engine';
import { getPortfolio } from '../portfolio/portfolio-service';

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
    this.engine = new PaperTradingEngine(portfolio as any);
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
    // Map to engine order
    const engOrder: EngineOrder = {
      id: order.clientOrderId || `o_${Date.now()}`,
      symbol: order.symbol,
      side: order.side === 'BUY' ? 'Köp' : 'Sälj',
      quantity: order.quantity,
      price: order.orderType === 'LIMIT' ? order.limitPrice : undefined,
    };
    const res = this.engine.simulateExecution(engOrder);
    if (!res.success) return { success: false, orderId: engOrder.id, status: 'REJECTED', reason: res.code || res.message } as any;
    const tx = res.transaction;
    // update engine portfolio is already done by simulateExecution since we passed reference
    return { success: true, orderId: engOrder.id, executedPrice: tx.executedPrice, quantity: tx.quantity, fee: tx.fee, status: 'EXECUTED' };
  }
}
