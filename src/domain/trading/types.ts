export type OrderSide = 'Köp' | 'Sälj';

export type TradeOrder = {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price?: number;
}
