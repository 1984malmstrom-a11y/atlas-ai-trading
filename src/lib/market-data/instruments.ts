import type { MarketQuote } from './types';

export type TradableInstrument = {
  id: string;
  name: string;
  providerSymbol: string; // verified Twelve Data symbol (empty until verified)
  exchange: string;
  currency: string;
  enabled: boolean;
  disabledReason?: string;
};

export const TRADABLE_INSTRUMENTS: TradableInstrument[] = [
  { id: 'investor', name: 'Investor', providerSymbol: 'INVE.B', exchange: 'STO', currency: 'SEK', enabled: false, disabledReason: 'TWELVE_DATA_PLAN_RESTRICTED' },
  { id: 'novo-nordisk', name: 'Novo Nordisk', providerSymbol: 'NOVO.B', exchange: 'CPH', currency: 'DKK', enabled: false, disabledReason: 'TWELVE_DATA_PLAN_RESTRICTED' },
  { id: 'atlas-copco', name: 'Atlas Copco', providerSymbol: 'ATCO.A', exchange: 'STO', currency: 'SEK', enabled: false, disabledReason: 'TWELVE_DATA_PLAN_RESTRICTED' },
  // US development universe (enabled for development)
  { id: 'microsoft', name: 'Microsoft', providerSymbol: 'MSFT', exchange: 'NASDAQ', currency: 'USD', enabled: true },
  { id: 'apple', name: 'Apple', providerSymbol: 'AAPL', exchange: 'NASDAQ', currency: 'USD', enabled: true },
  { id: 'nvidia', name: 'NVIDIA', providerSymbol: 'NVDA', exchange: 'NASDAQ', currency: 'USD', enabled: true },
  { id: 'amazon', name: 'Amazon', providerSymbol: 'AMZN', exchange: 'NASDAQ', currency: 'USD', enabled: true },
  { id: 'alphabet', name: 'Alphabet', providerSymbol: 'GOOGL', exchange: 'NASDAQ', currency: 'USD', enabled: true },
  { id: 'telia', name: 'Telia', providerSymbol: 'TELIA', exchange: 'STO', currency: 'SEK', enabled: false, disabledReason: 'TWELVE_DATA_PLAN_RESTRICTED' },
];

export const findInstrumentById = (id: string) => TRADABLE_INSTRUMENTS.find(i => i.id === id) as TradableInstrument | undefined;
