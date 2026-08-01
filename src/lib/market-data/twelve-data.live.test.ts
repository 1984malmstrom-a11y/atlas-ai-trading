import { describe, it, beforeAll, expect } from 'vitest';
import { TwelveDataMarketDataProvider } from './twelve-data';
import { TRADABLE_INSTRUMENTS } from './instruments';

function loadApiKeyFromEnvLocal(): string | null {
  if (process.env.TWELVE_DATA_API_KEY) return process.env.TWELVE_DATA_API_KEY;
  try{
    const raw = require('fs').readFileSync('.env.local','utf8');
    const line = raw.split(/\r?\n/).map((l: string) => l.trim()).find((l: string) => l.startsWith('TWELVE_DATA_API_KEY='));
    if (!line) return null;
    let v = line.split('=')[1] || '';
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))){ v = v.slice(1,-1); }
    return v || null;
  }catch(e){ return null; }
}

const LIVE_IDS = [
  { id: 'EUR_USD', providerSymbol: 'EUR/USD', name: 'EUR/USD' },
  { id: 'USD_SEK', providerSymbol: 'USD/SEK', name: 'USD/SEK' },
  { id: 'XAU_USD', providerSymbol: 'XAU/USD', name: 'XAU/USD' },
  { id: 'XAG_USD', providerSymbol: 'XAG/USD', name: 'XAG/USD' },
];

let provider: TwelveDataMarketDataProvider | null = null;

describe('Twelve Data live integration (smoke)', () => {
  const key = loadApiKeyFromEnvLocal();
  if (!key) {
    it('skipped - TWELVE_DATA_API_KEY missing', () => { expect(true).toBe(true); });
    return;
  }

  beforeAll(() => {
    const key2 = loadApiKeyFromEnvLocal();
    if (key2) process.env.TWELVE_DATA_API_KEY = key2;
    // initialize provider (use instruments from catalog)
    provider = new TwelveDataMarketDataProvider();
  });

  for (const inst of LIVE_IDS){
    it(`fetches live quote for ${inst.providerSymbol}`, async () => {
      if (!provider) throw new Error('provider not initialized');
      const q = await provider.getQuote(inst.id);
      // basic validations
      expect(typeof q.price).toBe('number');
      expect(Number.isFinite(q.price) && q.price > 0).toBe(true);
      // timestamp parse
      expect(typeof q.timestamp).toBe('string');
      const dt = new Date(q.timestamp);
      expect(isFinite(dt.getTime())).toBe(true);
      // not in future
      expect(dt.getTime()).toBeLessThanOrEqual(Date.now());
      const age = Math.round((Date.now() - dt.getTime())/1000);
      expect(age).toBeGreaterThanOrEqual(0);
      // age within freshness
      expect(age).toBeLessThanOrEqual(120);
      // isStale false
      expect(q.isStale).toBe(false);
      // symbol mapping
      expect(q.instrumentId).toBe(inst.id);
    });
  }
});
