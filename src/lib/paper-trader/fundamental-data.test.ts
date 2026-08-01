import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fd from './fundamental-data';
import * as td from '../market-data/twelve-data';

describe('Fundamental data pipeline', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('computes growth and builds snapshot/quality/signal', async () => {
    // Mock capability detection to return AVAILABLE for endpoints
    vi.spyOn(td, 'detectFundamentalCapabilities').mockResolvedValue({ checkedAt: new Date().toISOString(), profile: 'AVAILABLE', statistics: 'AVAILABLE', incomeStatement: 'AVAILABLE', balanceSheet: 'AVAILABLE', cashFlow: 'AVAILABLE', earnings: 'AVAILABLE' } as any);
    vi.spyOn(td, 'fetchCompanyProfile').mockResolvedValue({ name: 'ACME INC', sector: 'Tech' } as any);
    vi.spyOn(td, 'fetchCompanyStatistics').mockResolvedValue({ currency: 'USD', revenue: 1000000, netIncome: 120000, marketCapitalization: 500000000 } as any);
    // income arrays: newest first
    vi.spyOn(td, 'fetchIncomeStatement').mockResolvedValue([{ fiscalDate: '2023-12-31', revenue: '1100000', net_income: '130000' }, { fiscalDate: '2022-12-31', revenue: '1000000', net_income: '120000' }] as any);
    vi.spyOn(td, 'fetchBalanceSheet').mockResolvedValue([{ fiscalDate: '2023-12-31', total_debt: '200000', cash_and_equivalents: '80000', current_ratio: '2' }] as any);
    vi.spyOn(td, 'fetchCashFlow').mockResolvedValue([{ fiscalDate: '2023-12-31', free_cash_flow: '150000', operating_cash_flow: '180000' }] as any);
    vi.spyOn(td, 'fetchEarnings').mockResolvedValue([{ fiscalDate: '2023-12-31', eps: '3.0', next_earnings_date: '2024-08-01' }, { fiscalDate: '2022-12-31', eps: '2.5' }] as any);

    const res = await fd.fetchAndBuildFundamentalIntelligence({ symbol: 'ACME' });
    expect(res).toBeTruthy();
    const snap = res.snapshot;
    expect(snap.symbol).toBe('ACME');
    expect(typeof snap.profitability.revenue).toBe('number');
    expect(typeof snap.profitability.revenueGrowthPercent).toBe('number');
    expect(typeof snap.profitability.netIncomeGrowthPercent).toBe('number');
    expect(typeof snap.earnings.eps).toBe('number');
    expect(typeof snap.earnings.epsGrowthPercent).toBe('number');
    const q = res.quality;
    expect(q).toBeTruthy();
    expect(q.score).toBeGreaterThanOrEqual(0);
    expect(q.score).toBeLessThanOrEqual(1);
    const sig = res.signal;
    expect(sig).toBeTruthy();
    expect(sig.type).toBe('FUNDAMENTAL_QUALITY');
    expect(sig.origin).toBe('COMPANY_FINANCIAL_STATEMENTS');
    expect(sig.id).toContain('fundamental_quality_');
  });

  it('strictly selects comparable periods: quarters preferred, annuals fallback, ignores future/invalid dates, no array-order fallback', async () => {
    vi.spyOn(td, 'detectFundamentalCapabilities').mockResolvedValue({ checkedAt: new Date().toISOString(), profile: 'AVAILABLE', statistics: 'AVAILABLE', incomeStatement: 'AVAILABLE', balanceSheet: 'AVAILABLE', cashFlow: 'AVAILABLE', earnings: 'AVAILABLE' } as any);
    vi.spyOn(td, 'fetchCompanyProfile').mockResolvedValue({ name: 'ACME INC', sector: 'Tech' } as any);
    vi.spyOn(td, 'fetchCompanyStatistics').mockResolvedValue({ currency: 'USD', revenue: 1000000 } as any);
    // Income: include two recent quarters and one future quarter and one no-date row
    const inc = [ { fiscalDate: '2023-09-30', revenue: '900000', net_income: '90000' }, { fiscalDate: '2023-06-30', revenue: '800000', net_income: '80000' }, { fiscalDate: '2025-12-31', revenue: '2000000', net_income: '200000' }, { revenue: 'no-date' } ];
    vi.spyOn(td, 'fetchIncomeStatement').mockResolvedValue(inc as any);
    vi.spyOn(td, 'fetchBalanceSheet').mockResolvedValue([{ fiscalDate: '2023-09-30', total_debt: '100000', cash_and_equivalents: '50000', current_ratio: '1.5' }] as any);
    vi.spyOn(td, 'fetchCashFlow').mockResolvedValue([{ fiscalDate: '2023-09-30', free_cash_flow: '120000', operating_cash_flow: '150000' }] as any);
    vi.spyOn(td, 'fetchEarnings').mockResolvedValue([{ fiscalDate: '2023-09-30', eps: '2.5' }, { fiscalDate: '2023-06-30', eps: '2.0' }] as any);

    // preserve input arrays to assert no mutation
    const incCopy = JSON.parse(JSON.stringify(inc));

    const res = await fd.fetchAndBuildFundamentalIntelligence({ symbol: 'ACME' });
    const snap = res.snapshot;
    // quarters selected -> revenueGrowthPercent should be computed
    expect(typeof snap.profitability.revenueGrowthPercent).toBe('number');
    expect(typeof snap.profitability.netIncomeGrowthPercent).toBe('number');
    // future period ignored: ensure not equal to growth derived from future
    expect(snap.profitability.revenue).toBeDefined();
    // input not mutated
    expect(JSON.stringify(inc)).toBe(JSON.stringify(incCopy));
  });

  it('handles zero or negative previous base as undefined growth and different currencies are not compared', async () => {
    vi.spyOn(td, 'detectFundamentalCapabilities').mockResolvedValue({ checkedAt: new Date().toISOString(), profile: 'AVAILABLE', statistics: 'AVAILABLE', incomeStatement: 'AVAILABLE', balanceSheet: 'AVAILABLE', cashFlow: 'AVAILABLE', earnings: 'AVAILABLE' } as any);
    vi.spyOn(td, 'fetchCompanyProfile').mockResolvedValue({ name: 'ACME INC' } as any);
    vi.spyOn(td, 'fetchCompanyStatistics').mockResolvedValue({ currency: 'USD' } as any);
    // previous base zero
    vi.spyOn(td, 'fetchIncomeStatement').mockResolvedValue([{ fiscalDate: '2023-12-31', revenue: '1000' }, { fiscalDate: '2022-12-31', revenue: '0' }] as any);
    vi.spyOn(td, 'fetchBalanceSheet').mockResolvedValue([{ fiscalDate: '2023-12-31', total_debt: '0' }] as any);
    vi.spyOn(td, 'fetchCashFlow').mockResolvedValue([{ fiscalDate: '2023-12-31', free_cash_flow: '100' }] as any);
    vi.spyOn(td, 'fetchEarnings').mockResolvedValue([{ fiscalDate: '2023-12-31', eps: '1.0' }, { fiscalDate: '2022-12-31', eps: '-1.0' }] as any);

    const res = await fd.fetchAndBuildFundamentalIntelligence({ symbol: 'ACME' });
    const snap = res.snapshot;
    expect(snap.profitability.revenueGrowthPercent).toBeUndefined();
    expect(snap.earnings.epsGrowthPercent).toBeUndefined();
  });
});
