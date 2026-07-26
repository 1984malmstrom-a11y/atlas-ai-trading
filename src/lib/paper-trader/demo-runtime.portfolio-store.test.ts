import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(()=>{
  vi.resetModules();
  // preserve env
  (global as any).__OLD_ENV = { ...process.env };
});

afterEach(()=>{
  // restore env
  process.env = { ...(global as any).__OLD_ENV };
  delete (global as any).__OLD_ENV;
  vi.restoreAllMocks();
});

describe('demo runtime portfolio factory', ()=>{
  it('does not call Supabase factory when PAPER_TRADER_PORTFOLIO_STORE is missing', async ()=>{
    const sup = await import('./supabase-portfolio-adapter');
    const spy = vi.spyOn(sup, 'createSupabasePortfolioAdapter').mockImplementation(((id:string)=> ({ getPortfolio: async ()=>({}), applyExecution: async ()=>({}) })) as any);
    const dt = await import('./demo-runtime');
    expect(spy).not.toHaveBeenCalled();
  });

  it('calls Supabase factory once with default demo id when store=\'supabase\' and no id', async ()=>{
    process.env.PAPER_TRADER_PORTFOLIO_STORE = 'supabase';
    delete process.env.PAPER_TRADER_PORTFOLIO_ID;
    const sup = await import('./supabase-portfolio-adapter');
    const spy = vi.spyOn(sup, 'createSupabasePortfolioAdapter').mockImplementation(((id:string)=> ({ getPortfolio: async ()=>({}), applyExecution: async ()=>({}) })) as any);
    const dt = await import('./demo-runtime');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('demo');
  });

  it('trims and passes provided PAPER_TRADER_PORTFOLIO_ID to Supabase factory', async ()=>{
    process.env.PAPER_TRADER_PORTFOLIO_STORE = 'supabase';
    process.env.PAPER_TRADER_PORTFOLIO_ID = '  my-portfolio  ';
    const sup = await import('./supabase-portfolio-adapter');
    const spy = vi.spyOn(sup, 'createSupabasePortfolioAdapter').mockImplementation(((id:string)=> ({ getPortfolio: async ()=>({}), applyExecution: async ()=>({}) })) as any);
    const dt = await import('./demo-runtime');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('my-portfolio');
  });
});
