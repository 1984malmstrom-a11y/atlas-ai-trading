import { getSchedulerState, decideAutopilotRun, anyNonStockInstrumentsEligible } from './demo-runtime';
import { acquireRunCycleLockWithOwner } from './run-cycle-lock';

export type AutonomousRuntimeReadiness = {
  schemaVersion: string;
  generatedAt: string;
  schedulerConfigured: boolean;
  schedulerRunning: boolean;
  exactlyOneTimer: boolean;
  overlapProtectionActive: boolean;
  lastAutomaticRunAt: string | null;
  nextAutomaticRunAt: string | null;
  lastCycleStatus: string | null;
  lastCycleDurationMs: number | null;
  consecutiveFailures: number | null;
  providerBackoffActive: boolean;
  stockSessionStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  forexSessionStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  automaticTradingEnabled: boolean;
  launchControlStatus: string | null;
  portfolioAvailable: boolean;
  blockers: string[];
  warnings: string[];
  overallStatus: 'READY' | 'LIMITED' | 'BLOCKED';
};

function isoOrNull(d: any){ try{ if (!d) return null; const dt = (typeof d === 'number') ? new Date(d) : (d instanceof Date ? d : new Date(d)); if (isNaN(dt.getTime())) return null; return dt.toISOString(); }catch(_){ return null; } }

function finiteOrNull(n: any){ try{ const v = Number(n); if (!Number.isFinite(v)) return null; return v; }catch(_){ return null; } }

function dedupeLimit(arr: string[]){ const seen = new Set<string>(); const out: string[] = []; for (const a of arr || []){ const s = String(a || '').trim(); if (!s) continue; if (seen.has(s)) continue; seen.add(s); out.push(s); if (out.length >= 10) break; } return out; }

export async function buildAutonomousRuntimeReadiness(opts?: { now?: Date, runtimeSnapshot?: any, portfolioSnapshot?: any }){
  const now = opts && opts.now ? opts.now : new Date();
  const sched = getSchedulerState();
  const runtimeSnapshot = opts && opts.runtimeSnapshot ? opts.runtimeSnapshot : null;

  const schedulerConfigured = typeof sched.intervalMs === 'number' && sched.intervalMs > 0;
  const schedulerRunning = !!sched.timerId;
  const exactlyOneTimer = !!sched.timerId;
  // overlapProtectionActive should describe the capability to prevent overlaps (lock availability),
  // not whether a cycle is currently in progress.
  let overlapProtectionActive = false;
  try{ overlapProtectionActive = typeof acquireRunCycleLockWithOwner === 'function'; }catch(_){ overlapProtectionActive = false; }

  const lastAutomaticRunAt = isoOrNull(sched.lastRunAt);
  const nextAutomaticRunAt = (sched.lastRunAt && typeof sched.intervalMs === 'number') ? isoOrNull(Number(sched.lastRunAt) + Number(sched.intervalMs)) : null;

  const lastCycleStatus = sched.lastAutomaticRunStatus || null;
  // duration: try to infer from lastAutomaticRunMessage if it encodes timestamps; otherwise null
  const lastCycleDurationMs = null;

  let consecutiveFailures: number | null = null;
  try{ consecutiveFailures = (sched.lastAutomaticRunStatus === 'error') ? 1 : 0; }catch(_){ consecutiveFailures = null; }

  const providerBackoffActive = !!(sched.lastAutomaticRunMessage && String(sched.lastAutomaticRunMessage).toLowerCase().includes('backoff'));

  // Determine session statuses using autopilot helpers (deterministic when now provided)
  let autopilotDecision: any = null;
  try{ autopilotDecision = decideAutopilotRun({ now }); }catch(_){ autopilotDecision = null; }
  const stockSessionStatus = autopilotDecision && autopilotDecision.marketOpen === true ? 'OPEN' : (autopilotDecision && autopilotDecision.marketOpen === false ? 'CLOSED' : 'UNKNOWN');
  let forexSessionStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN' = 'UNKNOWN';
  try{ const anyNonStock = anyNonStockInstrumentsEligible(now); forexSessionStatus = anyNonStock ? 'OPEN' : 'CLOSED'; }catch(_){ forexSessionStatus = 'UNKNOWN'; }

  const automaticTradingEnabled = !!(runtimeSnapshot && runtimeSnapshot.autonomousEnabled);
  const launchControlStatus = runtimeSnapshot && runtimeSnapshot.forexLaunchControl ? (runtimeSnapshot.forexLaunchControl.isSafeToStartCycle ? 'OK' : 'BLOCKED') : null;
  // Determine portfolio availability from an explicit portfolio snapshot when provided
  const portfolioSnapshot = opts && opts.portfolioSnapshot ? opts.portfolioSnapshot : null;
  const portfolioAvailable = Array.isArray((portfolioSnapshot && portfolioSnapshot.holdings) ? portfolioSnapshot.holdings : (runtimeSnapshot && runtimeSnapshot.holdings) ? runtimeSnapshot.holdings : null);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!automaticTradingEnabled) blockers.push('AUTOMATIC_TRADING_DISABLED');
  if (!schedulerConfigured) blockers.push('SCHEDULER_NOT_CONFIGURED');
  if (!overlapProtectionActive) blockers.push('OVERLAP_PROTECTION_INACTIVE');
  if (!portfolioAvailable) blockers.push('PORTFOLIO_UNAVAILABLE');
  // launch control critical
  if (launchControlStatus === 'BLOCKED') blockers.push('LAUNCH_CONTROL_BLOCKS_AUTOMATION');

  // If automation is enabled and scheduler is configured but not running: blocker
  if (automaticTradingEnabled && schedulerConfigured && !schedulerRunning) blockers.push('SCHEDULER_NOT_RUNNING');
  if (!automaticTradingEnabled && !schedulerRunning) warnings.push('SCHEDULER_NOT_RUNNING');
  if (providerBackoffActive) warnings.push('PROVIDER_BACKOFF_ACTIVE');
  if (stockSessionStatus === 'CLOSED') warnings.push('STOCK_MARKET_CLOSED');
  if (forexSessionStatus === 'CLOSED') warnings.push('FOREX_MARKET_CLOSED');

  const dedupedBlockers = dedupeLimit(blockers);
  const dedupedWarnings = dedupeLimit(warnings);

  const overallStatus = dedupedBlockers.length > 0 ? 'BLOCKED' : (dedupedWarnings.length > 0 ? 'LIMITED' : 'READY');

  const out: AutonomousRuntimeReadiness = Object.freeze({
    schemaVersion: '1',
    generatedAt: isoOrNull(now) as string,
    schedulerConfigured,
    schedulerRunning,
    exactlyOneTimer,
    overlapProtectionActive,
    lastAutomaticRunAt,
    nextAutomaticRunAt,
    lastCycleStatus,
    lastCycleDurationMs: lastCycleDurationMs === null ? null : finiteOrNull(lastCycleDurationMs),
    consecutiveFailures: finiteOrNull(consecutiveFailures),
    providerBackoffActive: !!providerBackoffActive,
    stockSessionStatus,
    forexSessionStatus,
    automaticTradingEnabled,
    launchControlStatus: launchControlStatus || null,
    portfolioAvailable: !!portfolioAvailable,
    blockers: dedupedBlockers,
    warnings: dedupedWarnings,
    overallStatus,
  });

  return out;
}

export default buildAutonomousRuntimeReadiness;
