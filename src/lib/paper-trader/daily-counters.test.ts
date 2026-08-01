import { describe, it, expect, beforeEach } from 'vitest';
import { __clearAudits, __appendTestAudits, __listAudits } from './demo-runtime';
import buildDailyTradingSummary from './daily-trading-summary';

describe('Daily trading summary', ()=>{
  beforeEach(async ()=>{ await __clearAudits(); });

  it('counts only today executed trades and sums realized PnL', async ()=>{
    const now = new Date();
    const todayIso = now.toISOString();
    const yesterday = new Date(now.getTime() - 24*3600*1000).toISOString();
    const execToday = { kind: 'EXECUTION', timestamp: todayIso, execution: { id: 'e1', symbol: 'EUR/USD', side: 'SELL', quantity: 1, executedPrice: 12, fee: 0 }, portfolioBefore: { holdings: [{ symbol: 'EUR/USD', averagePrice: 10 }] } };
    const execYesterday = { kind: 'EXECUTION', timestamp: yesterday, execution: { id: 'e2', symbol: 'EUR/USD', side: 'SELL', quantity: 1, executedPrice: 13, fee: 0 }, portfolioBefore: { holdings: [{ symbol: 'EUR/USD', averagePrice: 11 }] } };
    await __appendTestAudits([execToday, execYesterday]);
    const wrapper = { list: async ()=> await __listAudits() };
    const summary = await buildDailyTradingSummary({ auditStore: wrapper as any, now });
    expect(summary.executedTradeCount).toBe(1);
    expect(summary.realizedPnLSek).toBeCloseTo(2);
    expect(summary.dailyLossSek).toBe(0);
  });
});
