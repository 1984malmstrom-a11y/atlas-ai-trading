import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('demo-runtime persistence', ()=>{
  const P = path.join(process.cwd(), 'src', 'data', 'portfolio.json');
  let backup: string | null = null;

  beforeAll(()=>{
    // If an existing portfolio file is present, move it aside to a timestamped backup
    try{
      if (fs.existsSync(P)){
        backup = `${P}.bak.${Date.now()}`;
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(P, backup);
      }
    }catch(e){ /* best-effort backup; continue */ }
  });

  beforeEach(()=>{
    // Ensure starting clean for each test
    try{ if (fs.existsSync(P)) fs.unlinkSync(P); }catch(e){ }
  });

  afterEach(()=>{
    // Remove any file created by the test
    try{ if (fs.existsSync(P)) fs.unlinkSync(P); }catch(e){ }
  });

  afterAll(()=>{
    // Restore original backup if it existed, otherwise ensure no portfolio file remains
    try{
      if (backup && fs.existsSync(backup)){
        // restore
        try{ if (fs.existsSync(P)) fs.unlinkSync(P);}catch(e){}
        fs.renameSync(backup, P);
      } else {
        try{ if (fs.existsSync(P)) fs.unlinkSync(P); }catch(e){}
      }
    }catch(e){ /* swallow */ }
  });

  it('runs two cycles and persists portfolio', async ()=>{
    // import runtime (module will initialize file)
    const mod = await import('./demo-runtime');
    const runtime = mod.default || mod;
    // run two cycles
    await runtime.runManualPaperTradingCycle();
    await runtime.runManualPaperTradingCycle();

    // file should exist and contain valid portfolio shape
    expect(fs.existsSync(P)).toBe(true);
    const raw = fs.readFileSync(P, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('availableCash');
    expect(parsed).toHaveProperty('holdings');
    expect(Array.isArray(parsed.holdings)).toBe(true);

    // ensure data can be read again
    const raw2 = fs.readFileSync(P, 'utf-8');
    const parsed2 = JSON.parse(raw2);
    expect(parsed2.availableCash).toBeDefined();
  });
});
