export function getMockTrades(){
  return [
    { id: 't1', executedAt: Date.now() - 1000*60*60*5, side: 'Köp', symbol: 'AAPL', quantity: 10, filledPrice: 172.3, requestedPrice: 172.5, currency: 'USD', status: 'Fylld', simpleReason: '' },
    { id: 't2', executedAt: Date.now() - 1000*60*60*24, side: 'Sälj', symbol: 'TSLA', quantity: 2, filledPrice: 725.5, requestedPrice: 725.5, currency: 'USD', status: 'Fylld', simpleReason: '' },
    { id: 't3', executedAt: Date.now() - 1000*60*60*72, side: 'Köp', symbol: 'NVDA', quantity: 5, filledPrice: 460.1, requestedPrice: 460.0, currency: 'USD', status: 'Fylld', simpleReason: '' },
    { id: 't4', executedAt: Date.now() - 1000*60*60*96, side: 'Köp', symbol: 'AMZN', quantity: 1, filledPrice: 3342.2, requestedPrice: 3342.2, currency: 'USD', status: 'Avvisad', simpleReason: 'Risk: överskrider gräns' },
    { id: 't5', executedAt: Date.now() - 1000*60*30, side: 'Köp', symbol: 'MSFT', quantity: 3, filledPrice: 315.5, requestedPrice: 315.5, currency: 'USD', status: 'Fylld', simpleReason: '' },
    { id: 't6', executedAt: Date.now() - 1000*60*90, side: 'Sälj', symbol: 'GOOG', quantity: 1, filledPrice: 2850, requestedPrice: 2850, currency: 'USD', status: 'Fylld', simpleReason: '' }
  ];
}
