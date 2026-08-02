import { test, expect } from 'vitest';
import { createPerCycleEarningsResolver } from './earnings-event-context';

test('earnings resolver: one fetch per symbol per cycle, forex zero fetch, runtime updated', async ()=>{
  const calls: string[] = [];
  const fakeFetch = async ({ symbol }: any) => { calls.push(String(symbol).toUpperCase()); if (symbol === 'ERR') throw new Error('boom'); return [{ next_earnings_date: new Date().toISOString(), estimated_eps: '1.0' }]; };
  const resolver = createPerCycleEarningsResolver({ fetchEarnings: fakeFetch, instruments: [{ providerSymbol: 'AAPL', assetType: 'STOCK' }, { providerSymbol: 'EURUSD', assetType: 'FOREX' }], timeoutMs: 1000, updateState: (s:string,r:any)=>{ /* noop */ } });
  // STOCK should fetch
  const a1 = await resolver.resolve({ symbol: 'AAPL', analyzed: true });
  const a2 = await resolver.resolve({ symbol: 'AAPL', analyzed: true });
  expect(calls.filter(c=>c==='AAPL').length).toBe(1);
  // FOREX should not fetch
  const f = await resolver.resolve({ symbol: 'EURUSD', analyzed: true });
  expect(calls.filter(c=>c==='EURUSD').length).toBe(0);
  // error for one symbol does not block another
  const b = await resolver.resolve({ symbol: 'ERR', analyzed: true });
  expect(calls.includes('ERR')).toBeTruthy();
});
