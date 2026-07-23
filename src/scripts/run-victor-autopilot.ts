#!/usr/bin/env node
const _so = 'server' + '-only';
void import(_so).catch(()=>{});

import fs from 'fs/promises';
import path from 'path';

import { loadEnvConfig } from '@next/env';

// We'll dynamically import Victor modules after loading Next.js env so providers
// that read TWELVE_DATA_API_KEY initialize with correct environment.
let runVictorTradingCycle: any = null;
let DEFAULT_PAPER_AUTO_MANDATE: any = null;

const AUDIT_PATH = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
const PORTFOLIO_PATH = path.join(process.cwd(), 'src', 'data', 'portfolio.json');

let INTERVAL_MS: number;
let RUN_ONCE: boolean;
let MODE: string | undefined;

// Load Next.js env (.env.local) so provider constructors will see TWELVE_DATA_API_KEY.
loadEnvConfig(process.cwd());

// After env loaded, read control env vars
INTERVAL_MS = Number(process.env.VICTOR_AUTOPILOT_INTERVAL_MS || process.env.VICTOR_AUTOPILOT_INTERVAL || 300000);
RUN_ONCE = String(process.env.VICTOR_AUTOPILOT_RUN_ONCE || process.env.VICTOR_AUTOPILOT_RUNONCE || 'false').toLowerCase() === 'true';
MODE = process.env.VICTOR_TRADING_MODE;

if (MODE !== 'paper'){
  console.error('VICTOR_TRADING_MODE must be exactly "paper". Aborting.');
  process.exit(2);
}

// Ensure Twelve Data API key is present — do not fall back to any mock.
if (!process.env.TWELVE_DATA_API_KEY){
  console.error('TWELVE_DATA_API_KEY not found in environment; aborting autopilot.');
  process.exit(2);
}

// Dynamically import Victor runtime now that env is loaded.
const _bootstrap = (async ()=>{
  const vt = await import('../domain/trading/victor-trading-engine');
  const vtTypes = await import('../domain/trading/victor-types');
  runVictorTradingCycle = vt.runVictorTradingCycle;
  DEFAULT_PAPER_AUTO_MANDATE = vtTypes.DEFAULT_PAPER_AUTO_MANDATE;
})();

_bootstrap.catch(err=>{
  console.error('Failed to load Victor runtime', err);
  process.exit(2);
});

let running = false;
let stopped = false;

async function readPortfolioSnapshot(){
  try{
    const raw = await fs.readFile(PORTFOLIO_PATH, 'utf-8');
    const p = JSON.parse(raw);
    return p;
  }catch(e){ return null; }
}

function formatOrder(o: any){
  return `${o.side} ${o.quantity} ${o.symbol}`;
}

async function runOnce(){
  if (running) {
    console.log('[autopilot] previous cycle still running, skipping');
    return;
  }
  running = true;
  const startAt = new Date();
  console.log(`[autopilot] cycle start ${startAt.toISOString()}`);
  try{
    const before = await readPortfolioSnapshot();
    if (before) console.log(`[autopilot] portfolio before: cash=${before.availableCash}`);

    const mandate = { ...DEFAULT_PAPER_AUTO_MANDATE, mode: DEFAULT_PAPER_AUTO_MANDATE.mode };
    const res = await runVictorTradingCycle({ mandate, trigger: 'SCHEDULED' });

    const endAt = new Date();
    console.log(`[autopilot] cycle end ${endAt.toISOString()}`);

    if (res && res.ok && res.report && res.report.audit){
      const audit = res.report.audit as any;
      const executed = audit.executed || [];
      if (executed.length === 0) console.log('[autopilot] no orders executed (HOLD)');
      for (const e of executed){
        const req = e.proposal as any;
        const result = e.result as any;
        console.log(`[autopilot] ${result.status} ${req.symbol} qty=${req.quantity} reason=${result.reason || ''}`);
      }
      const after = await readPortfolioSnapshot();
      if (after) console.log(`[autopilot] portfolio after: cash=${after.availableCash}`);
      // show next plan
      if (!RUN_ONCE) console.log(`[autopilot] next run in ${INTERVAL_MS}ms`);
    }else{
      console.log('[autopilot] no audit produced or unexpected result', res);
    }
  }catch(err:any){
    console.error('[autopilot] cycle error', err?.message || err);
  }finally{
    running = false;
  }
}

async function loop(){
  await runOnce();
  if (RUN_ONCE) return;
  if (stopped) return;
  // schedule next run after interval without overlapping
  setTimeout(() => {
    loop().catch(e=>console.error('autopilot loop error', e));
  }, INTERVAL_MS);
}

process.on('SIGINT', async ()=>{
  console.log('[autopilot] SIGINT received, shutting down');
  stopped = true;
  // wait for current run to finish
  while(running) await new Promise(r=>setTimeout(r,100));
  process.exit(0);
});
process.on('SIGTERM', async ()=>{
  console.log('[autopilot] SIGTERM received, shutting down');
  stopped = true;
  while(running) await new Promise(r=>setTimeout(r,100));
  process.exit(0);
});

(async ()=>{
  console.log('[autopilot] starting with', { INTERVAL_MS, RUN_ONCE, MODE });
  // ensure bootstrap completed and modules loaded before starting
  await _bootstrap;
  await loop();
})();
