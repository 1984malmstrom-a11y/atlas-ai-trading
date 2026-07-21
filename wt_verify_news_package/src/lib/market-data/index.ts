import { TwelveDataMarketDataProvider } from './twelve-data';
import type { MarketDataProvider } from './types';

let _instance: TwelveDataMarketDataProvider | null = null;

export function getMarketDataProvider(): MarketDataProvider {
  if (!_instance) _instance = new TwelveDataMarketDataProvider();
  return _instance;
}

// Provide an explicit lazy default-export wrapper that forwards calls to the
// real provider without creating it at module-import time. Property-access
// (e.g. `typeof mod.default.getQuotes`) will NOT create the provider. The
// provider is only created when the wrapper methods are invoked or when
// `getMarketDataProvider()` is called directly.
const lazyMarketDataProvider: MarketDataProvider = {
  getQuote(instrumentId: string) {
    return getMarketDataProvider().getQuote(instrumentId);
  },
  getQuotes(instrumentIds: string[]) {
    return getMarketDataProvider().getQuotes(instrumentIds);
  },
};

export default lazyMarketDataProvider;
