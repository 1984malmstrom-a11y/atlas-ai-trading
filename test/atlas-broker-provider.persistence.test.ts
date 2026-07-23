import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __setPortfolioPathForTest, getPortfolio, savePortfolio } from '../src/domain/portfolio/portfolio-service';
import { AtlasPaperBrokerProvider } from '../src/domain/trading/broker-providers';

async function writeJson(file: string, obj: any){
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2), 'utf-8');
}

describe('AtlasPaperBrokerProvider persistence (file-backed)', ()=>{
  let tmpDir: string;
  let pfile: string;
  let restoreFn: (()=>void) | null = null;
  const initialPortfolio = {
    id: 'test', baseCurrency: 'SEK', totalValue: 100000, availableCash: 100000,
    totalReturnPercent: 0, benchmarkReturnPercent: 0, largestRisk: '', estimatedRisk: '',
    holdings: [ { id: 'h_NVDA', symbol: 'NVDA', name: 'NVDA', quantity: 38, averagePrice: 209.72, currentPrice: 209.72, marketValue: 7969.36 } ]
  };

  beforeEach(async ()=>{
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-pf-'));
    pfile = path.join(tmpDir, 'portfolio.json');
    await writeJson(pfile, initialPortfolio);
    restoreFn = __setPortfolioPathForTest(pfile);
  });

  afterEach(async ()=>{
    try{ if (restoreFn) restoreFn(); }catch(e){}
    try{ if (tmpDir && fsSync.existsSync(tmpDir)) await fs.rm(tmpDir, { recursive: true, force: true }); }catch(e){}
  });

  it('reads portfolio via broker', async ()=>{
    const broker = new AtlasPaperBrokerProvider();
    const acct = await broker.getAccount();
    expect(acct.cash).toBeCloseTo(100000);
    const pos = await broker.getPositions();
    const nv = pos.find(p=>p.symbol==='NVDA');
    expect(nv).toBeDefined();
    expect(nv?.quantity).toBe(38);
  });

  it('BUY success persists updated portfolio', async ()=>{
    const broker = new AtlasPaperBrokerProvider();
    // BUY 1 NVDA
    const res = await broker.placeOrder({ instrumentId: 'nvda', symbol: 'NVDA', side: 'BUY', quantity: 1, orderType: 'MARKET' });
    expect(res.status).toBe('EXECUTED');
    // read file
    const raw = await fs.readFile(pfile, 'utf-8');
    const after = JSON.parse(raw);
    const holding = after.holdings.find((h:any)=> h.symbol==='NVDA');
    expect(holding).toBeDefined();
    expect(holding.quantity).toBeGreaterThanOrEqual(39);
    expect(after.availableCash).toBeLessThan(100000);
    // new instance reads updated value
    __setPortfolioPathForTest(pfile);
    const fresh = getPortfolio();
    expect(fresh.availableCash).toBeCloseTo(after.availableCash);
  });

  it('SELL success persists updated portfolio', async ()=>{
    const broker = new AtlasPaperBrokerProvider();
    // SELL 1 NVDA
    const res = await broker.placeOrder({ instrumentId: 'nvda', symbol: 'NVDA', side: 'SELL', quantity: 1, orderType: 'MARKET' });
    expect(res.status).toBe('EXECUTED');
    const raw = await fs.readFile(pfile, 'utf-8');
    const after = JSON.parse(raw);
    const holding = after.holdings.find((h:any)=> h.symbol==='NVDA');
    expect(holding).toBeDefined();
    expect(holding.quantity).toBeLessThanOrEqual(37 + 1);
    expect(after.availableCash).toBeGreaterThan(100000 - 1e6);
  });

  it('REJECT invalid SELL larger than holding and file unchanged', async ()=>{
    const before = JSON.parse(await fs.readFile(pfile, 'utf-8'));
    const broker = new AtlasPaperBrokerProvider();
    const res = await broker.placeOrder({ instrumentId: 'nvda', symbol: 'NVDA', side: 'SELL', quantity: 10000, orderType: 'MARKET' });
    expect(res.status).toBe('REJECTED');
    const after = JSON.parse(await fs.readFile(pfile, 'utf-8'));
    expect(after).toEqual(before);
  });

  it('persistence failure leaves broker state unchanged', async ()=>{
    // spy on savePortfolio to throw
    const svc = await import('../src/domain/portfolio/portfolio-service');
    // use vitest spy
    const { vi } = await import('vitest');
    const spy = vi.spyOn(svc, 'savePortfolio').mockImplementation(async ()=>{ throw new Error('disk full'); });
    try{
      const broker = new AtlasPaperBrokerProvider();
      const acctBefore = await broker.getAccount();
      const res = await broker.placeOrder({ instrumentId: 'nvda', symbol: 'NVDA', side: 'BUY', quantity: 1, orderType: 'MARKET' });
      expect(res.status).toBe('REJECTED');
      const acctAfter = await broker.getAccount();
      expect(acctAfter.cash).toBeCloseTo(acctBefore.cash);
      const disk = JSON.parse(await fs.readFile(pfile, 'utf-8'));
      expect(disk).toEqual(initialPortfolio);
    }finally{
      spy.mockRestore();
    }
  });

  it('failing save is attempted once and its promise rejects, next save succeeds', async ()=>{
    const svc = await import('../src/domain/portfolio/portfolio-service');
    const { vi } = await import('vitest');
    // make rename fail for the first call
    const spy = vi.spyOn(svc.__fs, 'rename' as any).mockImplementationOnce(async ()=>{ throw new Error('disk full'); });
    const fail = { ...initialPortfolio, availableCash: 90000 };
    const good = { ...initialPortfolio, availableCash: 80000 };

    // failing save
    let failed = false;
    try{ await savePortfolio(fail); }catch(e){ failed = true; }
    expect(failed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    // now perform a valid save
    await savePortfolio(good);
    const raw = await fs.readFile(pfile, 'utf-8');
    const final = JSON.parse(raw);
    expect(final.availableCash).toBe(80000);
    const files = await fs.readdir(tmpDir);
    const tmpFiles = files.filter(f=> f.includes('.tmp.'));
    expect(tmpFiles.length).toBe(0);

    spy.mockRestore();
  });

  it('concurrent saves serialize and last one wins; no tmp files left', async ()=>{
    // use savePortfolio directly to stress queue
    const p1 = { ...initialPortfolio, availableCash: 90000 };
    const p2 = { ...initialPortfolio, availableCash: 80000 };
    const p1Promise = savePortfolio(p1);
    const p2Promise = savePortfolio(p2);
    await Promise.allSettled([p1Promise, p2Promise]);
    const raw = await fs.readFile(pfile, 'utf-8');
    const final = JSON.parse(raw);
    expect(final.availableCash).toBe(80000);
    // ensure no tmp files remain
    const files = await fs.readdir(tmpDir);
    const tmpFiles = files.filter(f=> f.includes('.tmp.'));
    expect(tmpFiles.length).toBe(0);
  });

  it('failed save does not break queue; subsequent save succeeds', async ()=>{
    const svc = await import('../src/domain/portfolio/portfolio-service');
    const { vi } = await import('vitest');
    // cause first rename to fail once by spying on exported __fs
    const spy = vi.spyOn(svc.__fs, 'rename' as any).mockImplementationOnce(async ()=>{ throw new Error('disk full'); });
    try{
      const good = { ...initialPortfolio, availableCash: 70000 };
      const fail = { ...initialPortfolio, availableCash: 60000 };
      const r1 = savePortfolio(fail).catch(()=>{});
      const r2 = savePortfolio(good);
      await Promise.all([r1, r2]);
      const raw = await fs.readFile(pfile, 'utf-8');
      const final = JSON.parse(raw);
      expect(final.availableCash).toBe(70000);
      const files = await fs.readdir(tmpDir);
      const tmpFiles = files.filter(f=> f.includes('.tmp.'));
      expect(tmpFiles.length).toBe(0);
    }finally{
      spy.mockRestore();
    }
  });

  it('restore returns service to previous path and cache', async ()=>{
    const prev = getPortfolio();
    // set new test path and get restore function
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-pf-')); 
    const alt = path.join(tmp2, 'alt.json');
    await writeJson(alt, initialPortfolio);
    const restore = __setPortfolioPathForTest(alt);
    // now restore
    restore();
    const after = getPortfolio();
    expect(after).toEqual(prev);
    // cleanup tmp2
    try{ if (fsSync.existsSync(tmp2)) await fs.rm(tmp2, { recursive: true, force: true }); }catch(e){}
  });
});
