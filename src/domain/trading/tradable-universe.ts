// Explicit tradable universe configuration for Victor
export type TradableInstrument = {
  id: string;
  name: string;
  providerSymbol: string; // left empty until verified by Twelve Data
  exchange: string;
  currency: string;
  enabled: boolean;
};

export const TRADABLE_UNIVERSE: TradableInstrument[] = [
  { id: 'investor', name: 'Investor', providerSymbol: '', exchange: 'STO', currency: 'SEK', enabled: true },
  { id: 'novo-nordisk', name: 'Novo Nordisk', providerSymbol: '', exchange: 'CPH', currency: 'DKK', enabled: true },
  { id: 'atlas-copco', name: 'Atlas Copco', providerSymbol: '', exchange: 'STO', currency: 'SEK', enabled: true },
  { id: 'microsoft', name: 'Microsoft', providerSymbol: 'MSFT', exchange: 'NASDAQ', currency: 'USD', enabled: true },
  { id: 'telia', name: 'Telia', providerSymbol: '', exchange: 'STO', currency: 'SEK', enabled: true },
  // Common Forex pairs (used when FX chosen as active market)
  { id: 'fx_eur_usd', name: 'EUR/USD', providerSymbol: 'EUR/USD', exchange: 'FOREX', currency: 'USD', enabled: true },
  { id: 'fx_gbp_usd', name: 'GBP/USD', providerSymbol: 'GBP/USD', exchange: 'FOREX', currency: 'USD', enabled: true },
  { id: 'fx_usd_jpy', name: 'USD/JPY', providerSymbol: 'USD/JPY', exchange: 'FOREX', currency: 'JPY', enabled: true },
  { id: 'fx_usd_chf', name: 'USD/CHF', providerSymbol: 'USD/CHF', exchange: 'FOREX', currency: 'CHF', enabled: true },
  { id: 'fx_aud_usd', name: 'AUD/USD', providerSymbol: 'AUD/USD', exchange: 'FOREX', currency: 'USD', enabled: true },
  { id: 'fx_usd_cad', name: 'USD/CAD', providerSymbol: 'USD/CAD', exchange: 'FOREX', currency: 'CAD', enabled: true },
];
