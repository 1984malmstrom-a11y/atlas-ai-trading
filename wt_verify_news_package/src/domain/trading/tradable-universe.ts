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
  { id: 'microsoft', name: 'Microsoft', providerSymbol: '', exchange: 'NASDAQ', currency: 'USD', enabled: true },
  { id: 'telia', name: 'Telia', providerSymbol: '', exchange: 'STO', currency: 'SEK', enabled: true },
];
