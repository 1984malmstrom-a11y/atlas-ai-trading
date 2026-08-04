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
  assetType?: 'STOCK' | 'FOREX' | 'COMMODITY' | 'ETF';
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
  { id: 'meta', name: 'Meta Platforms', providerSymbol: 'META', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'tesla', name: 'Tesla', providerSymbol: 'TSLA', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'amd', name: 'AMD', providerSymbol: 'AMD', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'netflix', name: 'Netflix', providerSymbol: 'NFLX', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'broadcom', name: 'Broadcom', providerSymbol: 'AVGO', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  // Additional US development universe additions
  { id: 'oracle', name: 'Oracle', providerSymbol: 'ORCL', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'salesforce', name: 'Salesforce', providerSymbol: 'CRM', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'palantir', name: 'Palantir', providerSymbol: 'PLTR', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  // Semiconductors / AI
  { id: 'taiwan-semiconductor', name: 'Taiwan Semiconductor', providerSymbol: 'TSM', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'arm', name: 'ARM Holdings', providerSymbol: 'ARM', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'micron', name: 'Micron Technology', providerSymbol: 'MU', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'qualcomm', name: 'Qualcomm', providerSymbol: 'QCOM', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'asml', name: 'ASML', providerSymbol: 'ASML', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'supermicro', name: 'Super Micro Computer', providerSymbol: 'SMCI', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  // Financials
  { id: 'jpmorgan', name: 'JPMorgan Chase', providerSymbol: 'JPM', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'bank-america', name: 'Bank of America', providerSymbol: 'BAC', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'goldman', name: 'Goldman Sachs', providerSymbol: 'GS', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'visa', name: 'Visa', providerSymbol: 'V', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'mastercard', name: 'Mastercard', providerSymbol: 'MA', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  // Healthcare
  { id: 'lilly', name: 'Eli Lilly', providerSymbol: 'LLY', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'unitedhealth', name: 'UnitedHealth', providerSymbol: 'UNH', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'abbvie', name: 'AbbVie', providerSymbol: 'ABBV', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'jnj', name: 'Johnson & Johnson', providerSymbol: 'JNJ', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  // Consumer
  { id: 'costco', name: 'Costco', providerSymbol: 'COST', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'walmart', name: 'Walmart', providerSymbol: 'WMT', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'mcdonalds', name: 'McDonalds', providerSymbol: 'MCD', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'home-depot', name: 'Home Depot', providerSymbol: 'HD', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'nike', name: 'Nike', providerSymbol: 'NKE', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  // Industrials
  { id: 'caterpillar', name: 'Caterpillar', providerSymbol: 'CAT', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'general-electric', name: 'General Electric', providerSymbol: 'GE', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'raytheon', name: 'Raytheon Technologies', providerSymbol: 'RTX', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'deere', name: 'Deere & Company', providerSymbol: 'DE', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  // Energy
  { id: 'exxon', name: 'Exxon Mobil', providerSymbol: 'XOM', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'chevron', name: 'Chevron', providerSymbol: 'CVX', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  // Cyber / Cloud
  { id: 'palo-alto', name: 'Palo Alto Networks', providerSymbol: 'PANW', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'crowdstrike', name: 'CrowdStrike', providerSymbol: 'CRWD', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'snowflake', name: 'Snowflake', providerSymbol: 'SNOW', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'shopify', name: 'Shopify', providerSymbol: 'SHOP', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  { id: 'uber', name: 'Uber Technologies', providerSymbol: 'UBER', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'STOCK', quoteCurrency: 'USD' },
  // ETFs
  { id: 'spy', name: 'SPDR S&P 500 ETF Trust', providerSymbol: 'SPY', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'ETF', quoteCurrency: 'USD' },
  { id: 'qqq', name: 'Invesco QQQ Trust', providerSymbol: 'QQQ', exchange: 'NASDAQ', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'ETF', quoteCurrency: 'USD' },
  { id: 'iwm', name: 'iShares Russell 2000 ETF', providerSymbol: 'IWM', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'ETF', quoteCurrency: 'USD' },
  { id: 'dia', name: 'SPDR Dow Jones Industrial Average ETF', providerSymbol: 'DIA', exchange: 'NYSE', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'ETF', quoteCurrency: 'USD' },
  { id: 'telia', name: 'Telia', providerSymbol: 'TELIA', exchange: 'STO', currency: 'SEK', enabled: false, marketDataEnabled: false, tradingEnabled: false, assetType: 'STOCK', disabledReason: 'TWELVE_DATA_PLAN_RESTRICTED' },
  // Gold spot (commodity) — market data enabled, trading disabled for now
  // Added official Forex and Metals instruments (market data only, trading disabled)
  { id: 'USD_SEK', name: 'USD/SEK', providerSymbol: 'USD/SEK', exchange: 'Forex', currency: 'SEK', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'FOREX', baseAsset: 'USD', quoteCurrency: 'SEK' },
  // Ensure full 12-pair Forex universe (majors + crosses)
  { id: 'EUR_USD', name: 'EUR/USD', providerSymbol: 'EUR/USD', exchange: 'Forex', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'FOREX', baseAsset: 'EUR', quoteCurrency: 'USD' },
  { id: 'GBP_USD', name: 'GBP/USD', providerSymbol: 'GBP/USD', exchange: 'Forex', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'FOREX', baseAsset: 'GBP', quoteCurrency: 'USD' },
  { id: 'USD_JPY', name: 'USD/JPY', providerSymbol: 'USD/JPY', exchange: 'Forex', currency: 'JPY', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'FOREX', baseAsset: 'USD', quoteCurrency: 'JPY' },
  { id: 'USD_CHF', name: 'USD/CHF', providerSymbol: 'USD/CHF', exchange: 'Forex', currency: 'CHF', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'FOREX', baseAsset: 'USD', quoteCurrency: 'CHF' },
  { id: 'USD_CAD', name: 'USD/CAD', providerSymbol: 'USD/CAD', exchange: 'Forex', currency: 'CAD', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'FOREX', baseAsset: 'USD', quoteCurrency: 'CAD' },
  { id: 'AUD_USD', name: 'AUD/USD', providerSymbol: 'AUD/USD', exchange: 'Forex', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: true, assetType: 'FOREX', baseAsset: 'AUD', quoteCurrency: 'USD' },
  { id: 'NZD_USD', name: 'NZD/USD', providerSymbol: 'NZD/USD', exchange: 'Forex', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'FOREX', baseAsset: 'NZD', quoteCurrency: 'USD' },
  { id: 'EUR_JPY', name: 'EUR/JPY', providerSymbol: 'EUR/JPY', exchange: 'Forex', currency: 'JPY', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'FOREX', baseAsset: 'EUR', quoteCurrency: 'JPY' },
  { id: 'GBP_JPY', name: 'GBP/JPY', providerSymbol: 'GBP/JPY', exchange: 'Forex', currency: 'JPY', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'FOREX', baseAsset: 'GBP', quoteCurrency: 'JPY' },
  { id: 'EUR_GBP', name: 'EUR/GBP', providerSymbol: 'EUR/GBP', exchange: 'Forex', currency: 'GBP', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'FOREX', baseAsset: 'EUR', quoteCurrency: 'GBP' },
  { id: 'AUD_JPY', name: 'AUD/JPY', providerSymbol: 'AUD/JPY', exchange: 'Forex', currency: 'JPY', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'FOREX', baseAsset: 'AUD', quoteCurrency: 'JPY' },
  { id: 'EUR_AUD', name: 'EUR/AUD', providerSymbol: 'EUR/AUD', exchange: 'Forex', currency: 'AUD', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'FOREX', baseAsset: 'EUR', quoteCurrency: 'AUD' },
  { id: 'XAU_USD', name: 'XAU/USD', providerSymbol: 'XAU/USD', exchange: 'COMMODITY', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'COMMODITY', baseAsset: 'XAU', quoteCurrency: 'USD' },
  { id: 'XAG_USD', name: 'XAG/USD', providerSymbol: 'XAG/USD', exchange: 'COMMODITY', currency: 'USD', enabled: true, marketDataEnabled: true, tradingEnabled: false, assetType: 'COMMODITY', baseAsset: 'XAG', quoteCurrency: 'USD' },
];

export const findInstrumentById = (id: string) => TRADABLE_INSTRUMENTS.find(i => i.id === id) as TradableInstrument | undefined;
