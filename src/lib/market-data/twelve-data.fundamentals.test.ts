import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as td from './twelve-data';

describe('Twelve Data provider - fundamentals adapters', () => {
  let origFetch: any;
  beforeEach(() => { origFetch = (globalThis as any).fetch; });
  afterEach(() => { (globalThis as any).fetch = origFetch; vi.restoreAllMocks(); });
  beforeEach(() => { process.env.TWELVE_DATA_API_KEY = 'testkey'; });
  afterEach(() => { delete process.env.TWELVE_DATA_API_KEY; });

  it('detects capabilities and parses statistics numeric strings', async () => {
    // mock fetch responses per endpoint
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      const ok = true; const status = 200;
      if (url.includes('/profile')) return { ok, status, text: async ()=> JSON.stringify({ name: 'Acme', sector: 'Tech' }), json: async ()=> ({ name: 'Acme', sector: 'Tech' }) };
      if (url.includes('/statistics')) return { ok, status, text: async ()=> JSON.stringify({ currency: 'USD', revenue: '1000000', net_income: '100000', market_capitalization: '500000000' }), json: async ()=> ({ currency: 'USD', revenue: '1000000', net_income: '100000', market_capitalization: '500000000' }) };
      if (url.includes('/income_statement')) return { ok, status, text: async ()=> JSON.stringify({ values: [ { fiscalDate: '2023-12-31', revenue: '900000' }, { fiscalDate: '2022-12-31', revenue: '800000' } ] }), json: async ()=> ({ values: [ { fiscalDate: '2023-12-31', revenue: '900000' }, { fiscalDate: '2022-12-31', revenue: '800000' } ] }) };
      if (url.includes('/balance_sheet')) return { ok, status, text: async ()=> JSON.stringify({ values: [ { fiscalDate: '2023-12-31', total_debt: '100000' } ] }), json: async ()=> ({ values: [ { fiscalDate: '2023-12-31', total_debt: '100000' } ] }) };
      if (url.includes('/cash_flow')) return { ok, status, text: async ()=> JSON.stringify({ values: [ { fiscalDate: '2023-12-31', free_cash_flow: '120000' } ] }), json: async ()=> ({ values: [ { fiscalDate: '2023-12-31', free_cash_flow: '120000' } ] }) };
      if (url.includes('/earnings')) return { ok, status, text: async ()=> JSON.stringify({ values: [ { eps: '2.5', next_earnings_date: '2024-08-01' }, { eps: '2.0' } ] }), json: async ()=> ({ values: [ { eps: '2.5', next_earnings_date: '2024-08-01' }, { eps: '2.0' } ] }) };
      return { ok: false, status: 404, text: async ()=> '{}', json: async ()=> ({}) };
    });

    const caps = await td.detectFundamentalCapabilities('ACME');
    expect(caps).toBeTruthy();
    expect(caps.profile).toBe('AVAILABLE');
    expect(caps.statistics).toBe('AVAILABLE');
    expect(caps.incomeStatement).toBe('AVAILABLE');
    const stats = await td.fetchCompanyStatistics('ACME');
    expect(stats).toBeTruthy();
    expect(typeof stats.revenue).toBe('number');
    expect(stats.revenue).toBe(1000000);
    expect(typeof stats.marketCapitalization).toBe('number');
    expect(stats.marketCapitalization).toBe(500000000);
  });

  it('parses various numeric formats and filters placeholders across adapters', async () => {
    // return payloads containing numbers, numeric strings, placeholders and invalid values
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      const ok = true; const status = 200;
      if (url.includes('/profile')) return { ok, status, text: async ()=> JSON.stringify({ name: 'Acme', sector: 'Tech', exchange: 'NASDAQ' }), json: async ()=> ({ name: 'Acme', sector: 'Tech', exchange: 'NASDAQ' }) };
      if (url.includes('/statistics')) return { ok, status, text: async ()=> JSON.stringify({ currency: 'USD', revenue: '1000000', net_income: null, market_capitalization: '500000000', trailing_pe: 'NaN', forward_pe: 'Infinity' }), json: async ()=> ({ currency: 'USD', revenue: '1000000', net_income: null, market_capitalization: '500000000', trailing_pe: 'NaN', forward_pe: 'Infinity' }) };
      if (url.includes('/income_statement')) return { ok, status, text: async ()=> JSON.stringify({ values: [ { fiscalDate: '2023-09-30', revenue: '900000' }, { fiscalDate: '2023-06-30', revenue: '800000' }, { fiscalDate: '2024-12-31', revenue: '999999' }, { revenue: 'no-date' } ] }), json: async ()=> ({ values: [ { fiscalDate: '2023-09-30', revenue: '900000' }, { fiscalDate: '2023-06-30', revenue: '800000' }, { fiscalDate: '2024-12-31', revenue: '999999' }, { revenue: 'no-date' } ] }) };
      if (url.includes('/balance_sheet')) return { ok, status, text: async ()=> JSON.stringify({ values: [ { fiscalDate: '2023-09-30', total_debt: '100000' } ] }), json: async ()=> ({ values: [ { fiscalDate: '2023-09-30', total_debt: '100000' } ] }) };
      if (url.includes('/cash_flow')) return { ok, status, text: async ()=> JSON.stringify({ values: [ { fiscalDate: '2023-09-30', free_cash_flow: '120000' } ] }), json: async ()=> ({ values: [ { fiscalDate: '2023-09-30', free_cash_flow: '120000' } ] }) };
      if (url.includes('/earnings')) return { ok, status, text: async ()=> JSON.stringify({ values: [ { fiscalDate: '2023-09-30', eps: '2.5', next_earnings_date: '2024-08-01' }, { fiscalDate: '2023-06-30', eps: '2.0' } ] }), json: async ()=> ({ values: [ { fiscalDate: '2023-09-30', eps: '2.5', next_earnings_date: '2024-08-01' }, { fiscalDate: '2023-06-30', eps: '2.0' } ] }) };
      return { ok: false, status: 404, text: async ()=> '{}', json: async ()=> ({}) };
    });

    // call adapters
    const profile = await td.fetchCompanyProfile('ACME');
    const stats = await td.fetchCompanyStatistics('ACME');
    const income = await td.fetchIncomeStatement('ACME');
    const balance = await td.fetchBalanceSheet('ACME');
    const cash = await td.fetchCashFlow('ACME');
    const earnings = await td.fetchEarnings('ACME');

    // verify numeric parsing and placeholder filtering
    expect(profile.name).toBe('Acme');
    expect(stats.currency).toBe('USD');
    expect(typeof stats.revenue).toBe('number');
    expect(stats.revenue).toBe(1000000);
    // NaN/Infinity filtered out
    expect(stats.trailingPe).toBeUndefined();
    expect(stats.forwardPe).toBeUndefined();
    // income statement returns array with parsed values and ignores no-date row
    expect(income).toBeTruthy();
    expect(Array.isArray(income)).toBe(true);
    expect((income as any).length).toBeGreaterThanOrEqual(2);
    expect((income as any)[0].revenue).toBeDefined();
    // earnings parsed
    expect(earnings).toBeTruthy();
    expect(Array.isArray(earnings)).toBe(true);
    expect(typeof (earnings as any)[0].eps === 'string' || typeof (earnings as any)[0].eps === 'number').toBeTruthy();
    // adapters must not expose raw provider fields like apiKey or url
    const asAny: any = stats as any;
    expect(asAny.apiKey).toBeUndefined();
    expect(asAny.requestUrl).toBeUndefined();
  });
});
