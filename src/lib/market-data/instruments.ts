import type { MarketQuote } from './types';

export type TradableInstrument = {
  id: string;
  name: string;
  providerSymbol: string; // verified Twelve Data symbol (empty until verified)
  exchange: string;
  currency: string;
  // Backwards-compatible flag used historically; kept in sync with marketDataEnabled
  enabled: boolean;
  disabledReason?: string;
  // New asset-aware metadata
  assetType?: 'STOCK' | 'FOREX' | 'COMMODITY';
  baseAsset?: string;
  quoteCurrency?: string;
  marketDataEnabled?: boolean; // whether this instrument should be fetched for market data
  tradingEnabled?: boolean; // whether instrument is eligible for trading (paper/live)
};

export const TRADABLE_INSTRUMENTS: TradableInstrument[] = [
  { id: 'investor', name: 'Investor', providerSymbol: 'INVE.B', exchange: 'STO', currency: 'SEK', enabled: false, marketDataEnabled: false, tradingEnabled: false, assetType: 'STOCK', disabledReason: 'TWELVE_DATA_PLAN_RESTRICTED' },
  { id: 'novo-nordisk', name: 'Novo Nordisk', providerSymbol: 'NOVO.B', exchange: 'CPH', currency: 'DKK', enabled: false, marketDataEnabled: false, tradingEnabled: false, assetType: 'STOCK', disabledReason: 'TWELVE_DATA_PLAN_RESTRICTED' },
  { id: 'atlas-copco', name: 'Atlas Copco', providerSymbol: 'ATCO.A', exchange: 'STO', currency: 'SEK', enabled: false, marketDataEnabled: false, tradingEnabled: false, assetType: 'STOCK', disabledReason: 'TWELVE_DATA_PLAN_RESTRICTED' },
  // US development universe (enabled for development)
  { id: 'microsoft', name: 'Microsoft', providerSymbol: 'MSFT', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'apple', name: 'Apple', providerSymbol: 'AAPL', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'nvidia', name: 'NVIDIA', providerSymbol: 'NVDA', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'amazon', name: 'Amazon', providerSymbol: 'AMZN', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'alphabet', name: 'Alphabet', providerSymbol: 'GOOGL', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'telia', name: 'Telia', providerSymbol: 'TELIA', exchange: 'STO', currency: 'SEK', enabled: false, marketDataEnabled: false, tradingEnabled: false, assetType: 'STOCK', disabledReason: 'TWELVE_DATA_PLAN_RESTRICTED' },
  // Gold spot (commodity) — market data enabled, trading disabled for now
  { id: 'xau-usd', name: 'Gold Spot', providerSymbol: 'XAU/USD', exchange: 'COMMODITY', currency: 'USD', enabled: false, marketDataEnabled: true, tradingEnabled: false, assetType: 'COMMODITY', baseAsset: 'XAU', quoteCurrency: 'USD' },
];

export const findInstrumentById = (id: string) => TRADABLE_INSTRUMENTS.find(i => i.id === id) as TradableInstrument | undefined;
