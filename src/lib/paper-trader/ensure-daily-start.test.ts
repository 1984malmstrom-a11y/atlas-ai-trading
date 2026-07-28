import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureDailyStart } from './ensure-daily-start';

beforeEach(()=>{ vi.restoreAllMocks(); });

describe('ensureDailyStart', ()=>{
  it('formats Europe/Stockholm date correctly around UTC midnight', async ()=>{
    // 2026-07-27T23:30:00Z is 2026-07-28 01:30 in Stockholm (CEST)
    const clock = { now: () => new Date('2026-07-27T23:30:00Z') };
    const load = vi.fn().mockResolvedValue({ state: { id: 'p', baseCurrency: 'SEK', totalValue: 100, availableCash: 50, totalReturnPercent:0, benchmarkReturnPercent:0, holdings: [] }, version: 0 });
    const commit = vi.fn().mockResolvedValue({ status: 'APPLIED', state: { id: 'p', availableCash: 50, dailyRisk: { date: '2026-07-28', startValue: 50 } }, version: 1 });
    const res = await ensureDailyStart({ portfolioId: 'p', load, commit, clock });
    expect(res.date).toBe('2026-07-28');
    expect(res.startValue).toBe(50);
    expect(commit).toHaveBeenCalled();
  });

  it('returns existing dailyRisk without committing', async ()=>{
    const load = vi.fn().mockResolvedValue({ state: { id: 'p', availableCash: 123, dailyRisk: { date: '2026-07-27', startValue: 123 } }, version: 5 });
    const commit = vi.fn();
    const clock = { now: () => new Date('2026-07-27T10:00:00Z') };
    const res = await ensureDailyStart({ portfolioId: 'p', load, commit, clock });
    expect(res.date).toBe('2026-07-27');
    expect(res.startValue).toBe(123);
    expect(commit).not.toHaveBeenCalled();
  });

  it('APPLIED saves metadata and preserves state keys, uses correct executionId and expectedVersion', async ()=>{
    const currentState = { id: 'p', availableCash: 200, foo: 'bar' };
    const load = vi.fn().mockResolvedValue({ state: currentState, version: 2 });
    const commit = vi.fn().mockImplementation(async (input:any) => {
      expect(input.executionId).toBe('daily-start:p:2026-07-27');
      expect(input.expectedVersion).toBe(2);
      expect(input.nextState.foo).toBe('bar');
      expect(input.nextState.dailyRisk).toEqual({ date: '2026-07-27', startValue: 200 });
      return { status: 'APPLIED', state: { ...input.nextState }, version: 3 };
    });
    const clock = { now: () => new Date('2026-07-27T08:00:00Z') };
    const res = await ensureDailyStart({ portfolioId: 'p', load, commit, clock });
    expect(res.date).toBe('2026-07-27');
    expect(res.startValue).toBe(200);
  });

  it('DUPLICATE returns RPC state value', async ()=>{
    const load = vi.fn().mockResolvedValue({ state: { id: 'p', availableCash: 10 }, version: 1 });
    const commit = vi.fn().mockResolvedValue({ status: 'DUPLICATE', state: { id: 'p', availableCash: 10, dailyRisk: { date: '2026-07-27', startValue: 10 } }, version: 2 });
    const clock = { now: () => new Date('2026-07-27T09:00:00Z') };
    const res = await ensureDailyStart({ portfolioId: 'p', load, commit, clock });
    expect(res.date).toBe('2026-07-27');
    expect(res.startValue).toBe(10);
  });

  it('VERSION_CONFLICT reloads once and returns winning value', async ()=>{
    const load = vi.fn()
      .mockResolvedValueOnce({ state: { id: 'p', availableCash: 5 }, version: 1 })
      .mockResolvedValueOnce({ state: { id: 'p', availableCash: 5, dailyRisk: { date: '2026-07-27', startValue: 5 } }, version: 2 });
    const commit = vi.fn().mockResolvedValue({ status: 'VERSION_CONFLICT', state: null, version: null });
    const clock = { now: () => new Date('2026-07-27T11:00:00Z') };
    const res = await ensureDailyStart({ portfolioId: 'p', load, commit, clock });
    expect(load).toHaveBeenCalledTimes(2);
    expect(res.startValue).toBe(5);
  });

  it('VERSION_CONFLICT without dailyRisk after reload throws', async ()=>{
    const load = vi.fn()
      .mockResolvedValueOnce({ state: { id: 'p', availableCash: 5 }, version: 1 })
      .mockResolvedValueOnce({ state: { id: 'p', availableCash: 5 }, version: 2 });
    const commit = vi.fn().mockResolvedValue({ status: 'VERSION_CONFLICT', state: null, version: null });
    const clock = { now: () => new Date('2026-07-27T11:00:00Z') };
    await expect(ensureDailyStart({ portfolioId: 'p', load, commit, clock })).rejects.toThrow(/VERSION_CONFLICT_NO_DAILY_RISK/);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalid availableCash throws without commit', async ()=>{
    const load = vi.fn().mockResolvedValue({ state: { id: 'p', availableCash: null }, version: 0 });
    const commit = vi.fn();
    const clock = { now: () => new Date('2026-07-27T10:00:00Z') };
    await expect(ensureDailyStart({ portfolioId: 'p', load, commit, clock })).rejects.toThrow(/invalid availableCash/);
    expect(commit).not.toHaveBeenCalled();
  });

  it('APPLIED with invalid response state throws', async ()=>{
    const load = vi.fn().mockResolvedValue({ state: { id: 'p', availableCash: 7 }, version: 0 });
    const commit = vi.fn().mockResolvedValue({ status: 'APPLIED', state: null, version: 1 });
    const clock = { now: () => new Date('2026-07-27T10:00:00Z') };
    await expect(ensureDailyStart({ portfolioId: 'p', load, commit, clock })).rejects.toThrow(/invalid response state/);
  });

  it('DUPLICATE with invalid or missing dailyRisk throws and does not reload', async ()=>{
    const load = vi.fn().mockResolvedValue({ state: { id: 'p', availableCash: 42 }, version: 9 });
    // commit returns DUPLICATE but with invalid dailyRisk (startValue not a number)
    const commit = vi.fn().mockResolvedValue({ status: 'DUPLICATE', state: { id: 'p', availableCash: 42, dailyRisk: { date: '2026-07-27', startValue: 'forty-two' } }, version: 10 });
    const clock = { now: () => new Date('2026-07-27T12:00:00Z') };

    await expect(ensureDailyStart({ portfolioId: 'p', load, commit, clock })).rejects.toThrow(/missing or invalid dailyRisk/);

    // ensure load was only called once (initial load) and commit exactly once
    expect(load).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

});
