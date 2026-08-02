#!/usr/bin/env node
import fetch from 'node-fetch';
import process from 'process';

const DEFAULT_PORT = process.env.PORT || process.argv[2] || 3000;
const url = `http://localhost:${DEFAULT_PORT}/api/paper-trader`;
const maxMs = 5 * 60 * 1000; // 5 minutes
const interval = 5000;
const start = Date.now();
let seen = new Set();
let ticks = [];

function sanitize(state){
  const r = state.latestAutonomousRuntimeReadiness || {};
  const out = {
    lastAutomaticRunAt: r.lastAutomaticRunAt || null,
    nextAutomaticRunAt: r.nextAutomaticRunAt || null,
    lastCycleStatus: r.lastCycleStatus || null,
    lastCycleDurationMs: r.lastCycleDurationMs || null,
    cycleId: state.latestCycle && state.latestCycle.cycleId ? state.latestCycle.cycleId : null,
    lockInProgress: !!(state && state.scheduler && state.scheduler.inProgress),
    schedulerRunning: !!state.schedulerRunning,
    exactlyOneTimer: !!(r.exactlyOneTimer),
    consecutiveFailures: r.consecutiveFailures || 0,
    providerBackoffActive: !!r.providerBackoffActive,
    analyzedSymbols: state.latestDecision && state.latestDecision.analyzedSymbols ? state.latestDecision.analyzedSymbols : null,
    decisions: state.latestDecision ? { action: state.latestDecision.action || null, confidence: state.latestDecision.confidence || null } : null,
    executionsCount: state.latestCycle && Array.isArray(state.latestCycle.executions) ? state.latestCycle.executions.length : null,
    warnings: r.warnings || [],
    availableCash: state.availableCash || null,
    holdingsCount: Array.isArray(state.holdings) ? state.holdings.length : null
  };
  return out;
}

(async ()=>{
  while(Date.now() - start < maxMs && ticks.length < 2){
    try{
      const res = await fetch(url, { timeout: 10000 });
      const j = await res.json();
      const r = j.latestAutonomousRuntimeReadiness || {};
      const last = r.lastAutomaticRunAt || null;
      if (last && !seen.has(last)){
        seen.add(last);
        const s = sanitize(j);
        ticks.push(s);
        console.log('TICK_OBSERVED', JSON.stringify(s));
      }
      if (ticks.length === 0 && Object.keys(r).length > 0 && !seen.has('__initial__')){
        seen.add('__initial__');
        console.log('INITIAL_READINESS', JSON.stringify(sanitize(j)));
      }
    }catch(e){ console.error('ERR_FETCH', String(e && e.message ? e.message : e)); }
    await new Promise(r=>setTimeout(r, interval));
  }
  if (ticks.length >= 2){
    console.log('SUCCESS: Observed 2 ticks');
    process.exit(0);
  }
  console.error('TIMEOUT: Did not observe 2 ticks in time');
  process.exit(2);
})();
