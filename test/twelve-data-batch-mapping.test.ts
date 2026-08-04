import { describe, it, expect } from 'vitest';
import { mapProviderBatchResponse, parseQuoteResponse } from '../src/lib/market-data/twelve-data';
import { TRADABLE_INSTRUMENTS } from '../src/lib/market-data/instruments';

// Build idToSymbol map similar to provider logic
const idToSymbol = new Map<string,string>();
for (const inst of TRADABLE_INSTRUMENTS){ idToSymbol.set(inst.id, inst.providerSymbol || inst.id); }

describe('TwelveData batch mapping helper', ()=>{
  it('maps array response to instrument ids and providerSymbols', ()=>{
    const resp = [
      { symbol: 'MSFT', price: 250, close: 250, last_quote_at: '2025-01-01T00:00:00.000Z' },
      { symbol: 'AAPL', price: 150, close: 150, last_quote_at: '2025-01-01T00:00:00.000Z' }
    ];
    const out = mapProviderBatchResponse(resp, idToSymbol);
    const syms = out.map(o=> o.symbol).sort();
    expect(syms).toContain('MSFT');
    expect(syms).toContain('AAPL');
    for (const o of out){ expect(o.instrumentId).toBeTruthy(); expect(o.providerSymbol).toBeTruthy(); }
  });

  it('maps object keyed by providerSymbol', ()=>{
    const resp: any = {
      MSFT: { symbol: 'MSFT', price: 250, last_quote_at: '2025-01-01T00:00:00.000Z' },
      AAPL: { symbol: 'AAPL', price: 150, last_quote_at: '2025-01-01T00:00:00.000Z' }
    };
    const out = mapProviderBatchResponse(resp, idToSymbol);
    expect(out.length).toBeGreaterThanOrEqual(2);
    const ids = out.map(o=> o.instrumentId);
    expect(ids).toContain('microsoft');
    expect(ids).toContain('apple');
  });

  it('preserves partial success when one entry invalid', ()=>{
    const resp: any = [
      { symbol: 'MSFT', price: 250, last_quote_at: '2025-01-01T00:00:00.000Z' },
      { symbol: 'UNKNOWNX', price: null, last_quote_at: null },
      { symbol: 'AAPL', price: 150, last_quote_at: '2025-01-01T00:00:00.000Z' }
    ];
    const out = mapProviderBatchResponse(resp, idToSymbol);
    // MSFT and AAPL should be present, UNKNOWNX ignored
    const ids = out.map(o=> o.instrumentId);
    expect(ids).toContain('microsoft');
    expect(ids).toContain('apple');
    expect(ids.some(i=> i === undefined || i === null)).toBe(false);
  });

  it('ignores unknown symbol without affecting known ones', ()=>{
    const resp: any = { SOMETHING: { symbol: 'SOMETHING', price: 123, last_quote_at: '2025-01-01T00:00:00.000Z' }, MSFT: { symbol: 'MSFT', price: 250, last_quote_at: '2025-01-01T00:00:00.000Z' } };
    const out = mapProviderBatchResponse(resp, idToSymbol);
    const ids = out.map(o=> o.instrumentId);
    expect(ids).toContain('microsoft');
  });

  it('handles case-insensitive provider keys', ()=>{
    const resp: any = { msft: { symbol: 'msft', price: 250, last_quote_at: '2025-01-01T00:00:00.000Z' }, aApL: { symbol: 'aApL', price: 150, last_quote_at: '2025-01-01T00:00:00.000Z' } };
    const out = mapProviderBatchResponse(resp, idToSymbol);
    const ids = out.map(o=> o.instrumentId);
    expect(ids).toContain('microsoft');
    expect(ids).toContain('apple');
  });
});
