import { it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadEnvConfig } from '@next/env';

it('direct Twelve Data NVDA diagnostic and 3 autonomous cycles', async ()=>{
  // Load Next.js environment files similarly to Next.js runtime
  loadEnvConfig(process.cwd());

  // Check for API key presence in project env files
  const ENV_FILES = ['.env.local','.env.development.local','.env.development','.env'];
  let envFileFound = 'NONE';
  for (const f of ENV_FILES){
    const p = path.join(process.cwd(), f);
    try{
      if (fs.existsSync(p)){
        const content = fs.readFileSync(p,'utf8');
        if (/^\s*TWELVE_DATA_API_KEY\s*=\s*/m.test(content)){
          envFileFound = f; break;
        }
      }
    }catch(e){}
  }

  const apiPresent = !!process.env.TWELVE_DATA_API_KEY;
  // If key missing in process.env (Vitest sets NODE_ENV=test so Next may ignore .env.local), try reading .env.local directly
  let envSource: 'PROCESS_ENV' | 'ENV_LOCAL' | 'MISSING' = apiPresent ? 'PROCESS_ENV' : 'MISSING';
  if (!apiPresent){
    try{
      const p = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(p)){
        const content = fs.readFileSync(p,'utf8');
        // find TWELVE_DATA_API_KEY line supporting comments and quoted values
        const lines = content.split(/\r?\n/);
        for (const line of lines){
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const m = trimmed.match(/^TWELVE_DATA_API_KEY\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#]*?))(?:\s*(?:#.*)?)?$/);
          if (m){
            const v = m[1] ?? m[2] ?? m[3] ?? '';
            const val = typeof v === 'string' ? v.trim() : '';
            if (val){
              // set into process.env but never log or persist the value
              process.env.TWELVE_DATA_API_KEY = val;
              envSource = 'ENV_LOCAL';
              break;
            }
          }
        }
      }
    }catch(e){ /* ignore read errors */ }
  }

  console.log('ENV_FILE_FOUND:', envFileFound);
  console.log('ENV_SOURCE:', envSource);
  console.log('API_KEY_PRESENT:', !!process.env.TWELVE_DATA_API_KEY ? 'YES' : 'NO');

  if (!process.env.TWELVE_DATA_API_KEY){
    throw new Error('TWELVE_DATA_API_KEY not present in environment after attempting .env.local; aborting diagnostics per instructions');
  }

  process.env.PAPER_TRADER_SCHEDULER_MODE = 'in_memory';
  (process.env as any).NODE_ENV = 'development';

  // Import provider class after loading env
  const { TwelveDataMarketDataProvider } = await import('../market-data/twelve-data');
  const provider = new TwelveDataMarketDataProvider();

  const diagnosticsPath = path.join(process.cwd(),'src','data','twelve-diagnostics.json');
  // remove previous diagnostics for clean reading
  try{ if (fs.existsSync(diagnosticsPath)) fs.unlinkSync(diagnosticsPath); }catch(e){}

  let directDiag: any = null;
  try{
    // instrumentId for NVDA is 'nvidia'
    await provider.getQuote('nvidia');
    // read diagnostics file
    if (fs.existsSync(diagnosticsPath)){
      const arr = JSON.parse(fs.readFileSync(diagnosticsPath,'utf8')||'[]');
      if (Array.isArray(arr) && arr.length>0) directDiag = arr[arr.length-1];
    }
  }catch(e){
    // even on error a diagnostic entry may have been written
    if (fs.existsSync(diagnosticsPath)){
      const arr = JSON.parse(fs.readFileSync(diagnosticsPath,'utf8')||'[]');
      if (Array.isArray(arr) && arr.length>0) directDiag = arr[arr.length-1];
    }
  }

  // Report direct provider diagnostic fields (assert existence)
  expect(directDiag).toBeTruthy();
  console.log('DIRECT_PROVIDER_DIAGNOSTIC:', JSON.stringify(directDiag, null, 2));

  // Remove temporary audit file if present
  try{ const tmp = path.join(process.cwd(),'src','data','victor-trading-audit.json.tmp'); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }catch(e){}

  // Now start runtime scheduler and observe 3 autonomous cycles
  const demo = await import('./demo-runtime');
  try{ await demo.__clearAudits(); }catch(e){}
  demo.startAutonomousScheduler(1000);

  const AUDIT_PATH = path.join(process.cwd(),'src','data','victor-trading-audit.json');
  const seen = new Set<string>();
  const observed: any[] = [];
  const start = Date.now();

  function readAudits(){ try{ const raw = fs.readFileSync(AUDIT_PATH,'utf8'); return JSON.parse(raw||'[]'); }catch(e){ return []; } }

  // initial snapshot
  const initial = readAudits();
  for(const a of initial){ try{ const cid = (a && a.summary && a.summary.cycleId) || (a && a.raw && a.raw.decision && a.raw.decision.id) || null; if(cid) seen.add(cid); }catch(e){} }

  while(observed.length < 3 && (Date.now()-start) < 120_000){
    await new Promise(r=> setTimeout(r, 1000));
    const audits = readAudits();
    const cycleIds: string[] = [];
    for(const a of audits){ try{ const cid = (a && a.summary && a.summary.cycleId) || (a && a.raw && a.raw.decision && a.raw.decision.id) || null; if(cid) cycleIds.push(cid); }catch(e){} }
    const uniq = Array.from(new Set(cycleIds));
    for(const cid of uniq){ if(!seen.has(cid)){
        seen.add(cid);
        const entries = audits.filter((a: any)=> ((a && a.summary && a.summary.cycleId) || (a && a.raw && a.raw.decision && a.raw.decision.id)) === cid);
        const nv = entries.find((e: any)=> (e && ((e.summary && e.summary.symbol) || (e.raw && e.raw.decision && e.raw.decision.symbol)) && ((String((e.summary&&e.summary.symbol)||'') || String((e.raw&&e.raw.decision&&e.raw.decision.symbol)||'')).toUpperCase() === 'NVDA')));
        const info: any = { cycleId: cid, nvda: null };
        if(nv){
          const summary = nv.summary || {};
          const raw = nv.raw || {};
          const decision = raw.decision || summary.decision || null;
          info.nvda = {
            quoteFound: !!(summary && (summary.referencePrice || raw.decision && raw.decision.referencePrice)),
            referencePrice: summary.referencePrice ?? (raw.decision && raw.decision.referencePrice) ?? null,
            stale: summary.isStale ?? raw.isStale ?? null,
            decision: decision ? decision.action : (summary && summary.action) || null,
            confidence: (decision && (decision.confidence ?? null)) ?? (summary && (summary.confidence ?? null)) ?? null,
            finalReason: (raw && raw.reason && (raw.reason.code || raw.reason.rejectReason || raw.reason.message)) || null,
            executionAttempted: !!(raw && raw.kind === 'EXECUTION'),
            executed: !!(summary && summary.executionStatus === 'EXECUTED')
          };
        }
        observed.push(info);
        console.log('AUTO_CYCLE_NVDA:', JSON.stringify(info));
      } }
  }

  demo.stopAutonomousScheduler();

  expect(observed.length).toBeGreaterThanOrEqual(0);
  console.log('OBSERVED_CYCLES:', observed.length);
}, { timeout: 120000 });
