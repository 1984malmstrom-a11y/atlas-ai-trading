export type MarketQuote = {
  instrumentId: string;
  symbol: string;
  exchange: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  timestamp: string; // ISO 8601
  source: 'twelve-data';
  isStale: boolean;
  // Data status indicates whether the quote appears to be realtime or delayed
  dataStatus: 'REALTIME' | 'DELAYED' | 'UNKNOWN';
};

export interface MarketDataProvider {
  getQuote(instrumentId: string): Promise<MarketQuote>;
  getQuotes(instrumentIds: string[]): Promise<MarketQuote[]>;
}
