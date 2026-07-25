import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadPaperPortfolio,
  commitPaperPortfolioExecution,
  VersionedPaperPortfolio,
  CommitPaperPortfolioResult,
} from './supabase-paper-portfolio-store';

const ORIG_URL = process.env.SUPABASE_URL;
const ORIG_KEY = process.env.SUPABASE_SECRET_KEY;

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.SUPABASE_URL = ORIG_URL;
  process.env.SUPABASE_SECRET_KEY = ORIG_KEY;
});

afterEach(() => {
  delete (global as any).fetch;
  process.env.SUPABASE_URL = ORIG_URL;
  process.env.SUPABASE_SECRET_KEY = ORIG_KEY;
});

describe('supabase-paper-portfolio-store', () => {
  it('throws when env missing for both functions and does not call fetch', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    const f = vi.fn();
    (global as any).fetch = f;

    await expect(loadPaperPortfolio('p')).rejects.toThrow();
    await expect(
      commitPaperPortfolioExecution({ portfolioId: 'p', expectedVersion: 1, executionId: 'e', nextState: { id: 'p', baseCurrency: 'SEK', totalValue: 0, availableCash: 0, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] } })
    ).rejects.toThrow();

    expect(f).not.toHaveBeenCalled();
  });

  it('loadPaperPortfolio gets correct url, headers and returns row', async () => {
    process.env.SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sk';

    const portfolio = { id: 'p', baseCurrency: 'SEK', totalValue: 100, availableCash: 10, totalReturnPercent: 1, benchmarkReturnPercent: 0, holdings: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ state: portfolio, version: 2 }] });
    (global as any).fetch = fetchMock;

    const res = await loadPaperPortfolio('p');
    expect(res.version).toBe(2);
    expect(res.state.id).toBe('p');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${process.env.SUPABASE_URL}/rest/v1/paper_portfolio?select=state,version&id=eq.p`
    );
    expect(opts.headers.apikey).toBe(process.env.SUPABASE_SECRET_KEY);
    expect(opts.headers.Accept).toBe('application/json');
  });

  it('loadPaperPortfolio throws on empty or invalid response', async () => {
    process.env.SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sk';

    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    await expect(loadPaperPortfolio('p')).rejects.toThrow();

    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ state: null, version: 1 }] });
    await expect(loadPaperPortfolio('p')).rejects.toThrow();
  });

  it('commitPaperPortfolioExecution posts correct rpc body and returns APPLIED', async () => {
    process.env.SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sk';

    const portfolio = { id: 'p', baseCurrency: 'SEK', totalValue: 200, availableCash: 20, totalReturnPercent: 2, benchmarkReturnPercent: 0, holdings: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ status: 'APPLIED', state: portfolio, version: 3 }] });
    (global as any).fetch = fetchMock;

    const res = await commitPaperPortfolioExecution({ portfolioId: 'p', expectedVersion: 2, executionId: 'e1', nextState: portfolio });
    expect(res.status).toBe('APPLIED');
    expect(res.state?.id).toBe('p');
    expect(res.version).toBe(3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${process.env.SUPABASE_URL}/rest/v1/rpc/commit_paper_portfolio_execution`);
    expect(opts.method).toBe('POST');
    expect(opts.headers.apikey).toBe(process.env.SUPABASE_SECRET_KEY);
    expect(opts.headers.Accept).toBe('application/json');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body as string);
    expect(body.p_portfolio_id).toBe('p');
    expect(body.p_expected_version).toBe(2);
    expect(body.p_execution_id).toBe('e1');
  });

  it('commitPaperPortfolioExecution accepts DUPLICATE with state/version', async () => {
    process.env.SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sk';

    const portfolio = { id: 'p', baseCurrency: 'SEK', totalValue: 200, availableCash: 20, totalReturnPercent: 2, benchmarkReturnPercent: 0, holdings: [] };
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ status: 'DUPLICATE', state: portfolio, version: 2 }] });

    const res = await commitPaperPortfolioExecution({ portfolioId: 'p', expectedVersion: 2, executionId: 'e2', nextState: portfolio });
    expect(res.status).toBe('DUPLICATE');
    expect(res.state?.id).toBe('p');
    expect(res.version).toBe(2);
  });

  it('throws on network or http error for both functions', async () => {
    process.env.SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sk';

    (global as any).fetch = vi.fn().mockRejectedValue(new Error('net'));
    await expect(loadPaperPortfolio('p')).rejects.toThrow();
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(commitPaperPortfolioExecution({ portfolioId: 'p', expectedVersion: 1, executionId: 'e', nextState: { id: 'p', baseCurrency: 'SEK', totalValue: 0, availableCash: 0, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] } })).rejects.toThrow();
  });
});
