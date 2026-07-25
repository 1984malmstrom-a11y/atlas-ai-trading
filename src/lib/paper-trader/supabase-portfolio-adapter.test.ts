import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabasePortfolioAdapter } from './supabase-portfolio-adapter';
import * as store from './supabase-paper-portfolio-store';
import computeNextPortfolioState from './portfolio-mutation';

beforeEach(()=>{
  vi.restoreAllMocks();
});

afterEach(()=>{
  vi.restoreAllMocks();
});

describe('createSupabasePortfolioAdapter', ()=>{
  it('throws on invalid portfolioId before store calls', async ()=>{
    const l = vi.fn(); const c = vi.fn();
    (global as any).fetch = undefined;
    vi.spyOn(store, 'loadPaperPortfolio').mockImplementation(l as any);
    vi.spyOn(store, 'commitPaperPortfolioExecution').mockImplementation(c as any);
    expect(()=> createSupabasePortfolioAdapter('')).toThrow();
    expect(()=> createSupabasePortfolioAdapter('   ')).toThrow();
    expect(l).not.toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
  });

  it('getPortfolio loads and returns state', async ()=>{
    const adapterId = 'p1';
    const mockState = { id: adapterId, baseCurrency: 'SEK', totalValue: 100, availableCash: 50, totalReturnPercent:0, benchmarkReturnPercent:0, holdings: [] };
    const loadMock = vi.fn().mockResolvedValue({ state: mockState, version: 1 });
    vi.spyOn(store, 'loadPaperPortfolio').mockImplementation(loadMock as any);
    const adapter = createSupabasePortfolioAdapter(adapterId);
    const s = await adapter.getPortfolio();
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledWith(adapterId);
    expect(s).toEqual(mockState);
  });

  it('APPLIED: loads, commits with nextState and returns rpc state', async ()=>{
    const adapterId = 'p2';
    const current = { state: { id: adapterId, baseCurrency: 'SEK', totalValue: 100, availableCash: 50, totalReturnPercent:0, benchmarkReturnPercent:0, holdings: [] }, version: 5 };
    const loadMock = vi.fn().mockResolvedValue(current);
    vi.spyOn(store, 'loadPaperPortfolio').mockImplementation(loadMock as any);

    const exec: any = { id: 'ex1', decisionId: 'd', symbol: 'A', side: 'BUY', quantity: 1, executedPrice: 10, notional: 10, fee: 0 };

    // spy computeNextPortfolioState to ensure it's used
    const nextState = computeNextPortfolioState(current.state as any, exec as any);

    const commitMock = vi.fn().mockResolvedValue({ status: 'APPLIED', state: nextState, version: 6 });
    vi.spyOn(store, 'commitPaperPortfolioExecution').mockImplementation(commitMock as any);

    const adapter = createSupabasePortfolioAdapter(adapterId);
    const res = await adapter.applyExecution(exec as any);

    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledTimes(1);
    const calledArg = commitMock.mock.calls[0][0];
    expect(calledArg.portfolioId).toBe(adapterId);
    expect(calledArg.expectedVersion).toBe(5);
    expect(calledArg.executionId).toBe(exec.id);
    expect(calledArg.nextState).toEqual(nextState);
    expect(res).toEqual(nextState);
  });

  it('DUPLICATE: returns rpc state and calls load+commit once', async ()=>{
    const adapterId = 'p3';
    const current = { state: { id: adapterId, baseCurrency: 'SEK', totalValue: 100, availableCash: 50, totalReturnPercent:0, benchmarkReturnPercent:0, holdings: [] }, version: 2 };
    const loadMock = vi.fn().mockResolvedValue(current);
    vi.spyOn(store, 'loadPaperPortfolio').mockImplementation(loadMock as any);

    const exec: any = { id: 'ex2', decisionId: 'd', symbol: 'A', side: 'SELL', quantity: 1, executedPrice: 10, notional: 10, fee: 0 };
    const nextState = computeNextPortfolioState(current.state as any, exec as any);
    const rpcState = { id: adapterId, baseCurrency: 'SEK', totalValue: 110, availableCash: 60, totalReturnPercent:0, benchmarkReturnPercent:0, holdings: [] };
    const commitMock = vi.fn().mockResolvedValue({ status: 'DUPLICATE', state: rpcState, version: 3 });
    vi.spyOn(store, 'commitPaperPortfolioExecution').mockImplementation(commitMock as any);

    const adapter = createSupabasePortfolioAdapter(adapterId);
    const res = await adapter.applyExecution(exec as any);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(res).toEqual(rpcState);
  });

  it('VERSION_CONFLICT throws and does not retry', async ()=>{
    const adapterId = 'p4';
    const current = { state: { id: adapterId, baseCurrency: 'SEK', totalValue: 100, availableCash: 50, totalReturnPercent:0, benchmarkReturnPercent:0, holdings: [] }, version: 7 };
    const loadMock = vi.fn().mockResolvedValue(current);
    vi.spyOn(store, 'loadPaperPortfolio').mockImplementation(loadMock as any);
    const exec: any = { id: 'ex3', decisionId: 'd', symbol: 'A', side: 'BUY', quantity: 1, executedPrice: 10, notional: 10, fee: 0 };
    const commitMock = vi.fn().mockResolvedValue({ status: 'VERSION_CONFLICT', state: null, version: null });
    vi.spyOn(store, 'commitPaperPortfolioExecution').mockImplementation(commitMock as any);

    const adapter = createSupabasePortfolioAdapter(adapterId);
    await expect(adapter.applyExecution(exec as any)).rejects.toThrow(/VERSION_CONFLICT/);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  it('NOT_FOUND and INVALID_INPUT throw respectively', async ()=>{
    const adapterId = 'p5';
    const current = { state: { id: adapterId, baseCurrency: 'SEK', totalValue: 100, availableCash: 50, totalReturnPercent:0, benchmarkReturnPercent:0, holdings: [] }, version: 1 };
    const loadMock = vi.fn().mockResolvedValue(current);
    vi.spyOn(store, 'loadPaperPortfolio').mockImplementation(loadMock as any);
    const exec: any = { id: 'ex4', decisionId: 'd', symbol: 'A', side: 'BUY', quantity: 1, executedPrice: 10, notional: 10, fee: 0 };

    const commitNotFound = vi.fn().mockResolvedValue({ status: 'NOT_FOUND', state: null, version: null });
    vi.spyOn(store, 'commitPaperPortfolioExecution').mockImplementation(commitNotFound as any);
    const adapter = createSupabasePortfolioAdapter(adapterId);
    await expect(adapter.applyExecution(exec as any)).rejects.toThrow(/NOT_FOUND/);

    const commitInvalid = vi.fn().mockResolvedValue({ status: 'INVALID_INPUT', state: null, version: null });
    vi.spyOn(store, 'commitPaperPortfolioExecution').mockImplementation(commitInvalid as any);
    await expect(adapter.applyExecution(exec as any)).rejects.toThrow(/INVALID_INPUT/);
  });
});
