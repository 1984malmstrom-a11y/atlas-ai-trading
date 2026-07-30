import { getNextNYOpenInstant } from '../../lib/us-market';
import createPaperTrader from './engine';
import ensureDailyStart from './ensure-daily-start';
import { PaperTraderConfig, PaperTradeDecision, SimulatedExecution, AuditEntry, LearningSignal } from './types';
import { calculatePerformance } from './performance-analytics';
import { evaluatePerformanceReflection } from './reflection-engine';
import * as DecisionEngine from './decision-engine';
import { evaluateTrade } from './trade-evaluation';
import { resolveSingleEntryForReview } from './trade-review-entry';
import { createTradeFeedback } from './trade-feedback';
import { buildTradeReview } from './trade-review-builder';
// defer loading of technical analysis and instruments so tests can mock them before use
import { combineAnalyses } from './analysis-aggregator';
import estimateExpectedReturn from './expected-return';
import analyzePriceSeries from './technical';
import classifyMarketRegime from './market-regime-classifier';
import buildMarketContextAdvice from './market-context-advisor';
import buildHistoricalContext from './historical-context-engine';
import buildDecisionConfidenceExplanation from './decision-confidence-explainer';
import buildDecisionEvidence from './evidence-aggregator';
import analyzeEvidenceConsistency from './evidence-consistency-analyzer';
import buildEvidenceInformedDecision from './evidence-informed-decision-policy';
import evaluateShadowDecisionOutcome from './shadow-decision-outcome-evaluator';
import aggregateShadowDecisionPerformance from './shadow-decision-performance-aggregator';
import { TRADABLE_INSTRUMENTS } from '../market-data/instruments';
import { TwelveDataMarketDataProvider } from '../market-data/twelve-data';
import fs from 'fs';
import path from 'path';
import computeNextPortfolioState from './portfolio-mutation';
import { Portfolio } from '../../domain/portfolio/types';
import { createSupabasePortfolioAdapter } from './supabase-portfolio-adapter';
import { SupabaseAuditAdapter } from './supabase-audit-adapter';
import { acquireRunCycleLockWithOwner, releaseRunCycleLock } from './run-cycle-lock';

// Server-side in-memory runtime for demo-only Paper Trader V1

type RuntimeState = {
  startCapital: number;
  enabled: boolean;
  trader: ReturnType<typeof createPaperTrader>;
  portfolioAdapter: any;
  auditStore: any;
  latestDecision?: PaperTradeDecision | null;
  latestCycle?: any;
  lastUpdated?: string;
  autonomousEnabled: boolean;
  // scheduler is represented by the global singleton; do not duplicate state here
};

// singleton runtime stored at module scope
const START_CAPITAL = 100000;

function nowIso(){ return new Date().toISOString(); }

// Helper: simple evaluation rules (module-scope so tests can import)
export function evaluateHoldingActionPublic(h:any, q:any){
  const avg = Number(h.averagePrice || 0);
  const price = (q && (typeof q.priceSek === 'number' ? q.priceSek : (typeof q.price === 'number' ? q.price : null))) || (h.currentPrice||null);
  if (!price || !avg) return { action: 'HOLD', reason: 'No sufficient data', score: 0 };
  // stop-loss if price dropped 5% or more
  if (price <= avg * 0.95) return { action: 'SELL', reason: 'Stop-loss triggered', score: -100 };
  // negative exit if price dropped 2% or more
  if (price <= avg * 0.98) return { action: 'SELL', reason: 'Negative exit signal', score: -50 };
  return { action: 'HOLD', reason: 'No exit signal', score: 0 };
}

export function decideBuySignalFromLastRef(usePrice: number, lastRef: number | null){
  if (!lastRef || !usePrice) return { buySignal: false, reason: 'No prior evaluation' };
  if (usePrice <= lastRef * 0.99) return { buySignal: true, reason: 'Price dipped 1% vs last reference' };
  return { buySignal: false, reason: 'No dip' };
}

// Build compact trade feedback summary from auditStore (if any). Returns undefined when none.
async function computeTradeFeedbackSummary(auditStore: any){
  try{
    const audits = await auditStore.list();
    if (!Array.isArray(audits) || audits.length === 0) return undefined;
    const rows: Array<{ pnlSek:number; pnlPercent:number; verdict:string; ts:string }> = [];
    for (const a of audits){
      if (!a || typeof a !== 'object') continue;
      const raw = (a as Record<string, unknown>)['raw'] ?? a;
      if (!raw || typeof raw !== 'object') continue;
      const evaluation = (raw as Record<string, unknown>)['evaluation'] as Record<string, unknown> | undefined;
      if (!evaluation || typeof evaluation !== 'object') continue;
      const tr = evaluation['tradeReview'] as Record<string, unknown> | undefined;
      if (!tr || typeof tr !== 'object') continue;
      // Use createTradeFeedback to normalize/validate each found trade review entry
      try{
        const execId = (tr['executionId'] || tr['executionId']) as unknown as string;
        const pnlSek = Number(tr['pnlSek']);
        const pnlPercent = Number(tr['pnlPercent']);
        const winner = Boolean(tr['winner']);
        const tf = createTradeFeedback({ executionId: execId ?? '', pnlSek, pnlPercent, winner });
        const ts = (a as Record<string, unknown>)['timestamp'] || (raw as Record<string, unknown>)['timestamp'] || '';
        rows.push({ pnlSek: tf.pnlSek, pnlPercent: tf.pnlPercent, verdict: tf.verdict, ts: String(ts) });
      }catch(_){ /* skip invalid review entries */ }
    }
    if (rows.length === 0) return undefined;
    const wins = rows.filter(r => r.verdict === 'STRONG_WIN' || r.verdict === 'WIN').length;
    const avgPnl = rows.reduce((s,r)=> s + r.pnlSek, 0) / rows.length;
    rows.sort((a,b)=> (a.ts || '') > (b.ts || '') ? 1 : -1);
    const last = rows[rows.length-1];
    return { winRate: wins / rows.length, avgPnlSek: avgPnl, evaluatedCount: rows.length, lastVerdict: last.verdict };
  }catch(_){ return undefined; }
}

class InMemoryAuditStore {
  entries: AuditEntry[] = [];
  async append(e: AuditEntry){
    // Ensure stored audit IDs are unique even if producer generated identical ids
    const baseId = e.id || `audit_${Date.now()}`;
    let uniqueId = baseId;
    let suffix = 1;
    while (this.entries.find(x => x.id === uniqueId)){
      uniqueId = `${baseId}_${suffix++}`;
    }
    const toStore = { ...e, id: uniqueId } as AuditEntry;
    this.entries.push(toStore);
  }
  async list(){
    // Ensure that stored entries have unique ids (fix pre-existing duplicates)
    const seen = new Set<string>();
    for (let i = 0; i < this.entries.length; i++){
      const e = this.entries[i];
      let id = e.id || `audit_${i}`;
      if (seen.has(id)){
        let suffix = 1;
        let newId = `${id}_${suffix}`;
        while (seen.has(newId)){
          suffix++;
          newId = `${id}_${suffix}`;
        }
        this.entries[i] = { ...e, id: newId } as AuditEntry;
        id = newId;
      }
      seen.add(id);
    }
    return this.entries.slice().reverse();
  }
}

// File-backed audit store: persists audit entries to a JSON file under src/data
class FileAuditStore {
  private entries: any[] = [];
  private path: string;
  constructor(filePath: string){
    this.path = filePath;
    try{
      if (fs.existsSync(this.path)){
        const raw = fs.readFileSync(this.path, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.entries = parsed;
      }
    }catch(e){
      this.entries = [];
    }
  }

  private makeSummary(e: any){
    const decision = e.decision || (Array.isArray(e.decisions) && e.decisions[0]) || null;
    const exec = e.execution || (Array.isArray(e.executed) && e.executed[0] && (e.executed[0].result || e.executed[0].execution)) || null;
    const portfolioBefore = e.portfolioBefore || e.before || null;
    const portfolioAfter = e.portfolioAfter || e.after || null;
    const holdingBefore = portfolioBefore && Array.isArray(portfolioBefore.holdings) ? portfolioBefore.holdings : null;
    const holdingAfter = portfolioAfter && Array.isArray(portfolioAfter.holdings) ? portfolioAfter.holdings : null;
    return {
      cycleId: (e && (e as any).cycleId) ? (e as any).cycleId : (e && e.id) ? e.id : null,
      decisionId: decision && decision.id ? decision.id : null,
      symbol: decision && (decision.symbol || decision.instrumentId) || null,
      action: decision && decision.action ? decision.action : null,
      confidence: decision && typeof decision.confidence === 'number' ? decision.confidence : null,
      referencePrice: decision && typeof decision.referencePrice === 'number' ? decision.referencePrice : null,
      quoteTimestamp: decision && (decision.generatedAt || null),
      // Prefer an explicit `risk` object on the decision/execution if present. Reuse as-is.
      risks: (decision && (decision as any).risk) ? (decision as any).risk : (exec && (exec as any).risk) ? (exec as any).risk : (decision && (decision.risks || decision.reasoning)) || null,
      executionStatus: exec && exec.status ? exec.status : (exec ? 'EXECUTED' : null),
      executedPrice: exec && typeof exec.executedPrice === 'number' ? exec.executedPrice : null,
      quantity: exec && typeof exec.quantity === 'number' ? exec.quantity : null,
      notional: exec && typeof exec.notional === 'number' ? exec.notional : null,
      fee: exec && typeof exec.fee === 'number' ? exec.fee : null,
      cashBefore: portfolioBefore && typeof portfolioBefore.availableCash === 'number' ? portfolioBefore.availableCash : null,
      cashAfter: portfolioAfter && typeof portfolioAfter.availableCash === 'number' ? portfolioAfter.availableCash : null,
      holdingBefore,
      holdingAfter,
      createdAt: e.timestamp || new Date().toISOString(),
    };
  }

  private persistSync(){
    try{
      const dir = path.dirname(this.path);
      try{ fs.mkdirSync(dir, { recursive: true }); }catch(e){}
      const tmp = `${this.path}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2), 'utf-8');
      try{ fs.renameSync(tmp, this.path); }catch(e){ fs.writeFileSync(this.path, JSON.stringify(this.entries, null, 2), 'utf-8'); }
    }catch(e){ console.error('FileAuditStore persist failed', e); }
  }

  async append(e: AuditEntry){
    const baseId = e.id || `audit_${Date.now()}`;
    let uniqueId = baseId; let suffix = 1;
    while (this.entries.find((x:any) => x && x.raw && x.raw.id === uniqueId)) uniqueId = `${baseId}_${suffix++}`;
    const entryWithId = { ...e, id: uniqueId } as any;
    const summary = this.makeSummary(entryWithId);
    const toStore = { id: uniqueId, timestamp: entryWithId.timestamp || new Date().toISOString(), summary, raw: entryWithId };
    this.entries.push(toStore);
    this.persistSync();
  }

  async list(){
    return this.entries.slice().reverse();
  }
}

function createInMemoryPortfolioAdapter(initialCash: number){
  const PORTFOLIO_PATH = path.join(process.cwd(), 'src', 'data', 'portfolio.json');

  // initialize state from file if exists, otherwise default
  let state: Portfolio = {
    id: 'demo', baseCurrency: 'SEK', totalValue: initialCash, availableCash: initialCash, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: []
  };

  try{
    if (fs.existsSync(PORTFOLIO_PATH)){
      const raw = fs.readFileSync(PORTFOLIO_PATH, 'utf-8');
      try{
        const parsed = JSON.parse(raw);
        // basic validation
        if (parsed && typeof parsed.availableCash === 'number') state = parsed;
        else {
          // write default if parsed is invalid
          fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(state, null, 2), 'utf-8');
        }
      }catch(e){
        console.error('portfolio.json parse error, resetting to default', e);
        fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(state, null, 2), 'utf-8');
      }
    } else {
      // create file from default
      try{ fs.mkdirSync(path.dirname(PORTFOLIO_PATH), { recursive: true }); }catch(e){}
      fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(state, null, 2), 'utf-8');
    }
  }catch(e){
    console.error('Failed to initialize portfolio persistence', e);
  }

  function persist(){
    try{ fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(state, null, 2), 'utf-8'); }catch(e){ console.error('Failed to persist portfolio', e); }
  }

  return {
    getPortfolio: async ()=> JSON.parse(JSON.stringify(state)),
    applyExecution: async (exec: SimulatedExecution)=>{
      const nextPortfolio = computeNextPortfolioState(state, exec);
      state = nextPortfolio;
      persist();
      return JSON.parse(JSON.stringify(state));
    }
  };
}

// initialize runtime
const AUDIT_PATH = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
// choose audit store using same env used for portfolio store configuration
const _store = (process.env && process.env.PAPER_TRADER_PORTFOLIO_STORE) || '';
const auditStore = _store === 'supabase' ? new SupabaseAuditAdapter() : new FileAuditStore(AUDIT_PATH);
export function createRuntimePortfolioAdapter(){
  const store = (process.env && process.env.PAPER_TRADER_PORTFOLIO_STORE) || '';
  if (store === 'supabase'){
    const rawId = (process.env && process.env.PAPER_TRADER_PORTFOLIO_ID) || '';
    const portfolioId = (typeof rawId === 'string' ? rawId.trim() : '') || 'demo';
    return createSupabasePortfolioAdapter(portfolioId);
  }
  return createInMemoryPortfolioAdapter(START_CAPITAL);
}

const portfolioAdapter = createRuntimePortfolioAdapter();

// export FileAuditStore for focused tests
export { FileAuditStore };

// --- Test helpers (exported for unit tests) ---
let injectedCycleTrader: any | undefined = undefined;
export function __setTestTrader(t:any){
  try{ (runtime as any).trader = t; }catch(e){ }
  injectedCycleTrader = t;
}

// Return any injected per-cycle trader (module-scoped so vi.resetModules() clears it)
function getInjectedCycleTrader(): any | undefined { return injectedCycleTrader; }

export function __setTestPortfolio(adapter:any){
  try{ (runtime as any).portfolioAdapter = adapter; }catch(e){}
}

export async function __appendTestAudits(entries: any[]){
  try{
    for (const e of entries){ await auditStore.append(e); }
  }catch(e){ }

  // Per-run cycle id for correlation (one-per-cycle)
  try{
    (auditStore as any).entries = [];
    try{ (auditStore as any).persistSync(); }catch(_){ /* ignore */ }
  }catch(e){}
}

const config: PaperTraderConfig = {
  enabled: true,
  minimumBuyConfidence: 75,
  minimumSellConfidence: 75,
  maxPositionPercent: 0.10,
  maxOrderValueSek: 10_000,
  feesBps: 10,
  slippageBps: 5,
  cooldownMs: 60_000,
  maxTradesPerCycle: 1,
};

let trader = createPaperTrader({ portfolioAdapter, auditStore, config });

const runtime: RuntimeState = {
  startCapital: START_CAPITAL,
  enabled: config.enabled || false,
  trader: trader,
  portfolioAdapter,
  auditStore,
  latestDecision: null,
  latestCycle: null,
  lastUpdated: nowIso(),
  autonomousEnabled: true,
  // scheduler is represented by the global singleton; do not duplicate state here
};

// Scheduler singleton stored at module scope to survive hot reloads in dev
type SchedulerState = {
  timerId: NodeJS.Timeout | null;
  inProgress: boolean;
  lastRunAt: number | null;
  intervalMs: number;
  // diagnostics persisted on the singleton
  lastAutomaticRunStatus?: 'success' | 'skipped' | 'error' | null;
  lastAutomaticRunMessage?: string | null;
  lastAutomaticEvaluationCount?: number | null;
  lastAutomaticAuditCountBefore?: number | null;
  lastAutomaticAuditCountAfter?: number | null;
  // dynamic callback that can be replaced on hot-reload without replacing timer
  runTick?: (() => Promise<void>) | null;
};

// Global keyed singleton to survive module reloads in the same Node process
const GLOBAL_SCHEDULER_KEY = '__ATLAS_PAPER_TRADER_SCHEDULER__';

declare global {
  // Attach a typed scheduler to globalThis for stable ownership across HMR
  var __ATLAS_PAPER_TRADER_SCHEDULER__: SchedulerState | undefined;
}

function getGlobalScheduler(): SchedulerState {
  const g = globalThis as any;
  if (g.__ATLAS_PAPER_TRADER_SCHEDULER__ && typeof g.__ATLAS_PAPER_TRADER_SCHEDULER__ === 'object'){
    return g.__ATLAS_PAPER_TRADER_SCHEDULER__ as SchedulerState;
  }
  const initial: SchedulerState = { timerId: null, inProgress: false, lastRunAt: null, intervalMs: 60_000, runTick: null, lastAutomaticRunStatus: null, lastAutomaticRunMessage: null, lastAutomaticEvaluationCount: null, lastAutomaticAuditCountBefore: null, lastAutomaticAuditCountAfter: null } as SchedulerState;
  try{ g.__ATLAS_PAPER_TRADER_SCHEDULER__ = initial; }catch(_){ /* ignore in restricted envs */ }
  return initial;
}
export function getSchedulerState(){ return getGlobalScheduler(); }

// Autopilot decision helper: determines whether an automatic analysis should run next.
// Uses existing market-session helper `getNextNYOpenInstant` and scheduler state.
export function decideAutopilotRun(opts?: { now?: string | Date }){
  const now = opts && opts.now ? new Date(opts.now) : new Date();
  const sched = getGlobalScheduler();
  const market = getNextNYOpenInstant(now);
  let marketOpen = market.open === true;
  // Extra guard: ensure weekend instants in NY timezone are treated as closed
  try{
    const wk = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
    if (wk === 'Sat' || wk === 'Sun') marketOpen = false;
  }catch(_){ }

  // Determine if a cycle is currently running
  const alreadyRunning = Boolean(sched.inProgress === true);

  // Determine cooldown using configured cooldownMs and lastRunAt
  const cooldownMs = (config && typeof config.cooldownMs === 'number') ? config.cooldownMs : 0;
  const lastRunAt = typeof sched.lastRunAt === 'number' ? sched.lastRunAt : (sched.lastRunAt ? Number(new Date(sched.lastRunAt)) : null);
  let cooldownActive = false;
  let cooldownUntil: number | null = null;
  if (lastRunAt && cooldownMs > 0){
    const elapsed = Date.now() - lastRunAt;
    if (elapsed < cooldownMs){ cooldownActive = true; cooldownUntil = lastRunAt + cooldownMs; }
  }

  // Decide next run
  let shouldRun = false;
  let nextRunAt: Date | null = null;
  let reason = '';

  if (alreadyRunning){
    shouldRun = false; reason = 'Cycle already in progress';
    nextRunAt = new Date(Date.now() + 1000 * 60); // suggest short retry
  } else if (!marketOpen){
    shouldRun = false; reason = 'Market closed';
    // market may be typed as { open: true } | { open: false; nextOpenInstant: Date }
    if ((market as any) && (market as any).nextOpenInstant) nextRunAt = new Date((market as any).nextOpenInstant);
    else nextRunAt = null;
  } else if (cooldownActive){
    shouldRun = false; reason = 'Cooldown active';
    nextRunAt = cooldownUntil ? new Date(cooldownUntil) : null;
  } else {
    shouldRun = true; reason = 'Market open and ready'; nextRunAt = null;
  }

  return { shouldRun, nextRunAt, reason, marketOpen, cooldownActive, alreadyRunning } as any;
}

// Asset-aware session helper: determines whether a given instrument is tradable now
// Rules:
// - STOCK: uses NY market open check (same as decideAutopilotRun)
// - FOREX: 24/5, closed Fri 22:00 UTC -> Sun 22:00 UTC (inclusive)
// - COMMODITY: same 24/5 simplified rule as Forex (paper-trading simplification)
// - unknown: fallback to STOCK behaviour
export function isInstrumentTradableNow(instr: any, now?: Date){
  try{
    const t = now instanceof Date ? now : new Date();
    const type = instr && instr.assetType ? String(instr.assetType).toUpperCase() : 'STOCK';
    if (type === 'FOREX' || type === 'COMMODITY'){
      // Determine UTC day/hours for 24/5 rule
      const day = t.getUTCDay(); // 0=Sun .. 6=Sat
      const hour = t.getUTCHours();
      // Closed on Saturday
      if (day === 6) return false;
      // Sunday before 22:00 UTC closed
      if (day === 0 && hour < 22) return false;
      // Friday at or after 22:00 UTC closed
      if (day === 5 && hour >= 22) return false;
      return true; // otherwise open
    }
    // STOCK/unknown -> reuse NY market helper
    try{
      const ny = getNextNYOpenInstant(t);
      let open = ny && (ny as any).open === true;
      try{ const wk = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(t); if (wk === 'Sat' || wk === 'Sun') open = false; }catch(_){ }
      return !!open;
    }catch(_){ return false; }
  }catch(_){ return false; }
}

// Helper to check whether any non-stock instrument is currently eligible (market-wise)
export function anyNonStockInstrumentsEligible(now?: Date){
  try{
    // use module-scoped TRADABLE_INSTRUMENTS
    if (Array.isArray(TRADABLE_INSTRUMENTS)){
      return TRADABLE_INSTRUMENTS.some(i => {
        const enabled = (i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true);
        if (!enabled) return false;
        const t = now instanceof Date ? now : new Date();
        const type = i.assetType ? String(i.assetType).toUpperCase() : 'STOCK';
        if (type === 'STOCK') return false;
        return isInstrumentTradableNow(i, t);
      });
    }
    return false;
  }catch(_){ return false; }
}

// Implementation used as the dynamic runTick that can be swapped on hot-reload
async function runAutomaticCycleImplementation(){
  const sched = getGlobalScheduler();
  // If another run is in progress at the scheduler level, return early
  if (sched.inProgress) return { ran: false, reason: 'already_running' } as any;

  // Ask autopilot whether we should run now
  let decision: any = null;
  try{ decision = decideAutopilotRun(); }catch(_){ decision = null; }
  if (decision && !decision.shouldRun){
    // Compute per-instrument eligibility now; allow run only if at least one
    // enabled instrument is tradable now. This replaces the previous anyNonStock
    // bypass with a complete per-symbol eligibility check.
    try{
      const now = new Date();
      const eligible = Array.isArray(TRADABLE_INSTRUMENTS) ? TRADABLE_INSTRUMENTS.filter(i => {
        const enabled = (i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true);
        if (!enabled) return false;
        return isInstrumentTradableNow(i, now);
      }) : [];
      if (!eligible || eligible.length === 0){
        sched.lastAutomaticRunStatus = 'skipped';
        sched.lastAutomaticRunMessage = decision.reason || 'skipped by autopilot';
        try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
        return { ran: false, reason: sched.lastAutomaticRunMessage, nextRunAt: decision.nextRunAt || null } as any;
      }
      // otherwise continue with run but record diagnostic
      sched.lastAutomaticRunMessage = 'Continuing run for eligible instruments despite global market closed';
    }catch(e){
      sched.lastAutomaticRunStatus = 'skipped';
      sched.lastAutomaticRunMessage = decision.reason || 'skipped by autopilot';
      try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
      return { ran: false, reason: sched.lastAutomaticRunMessage, nextRunAt: decision.nextRunAt || null } as any;
    }
  }

  // Acquire distributed lock to ensure single execution across processes
  const GLOBAL_RUN_CYCLE_LOCK_KEY = 'paper-trader:cycle:default';
  let ownerToken: string | null = null;
  try{
    const lockRes = await acquireRunCycleLockWithOwner(GLOBAL_RUN_CYCLE_LOCK_KEY);
    if (lockRes.status === 'DUPLICATE'){
      sched.lastAutomaticRunStatus = 'skipped'; sched.lastAutomaticRunMessage = 'duplicate_lock';
      try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
      return { ran: false, reason: 'duplicate_lock' } as any;
    }
    if (lockRes.status === 'UNAVAILABLE'){
      sched.lastAutomaticRunStatus = 'skipped'; sched.lastAutomaticRunMessage = 'lock_unavailable';
      try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
      return { ran: false, reason: 'lock_unavailable' } as any;
    }
    ownerToken = (lockRes as any).ownerToken || null;
  }catch(e){ sched.lastAutomaticRunStatus = 'skipped'; sched.lastAutomaticRunMessage = 'lock_error'; try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; } return { ran: false, reason: 'lock_error' } as any; }

  // mark running
  sched.inProgress = true;
  // initialize diagnostics
  sched.lastAutomaticRunStatus = null;
  sched.lastAutomaticRunMessage = null;
  sched.lastAutomaticEvaluationCount = null;
  sched.lastAutomaticAuditCountBefore = null;
  sched.lastAutomaticAuditCountAfter = null;

  const startedAt = new Date().toISOString();
  let cycleResult: any = null;
  let cycleError: any = null;
  try{
    // snapshot audit counts before run
    let beforeList: any[] = [];
    try{ beforeList = await auditStore.list(); }catch(_){ beforeList = []; }
    const beforeCount = Array.isArray(beforeList) ? beforeList.length : 0;
    const beforeEvalCount = Array.isArray(beforeList) ? beforeList.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION').length : 0;

    try{ cycleResult = await runManualPaperTradingCycle({ allowWhenScheduler: true }); }catch(e:any){ cycleError = e; }

    // snapshot after run
    let afterList: any[] = [];
    try{ afterList = await auditStore.list(); }catch(_){ afterList = []; }
    const afterCount = Array.isArray(afterList) ? afterList.length : 0;
    const afterEvalCount = Array.isArray(afterList) ? afterList.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION').length : 0;

    // determine evaluationCount: prefer explicit result property if present
    let evalCount: number | null = null;
    try{ if (cycleResult && typeof (cycleResult as any).evaluationCount === 'number') evalCount = (cycleResult as any).evaluationCount; }catch(_){ evalCount = null; }
    if (evalCount === null) evalCount = afterEvalCount - beforeEvalCount;

    // determine status and message
    if (cycleError){
      sched.lastAutomaticRunStatus = 'error';
      sched.lastAutomaticRunMessage = cycleError && cycleError.message ? String(cycleError.message) : String(cycleError);
    } else if (cycleResult && cycleResult.skipped){
      sched.lastAutomaticRunStatus = 'skipped'; sched.lastAutomaticRunMessage = cycleResult.code || String(cycleResult.reason || 'skipped');
    } else {
      sched.lastAutomaticRunStatus = 'success'; sched.lastAutomaticRunMessage = null;
    }

    sched.lastAutomaticAuditCountBefore = beforeCount;
    sched.lastAutomaticAuditCountAfter = afterCount;
    sched.lastAutomaticEvaluationCount = typeof evalCount === 'number' ? evalCount : null;

  }catch(e:any){
    try{ sched.lastAutomaticRunStatus = 'error'; sched.lastAutomaticRunMessage = String(e && e.message ? e.message : e); }catch(_){ }
  }finally{
    // record finish time and clear inProgress so next interval can run
    try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
    // best-effort release lock
    try{ if (ownerToken) await releaseRunCycleLock(GLOBAL_RUN_CYCLE_LOCK_KEY, ownerToken); }catch(_){ }
    sched.inProgress = false;
    const completedAt = new Date().toISOString();
    return { ran: true, reason: sched.lastAutomaticRunMessage || 'completed', startedAt, completedAt, nextRunAt: null, cycleResult: (typeof cycleResult !== 'undefined' ? cycleResult : null), errorCode: (cycleError ? (cycleError && cycleError.message ? String(cycleError.message) : String(cycleError)) : null) } as any;
  }
}

function startAutonomousScheduler(intervalMs?: number){
  const sched = getGlobalScheduler();
  if (typeof intervalMs === 'number') sched.intervalMs = intervalMs;
  if (sched.timerId) return; // already running
  // schedule periodic runs using a stable wrapper that calls the dynamic runTick.
  // The wrapper does not capture the run implementation; it calls the current `runTick` and
  // attaches an error handler so rejections from a swapped runTick are recorded as diagnostics.
  sched.timerId = setInterval(()=>{
    try{
      const s = getGlobalScheduler();
      const p = s.runTick && s.runTick();
      if (p && typeof (p as any).catch === 'function'){
        (p as any).catch((err:any) => {
          try{ s.lastAutomaticRunStatus = 'error'; s.lastAutomaticRunMessage = String(err && err.message ? err.message : err); }catch(_){ }
          try{ s.lastRunAt = Date.now(); }catch(_){ s.lastRunAt = null; }
        });
      }
    }catch(e){
      try{ const s = getGlobalScheduler(); s.lastAutomaticRunStatus = 'error'; s.lastAutomaticRunMessage = String((e as any) && (e as any).message ? (e as any).message : e); s.lastRunAt = Date.now(); }catch(_){ }
    }
  }, sched.intervalMs);
}

function stopAutonomousScheduler(){
  const sched = getGlobalScheduler();
  if (sched.timerId){ clearInterval(sched.timerId); sched.timerId = null; }
}


export async function getPaperTradingState(){
  // GET must be read-only: do not start scheduler, trigger cycles, or mutate scheduler state here.
  const p = await portfolioAdapter.getPortfolio();
  const allAudits = await auditStore.list();
  // By default show only audits related to the latestDecision (final outcome) to keep Activity Feed focused.
  let audits = allAudits;
  try{
    if (runtime.latestDecision && runtime.latestDecision.id){
      const decId = runtime.latestDecision.id;
      const filtered = allAudits.filter((a:any)=>{
        try{
          if (a && a.raw && a.raw.decision && a.raw.decision.id === decId) return true;
          if (a && a.summary && a.summary.decisionId === decId) return true;
        }catch(e){}
        return false;
      });
      if (filtered && filtered.length>0) audits = filtered;
      else {
        // fallback: show latest EXECUTION if present, otherwise show the most recent REJECT
        const exec = allAudits.find((a:any)=> a && a.raw && a.raw.kind === 'EXECUTION');
        if (exec) audits = [exec];
        else audits = allAudits.slice(0,1);
      }
    }
  }catch(_){ audits = allAudits; }

  // Attempt to fetch live normalized quotes for holdings to compute mark-to-market
  let quotes: any[] | null = null;
  let quoteFetchOk = false;
  let quoteFetchMessage: string | null = null;
  try{
    const mod = await import('../market-data/quotes-service');
    if (mod && typeof mod.getNormalizedQuotes === 'function'){
      const res = await mod.getNormalizedQuotes();
      if (res && Array.isArray(res.quotes)){
        quotes = res.quotes;
        quoteFetchOk = true;
      } else {
        quoteFetchOk = false;
        quoteFetchMessage = 'No quotes returned';
      }
    }
  }catch(e:any){ quoteFetchOk = false; quoteFetchMessage = String(e?.message || e); }

  // Map quotes by symbol and instrumentId for easy lookup
  const quoteBySymbol = new Map<string, any>();
  const quoteById = new Map<string, any>();
  if (quotes){
    for (const q of quotes){
      if (q && q.symbol) quoteBySymbol.set(String(q.symbol).toUpperCase(), q);
      if (q && q.instrumentId) quoteById.set(String(q.instrumentId).toLowerCase(), q);
    }
  }

  // Compute holdings mark-to-market using fetched quotes when available; otherwise keep last known price
  const holdings = (p.holdings || []).map((h:any) => {
    try{
      const symbol = (h.symbol || '').toString().toUpperCase();
      const qty = Number(h.quantity || 0);
      const avg = Number(h.averagePrice || 0);
      let currentPrice = typeof h.currentPrice === 'number' ? h.currentPrice : undefined;

      // Prefer SEK-normalized price (priceSek) when present, otherwise price
      const q = (quotes && quoteBySymbol.get(symbol)) || null;
      if (q){
        if (typeof q.priceSek === 'number' && Number.isFinite(q.priceSek) && q.priceSek > 0) currentPrice = q.priceSek;
        else if (typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0 && (q.currency === 'SEK' || !q.currency)) currentPrice = q.price;
      }

      // If still undefined, try instrumentId lookup if holding has instrumentId
      if ((currentPrice === undefined || currentPrice === null) && h.instrumentId && quotes){
        const q2 = quoteById.get(String(h.instrumentId).toLowerCase());
        if (q2){ if (typeof q2.priceSek === 'number') currentPrice = q2.priceSek; else if (typeof q2.price === 'number') currentPrice = q2.price; }
      }

      // If no fresh price available, keep stored currentPrice (do not crash)
      const usePrice = (typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0) ? currentPrice : (typeof h.currentPrice === 'number' ? h.currentPrice : null);

      const marketValue = usePrice !== null ? Math.round(qty * usePrice * 100)/100 : (typeof h.marketValue === 'number' ? h.marketValue : 0);
      const invested = Math.round(qty * avg * 100)/100;
      const unrealizedPnl = usePrice !== null ? Math.round(((usePrice - avg) * qty) * 100)/100 : 0;
      const unrealizedPnlPct = (avg > 0 && usePrice !== null) ? Math.round(((usePrice / avg - 1) * 100) * 100)/100 : 0;

      return { ...h, currentPrice: usePrice, marketValue, invested, unrealizedPnl, unrealizedPnlPct };
    }catch(_){ return h; }
  });

  // Aggregates
  const totalInvested = holdings.reduce((s:any,h:any) => s + (Number(h.invested) || 0), 0);
  const totalMarketValue = holdings.reduce((s:any,h:any) => s + (Number(h.marketValue) || 0), 0);
  const totalUnrealized = holdings.reduce((s:any,h:any) => s + (Number(h.unrealizedPnl) || 0), 0);

  const computedTotalValue = Math.round(((p.availableCash || 0) + totalMarketValue) * 100)/100;

  const out: any = {
    enabled: runtime.enabled,
    mode: 'PAPER',
    startCapital: runtime.startCapital,
    availableCash: p.availableCash,
    holdings,
    totalInvested: Math.round(totalInvested * 100)/100,
    totalValue: computedTotalValue,
    totalMarketValue: Math.round(totalMarketValue * 100)/100,
    totalUnrealized: Math.round(totalUnrealized * 100)/100,
    totalReturnSek: Math.round((computedTotalValue - runtime.startCapital) * 100)/100,
    totalReturnPercent: Math.round(((computedTotalValue / runtime.startCapital - 1) * 100) * 100)/100,
    latestDecision: runtime.latestDecision || null,
    latestCycle: runtime.latestCycle || null,
    auditEntries: audits,
    lastUpdated: runtime.lastUpdated,
  };

  // Expose scheduler state explicitly for API consumers
  // Read scheduler state directly from the global singleton to avoid out-of-sync copies after hot reload.
  try{
    const sched = getGlobalScheduler();
    out.autonomousEnabled = !!runtime.autonomousEnabled;
    out.schedulerRunning = !!sched.timerId;
    out.cycleInProgress = !!sched.inProgress;
    out.intervalMs = sched.intervalMs;
    out.lastAutomaticRunAt = sched.lastRunAt ? new Date(sched.lastRunAt).toISOString() : null;
    out.nextAutomaticRunAt = sched.lastRunAt ? new Date(sched.lastRunAt + sched.intervalMs).toISOString() : null;
    out.lastAutomaticRunStatus = sched.lastAutomaticRunStatus || null;
    out.lastAutomaticRunMessage = sched.lastAutomaticRunMessage || null;
    out.lastAutomaticEvaluationCount = typeof sched.lastAutomaticEvaluationCount === 'number' ? sched.lastAutomaticEvaluationCount : null;
    out.lastAutomaticAuditCountBefore = typeof sched.lastAutomaticAuditCountBefore === 'number' ? sched.lastAutomaticAuditCountBefore : null;
    out.lastAutomaticAuditCountAfter = typeof sched.lastAutomaticAuditCountAfter === 'number' ? sched.lastAutomaticAuditCountAfter : null;
  }catch(e){
    out.autonomousEnabled = !!runtime.autonomousEnabled;
    out.schedulerRunning = false;
    out.cycleInProgress = false;
    out.intervalMs = null;
    out.lastAutomaticRunAt = null;
    out.nextAutomaticRunAt = null;
  }

  // Include quote fetch diagnostics when fetch failed
  if (!quoteFetchOk){ out.quoteFetch = { ok: false, message: quoteFetchMessage || 'Quote fetch failed, using stored prices' }; }
  else { out.quoteFetch = { ok: true }; }

  return out;
}

export async function getPerformanceSummary(){
  // Read all audits and extract valid TradeEvaluation objects from EVALUATION entries
  try{
    const all = await auditStore.list();
    const evals: any[] = [];
    for (const item of Array.isArray(all) ? all : []){
      try{
        const raw = (item && (item as any).raw) ? (item as any).raw : item;
        if (!raw || raw.kind !== 'EVALUATION') continue;
        // possible locations: raw.evaluation or raw.execution.evaluation
        const candidate = raw.evaluation || (raw.execution && raw.execution.evaluation) || null;
        if (!candidate) continue;
        const pnlSek = Number(candidate.pnlSek);
        const pnlPercent = Number(candidate.pnlPercent);
        const winner = candidate.winner === true || candidate.winner === false ? Boolean(candidate.winner) : null;
        if (!Number.isFinite(pnlSek) || !Number.isFinite(pnlPercent) || typeof winner !== 'boolean') continue;
        evals.push({ pnlSek, pnlPercent, winner });
      }catch(_){ continue; }
    }
    return calculatePerformance(evals as any);
  }catch(_){
    return calculatePerformance([]);
  }
}

export async function getPerformanceProfile(){
  try{
    const summary = await getPerformanceSummary();
    const reflection = evaluatePerformanceReflection(summary);
    return { summary, reflection };
  }catch(_){
    // On error, return an insufficient-data style profile
    const summary = await getPerformanceSummary();
    const reflection = evaluatePerformanceReflection(summary);
    return { summary, reflection };
  }
}

async function fetchQuotes(){
  // Prefer calling the server-side normalization function directly when available
  try{
    const mod = await import('../market-data/quotes-service');
    if (mod && typeof mod.getNormalizedQuotes === 'function'){
      const out = await mod.getNormalizedQuotes();
      return out && Array.isArray(out.quotes) ? out.quotes : null;
    }
  }catch(e){ /* ignore and try HTTP fallback */ }
  // Next fallback: call provider directly from lib/market-data (server-side)
  try{
    const prov = (await import('../../lib/market-data')).default;
    if (prov && typeof prov.getQuotes === 'function'){
      // Ask provider for common demo instruments
      const ids = ['nvidia','microsoft','apple'];
      const fetched = await prov.getQuotes(ids);
      if (Array.isArray(fetched) && fetched.length>0){
        // Map to minimal quote shape expected by runtime
        return fetched.map((f:any)=> ({ symbol: f.symbol || (f.providerSymbol||'').toUpperCase(), price: (f.price===undefined||f.price===null)? null : Number(f.price) }));
      }
    }
  }catch(e){ /* ignore */ }

  try{
    // HTTP fallback - use relative path (do not hardcode localhost)
    const res = await fetch('/api/market-data/quotes');
    if (!res.ok) return null;
    const data = await res.json();
    return data && Array.isArray(data.quotes) ? data.quotes : null;
  }catch(e){ return null; }
}

export async function runManualPaperTradingCycle(opts?: { allowWhenScheduler?: boolean, overrideUniverse?: { quotes?: any[], portfolio?: any, fundamentals?: Record<string, any> }, getPerformanceProfileOverride?: ()=>Promise<any> }){
  // Prevent overlapping with automatic scheduler when called externally
  try{
    const sched = getGlobalScheduler();
    if (sched.inProgress && !opts?.allowWhenScheduler) return { skipped: true, code: 'SCHEDULER_IN_PROGRESS' } as any;
  }catch(e){}

  // Per-run cycle id for correlation (one-per-cycle)
  const cycleId = `cycle_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  const cycleStartMs = Date.now();
  // Local AuditStore wrapper that injects cycleId into every appended entry without mutating caller object
  const cycleAuditStore: import('./types').AuditStore = {
    append: async (entry: import('./types').AuditEntry) => {
      const payload = Object.assign({}, entry, { cycleId });
      return auditStore.append(payload as import('./types').AuditEntry);
    },
    list: auditStore.list.bind(auditStore),
  };

  // Local per-run daily start value (undefined for file-backed/default runtime)
  let cycleDailyStartValue: number | undefined = undefined;

  // Build simple deterministic demo decision set
  // Determine eligible instruments for this cycle using per-instrument session rules.
  const nowForCycle = new Date();
  // Determine eligible instruments for this cycle using module-scoped TRADABLE_INSTRUMENTS.
  const eligibleInstruments = Array.isArray(TRADABLE_INSTRUMENTS) ? TRADABLE_INSTRUMENTS.filter(i => {
    const enabled = (i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true);
    if (!enabled) return false;
    return isInstrumentTradableNow(i, nowForCycle);
  }) : [];

  // If nothing is eligible this cycle, skip early to avoid unnecessary work.
  if (!eligibleInstruments || eligibleInstruments.length === 0){
    const now = nowIso();
    runtime.latestDecision = { id: `skip_${now}`, action: 'HOLD', reason: 'NO_ELIGIBLE_INSTRUMENTS' } as any;
    runtime.latestCycle = { processedCandidates: 0, executed: 0, rejects: 0, skipped: true } as any;
    runtime.lastUpdated = now;
    return { skipped: true, code: 'NO_ELIGIBLE_INSTRUMENTS' } as any;
  }

  const symbols = eligibleInstruments.map(i => (i.providerSymbol || i.id).toUpperCase());
  const quotes = opts && opts.overrideUniverse && Array.isArray(opts.overrideUniverse.quotes) ? opts.overrideUniverse.quotes : await fetchQuotes();

  // --- RUNTIME QUOTES SNAPSHOT (transient diagnostic for cycle troubleshooting) ---
  try{
    const fetchedAt = new Date().toISOString();
    const quotesIsArray = Array.isArray(quotes);
    const maxCount = Array.isArray(TRADABLE_INSTRUMENTS) ? TRADABLE_INSTRUMENTS.length : 0;
    const limited: any[] = [];
    if (Array.isArray(quotes)){
      for (let i = 0; i < Math.min(quotes.length, maxCount); i++){
        const q = quotes[i] || {};
        limited.push({
          symbol: q.symbol ?? null,
          instrumentId: q.instrumentId ?? null,
          providerSymbol: q.providerSymbol ?? null,
          price: (typeof q.price === 'number' ? q.price : (typeof q.priceSek === 'number' ? q.priceSek : null)),
          timestamp: q.marketTimestamp ?? q.timestamp ?? null,
          isStale: (typeof q.isStale === 'boolean') ? q.isStale : !!q.isStale
        });
      }
    }

    // NVDA probe: attempt to find NVDA within the limited set and report which key matched
    const nvdaTarget = 'NVDA';
    let nvdaProbe: any = { found: false, matchedBy: 'none', symbol: null, instrumentId: 'nvidia', providerSymbol: 'NVDA', price: null, timestamp: null, quoteAgeSeconds: null, isStale: null };
    for (const q of limited){
      try{
        const sym = q.symbol ? String(q.symbol).toUpperCase() : null;
        const iid = q.instrumentId ? String(q.instrumentId).toUpperCase() : null;
        const pSym = q.providerSymbol ? String(q.providerSymbol).toUpperCase() : null;
        if (sym === nvdaTarget){ nvdaProbe = { found: true, matchedBy: 'symbol', symbol: q.symbol, instrumentId: q.instrumentId, providerSymbol: q.providerSymbol, price: q.price, timestamp: q.timestamp, quoteAgeSeconds: q.timestamp ? Math.round((Date.now() - Date.parse(String(q.timestamp))) / 1000) : null, isStale: q.isStale }; break; }
        if (iid === nvdaTarget){ nvdaProbe = { found: true, matchedBy: 'instrumentId', symbol: q.symbol, instrumentId: q.instrumentId, providerSymbol: q.providerSymbol, price: q.price, timestamp: q.timestamp, quoteAgeSeconds: q.timestamp ? Math.round((Date.now() - Date.parse(String(q.timestamp))) / 1000) : null, isStale: q.isStale }; break; }
        if (pSym === nvdaTarget){ nvdaProbe = { found: true, matchedBy: 'providerSymbol', symbol: q.symbol, instrumentId: q.instrumentId, providerSymbol: q.providerSymbol, price: q.price, timestamp: q.timestamp, quoteAgeSeconds: q.timestamp ? Math.round((Date.now() - Date.parse(String(q.timestamp))) / 1000) : null, isStale: q.isStale }; break; }
      }catch(e){ /* ignore per-quote probe errors */ }
    }

    const snap = { kind: 'RUNTIME_QUOTES_SNAPSHOT', cycleId, fetchedAt, quotesIsArray, quoteCount: limited.length, quotes: limited, nvda: nvdaProbe };
    try{
      await cycleAuditStore.append({ kind: 'RECEIVED', id: `runtime_snapshot_${Date.now()}`, timestamp: fetchedAt, snapshot: snap, meta: { automatic: true } } as any);
    }catch(e){ /* swallow */ }
  }catch(e){ /* do not impact runtime when diagnostics fail */ }
  // Per-cycle diagnostics collected for each evaluated symbol
  const diagnosticsBySymbol = new Map<string, any>();
  function ensureDiag(sym: string){
    const s = String(sym || '').toUpperCase();
    if (!diagnosticsBySymbol.has(s)) diagnosticsBySymbol.set(s, { symbol: s, quoteFound: false, quoteAgeSeconds: null, marketOpen: null, signal: null, confidence: null, decision: null, rejectionReason: null, eligibleForExecution: false, executionAttempted: false, executed: false });
    return diagnosticsBySymbol.get(s);
  }
  function getQuoteAgeSeconds(q:any){ try{ if (!q) return null; const ts = q.timestamp || q.time || q.t || q.ts || q.lastUpdated || q.updatedAt || null; if (!ts) return null; const d = new Date(ts); if (isNaN(d.getTime())) return null; return Math.round((Date.now() - d.getTime())/1000); }catch(_){ return null; } }
  // Plan actions: first evaluate existing holdings, then consider buy candidates
  const candidates: any[] = [];
  let evaluationCount = 0;
  const evaluatedSymbols = new Set<string>();
  // snapshot evaluation count before run so we can compute actual appended evaluations
  let _beforeEvalCount = 0;
  try{ const _beforeList = await auditStore.list(); _beforeEvalCount = Array.isArray(_beforeList) ? _beforeList.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION').length : 0; }catch(_){ _beforeEvalCount = 0; }
  const portfolio = opts && opts.overrideUniverse && opts.overrideUniverse.portfolio ? opts.overrideUniverse.portfolio : await portfolioAdapter.getPortfolio();

  // If using Supabase-backed portfolio store, ensure persistent daily start before creating trader
  try{
    const store = (process.env && process.env.PAPER_TRADER_PORTFOLIO_STORE) || '';
    if (store === 'supabase'){
      const rawId = (process.env && process.env.PAPER_TRADER_PORTFOLIO_ID) || '';
      const portfolioId = (typeof rawId === 'string' ? rawId.trim() : '') || 'demo';
      // ensureDailyStart may throw; per requirements let it bubble and abort cycle
      const dr = await ensureDailyStart({ portfolioId });
      // capture per-run daily start value for cycleTrader and recreate trader with explicit dailyStartValue
      cycleDailyStartValue = typeof dr.startValue === 'number' ? dr.startValue : undefined;
      trader = createPaperTrader({ portfolioAdapter, auditStore, config, dailyStartValue: cycleDailyStartValue });
      runtime.trader = trader;
    }
  }catch(e){
    throw e;
  }
  // Create a per-run trader that uses the cycleAuditStore for engine-produced audits.
  // This trader is local to the run, does not mutate runtime.trader or any global state,
  // and shares portfolioAdapter, config and any dailyStartValue with the existing trader.
  const injected = getInjectedCycleTrader();
  const cycleTrader = injected || createPaperTrader({
    portfolioAdapter,
    auditStore: cycleAuditStore,
    config,
    dailyStartValue: cycleDailyStartValue
  });
  // Fetch performance profile once per cycle. If an override is provided use it (tests),
  // otherwise call the regular `getPerformanceProfile`. If it fails, continue without reflection.
  let profile: any = null;
  try{
    if (opts && typeof opts.getPerformanceProfileOverride === 'function'){
      profile = await opts.getPerformanceProfileOverride();
    } else {
      profile = await getPerformanceProfile();
    }
  }catch(_){ profile = null; }
  const perCycleReflection = profile && profile.reflection ? profile.reflection : undefined;
  // Build an initial per-cycle AdaptiveDecisionContext (victorReview unknown at start)
  let adaptiveDecisionContext: any = buildAdaptiveDecisionContext(profile, null);
  const plannedSymbols = new Set<string>();
  // Per-cycle in-memory promise-map to dedupe historical calls within a single cycle.
  // Store Promises (not resolved data) so concurrent requests for the same symbol
  // share the same provider call. This map ONLY lives for the duration of the
  // cycle and is not a long-lived cache. The provider's own cache remains the
  // only long-lived cache.
  const historicalRequestsBySymbol = new Map<string, Promise<any>>();
  const analysisResultsBySymbol = new Map<string, Promise<any>>();

  // Helper: fetch historical closes once per symbol (promise dedupe) and run analyzePriceSeries once.
  async function fetchAndAnalyze(symbol: string){
    const sym = String(symbol).toUpperCase();
    if (!analysisResultsBySymbol.has(sym)){
      const p = (async ()=>{
        try{
          if (!historicalRequestsBySymbol.has(sym)){
            const provider = new TwelveDataMarketDataProvider();
            const histP = provider.getHistoricalDailyCloses(sym, 30);
            historicalRequestsBySymbol.set(sym, histP);
          }
          const hist = await historicalRequestsBySymbol.get(sym);
          const techMeta: any = { technicalAnalysisMode: 'observe-only' };
          if (hist && Array.isArray(hist.closes)){
            const analysis = analyzePriceSeries ? analyzePriceSeries(hist.closes) : null;
            techMeta.technicalAnalysisStatus = analysis ? 'success' : 'unavailable';
            techMeta.technicalTrend = analysis ? analysis.trend : null;
            techMeta.technicalMomentumPercent = analysis ? analysis.momentumPercent : null;
            techMeta.technicalVolatilityPercent = analysis ? analysis.volatilityPercent : null;
            techMeta.technicalScore = analysis ? analysis.technicalScore : null;
            techMeta.technicalSignal = analysis ? analysis.signal : null;
            techMeta.technicalReasons = analysis ? analysis.reasons : null;
            techMeta.historicalDataPoints = hist.closes.length;
            techMeta.historicalFirstDate = Array.isArray(hist.dates) && hist.dates.length ? hist.dates[0] : null;
            techMeta.historicalLastDate = Array.isArray(hist.dates) && hist.dates.length ? hist.dates[hist.dates.length-1] : null;
            techMeta.historicalSource = hist.source || null;
          } else {
            techMeta.technicalAnalysisStatus = 'unavailable';
            techMeta.technicalAnalysisErrorCode = 'INSUFFICIENT_HISTORY';
            techMeta.technicalAnalysisErrorMessage = 'No historical closes available';
          }
          return techMeta;
        }catch(e:any){
          const techMeta: any = { technicalAnalysisMode: 'observe-only' };
          techMeta.technicalAnalysisStatus = 'unavailable';
          techMeta.technicalAnalysisErrorCode = e && e.code ? e.code : 'PROVIDER_ERROR';
          techMeta.technicalAnalysisErrorMessage = e && e.message ? e.message : String(e);
          return techMeta;
        }
      })();
      analysisResultsBySymbol.set(sym, p);
    }
    return analysisResultsBySymbol.get(sym) as Promise<any>;
  }

  // Helper to build meta object for appendEvaluation that may include fundamentalAnalysis
  const getMetaForSymbol = (symbol: string, techMeta: any) => {
    const meta: any = { automatic: true, technicalAnalysis: techMeta };
    try{
      if (opts && opts.overrideUniverse && opts.overrideUniverse.fundamentals && opts.overrideUniverse.fundamentals[symbol]){
        meta.fundamentalAnalysis = opts.overrideUniverse.fundamentals[symbol];
      }
    }catch(_){ }
    return meta;
  };

  // use module-scope helpers exported for tests

  // Evaluate existing holdings first
  if (Array.isArray(portfolio.holdings)){
    for (const h of portfolio.holdings){
      const symbol = (h.symbol||'').toUpperCase();
      const q = quotes && Array.isArray(quotes) ? quotes.find((x:any)=> {
        try{
          const sym = (x && x.symbol) ? String(x.symbol).toUpperCase() : null;
          const iid = (x && x.instrumentId) ? String(x.instrumentId).toUpperCase() : null;
          const pSym = (x && x.providerSymbol) ? String(x.providerSymbol).toUpperCase() : null;
          return (sym && sym === symbol) || (iid && iid === symbol) || (pSym && pSym === symbol);
        }catch(e){ return false; }
      }) : null;
      const evalRes = evaluateHoldingActionPublic(h,q);
      // diagnostics for this holding
      try{
        const d = ensureDiag(symbol);
        d.quoteFound = !!q;
        d.quoteAgeSeconds = getQuoteAgeSeconds(q);
        try{ d.marketOpen = !!(getNextNYOpenInstant(new Date()).open); }catch(_){ d.marketOpen = null; }
        d.signal = evalRes && evalRes.action ? evalRes.action : null;
        d.confidence = 0;
      }catch(_){ }
      // count this symbol as evaluated once per cycle (holdings always count)
      if (!evaluatedSymbols.has(symbol)){
        evaluatedSymbols.add(symbol);
        evaluationCount++;
      }
      // Attach centralized technical analysis (observe-only) using historical daily closes
      let _techMeta_for_holding: any = null;
      try{
        _techMeta_for_holding = await fetchAndAnalyze(symbol);
        try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${symbol}_${Date.now()}`, symbol, action: evalRes.action, confidence: 0, referencePrice: q && (q.priceSek||q.price) || h.currentPrice, generatedAt: nowIso() }, reason: { action: evalRes.action, reason: evalRes.reason, score: evalRes.score }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(symbol, _techMeta_for_holding) } as any, cycleAuditStore); }catch(e){}
      }catch(_){
        try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${symbol}_${Date.now()}`, symbol, action: evalRes.action, confidence: 0, referencePrice: q && (q.priceSek||q.price) || h.currentPrice, generatedAt: nowIso() }, reason: { action: evalRes.action, reason: evalRes.reason, score: evalRes.score }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(symbol, { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: 'PROVIDER_ERROR', technicalAnalysisErrorMessage: 'Fetch failed' }) } as any, cycleAuditStore); }catch(_){ }
      }
      if (evalRes.action === 'SELL'){
          plannedSymbols.add(symbol);
          // Ask Decision Engine for final decision (include per-cycle reflection)
          try{
            // If we have technical meta, try to compute an expected return estimate and forward it to the decision engine
            let expectedReturnForDecision: number | undefined = undefined;
            try{
              if (_techMeta_for_holding && _techMeta_for_holding.technicalMomentumPercent !== undefined){
                const techEngine = { status: _techMeta_for_holding.technicalAnalysisStatus || null, score: typeof _techMeta_for_holding.technicalScore === 'number' ? _techMeta_for_holding.technicalScore : undefined, signal: _techMeta_for_holding.technicalSignal || undefined, reasons: Array.isArray(_techMeta_for_holding.technicalReasons) ? _techMeta_for_holding.technicalReasons : undefined } as any;
                const fundEngine = (opts && opts.overrideUniverse && opts.overrideUniverse.fundamentals && opts.overrideUniverse.fundamentals[symbol]) ? opts.overrideUniverse.fundamentals[symbol] : null;
                const combined = combineAnalyses({ technical: techEngine, fundamental: fundEngine });
                const estimate = estimateExpectedReturn({ momentumPercent: _techMeta_for_holding.technicalMomentumPercent, confidence: combined && typeof combined.confidence === 'number' ? combined.confidence : NaN });
                if (estimate && typeof estimate.expectedReturnPercent === 'number' && Number.isFinite(estimate.expectedReturnPercent)) expectedReturnForDecision = estimate.expectedReturnPercent;
              }
            }catch(_){ /* ignore estimate failures and proceed without expectedReturnPercent for SELL */ }

            const decInput = { portfolio: { availableCash: portfolio.availableCash, totalValue: portfolio.totalValue, holdings: portfolio.holdings }, decision: { side: 'SELL', symbol, quantity: h.quantity, referencePrice: q && (q.priceSek||q.price) || h.currentPrice }, todaysTradeCount: 0, performanceReflection: perCycleReflection, expectedReturnPercent: expectedReturnForDecision, tradeFeedbackSummary: await computeTradeFeedbackSummary(auditStore), adaptiveDecisionContext } as any;
            const decRes = DecisionEngine.evaluateDecision(decInput);
            const cand = { id: `sell_${symbol}_${Date.now()}`, symbol, action: 'SELL', confidence: decRes.confidence, referencePrice: q && (q.priceSek||q.price) || h.currentPrice, generatedAt: nowIso(), requestedNotionalSek: Math.round((h.quantity || 0) * (q && (q.priceSek||q.price) || h.currentPrice) || 0), tradeFeedbackEffect: (decRes as any).tradeFeedbackEffect, signalFeedbackEffect: (decRes as any).signalFeedbackEffect } as any;
            // attach risk and reflection for auditability (reuse same reflection object)
            if (typeof expectedReturnForDecision === 'number') (cand as any).expectedReturnPercent = expectedReturnForDecision;
            cand.risk = decRes.risk;
            if (perCycleReflection) cand.performanceReflection = perCycleReflection;
            // Build market regime observation (observation-only, deterministic)
            try{
              const tech = _techMeta_for_holding || {} as any;
              const trendStrength = (typeof tech.technicalTrend === 'string') ? (tech.technicalTrend === 'UP' ? 0.8 : (tech.technicalTrend === 'DOWN' ? -0.8 : undefined)) : (typeof tech.technicalScore === 'number' ? Math.max(-1, Math.min(1, tech.technicalScore / 100)) : undefined);
              const momentum = typeof tech.technicalMomentumPercent === 'number' ? tech.technicalMomentumPercent : undefined;
              const volatility = typeof tech.technicalVolatilityPercent === 'number' ? (tech.technicalVolatilityPercent / 100) : undefined;
              const priceVsMovingAverage = typeof tech.priceVsMovingAverage === 'number' ? tech.priceVsMovingAverage : undefined;
              const volumeStrength = typeof tech.volumeStrength === 'number' ? tech.volumeStrength : undefined;
              try{ (cand as any).marketRegime = classifyMarketRegime({ trendStrength, momentum, volatility, priceVsMovingAverage, volumeStrength }); }catch(_){ /* classification must not fail cycle */ }
            }catch(_){ }
            candidates.push(cand);
            try{ const d2 = ensureDiag(symbol); d2.decision = cand.action; d2.signal = d2.signal || 'SELL'; d2.confidence = typeof cand.confidence === 'number' ? cand.confidence : d2.confidence; }catch(_){ }
          }catch(e:any){
            // On decision engine error: append a REJECT audit and skip this candidate
            try{
              await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_dec_${symbol}_${Date.now()}`, symbol, action: 'SELL' }, reason: { code: 'DECISION_ENGINE_ERROR', message: String(e && e.message ? e.message : e) }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any);
            }catch(_){ }
            continue;
          }
      }
    }
  }

  // Now consider buy candidates from symbols list, skip those already planned for sell
  if (quotes && Array.isArray(quotes)){
    for (const s of symbols){
      if (plannedSymbols.has(s)) continue;
      const q = quotes.find((x:any)=>{
        try{
          const sym = (x && x.symbol) ? String(x.symbol).toUpperCase() : null;
          const iid = (x && x.instrumentId) ? String(x.instrumentId).toUpperCase() : null;
          const pSym = (x && x.providerSymbol) ? String(x.providerSymbol).toUpperCase() : null;
          return (sym && sym === s) || (iid && iid === s) || (pSym && pSym === s);
        }catch(e){ return false; }
      });
      if (!q){
        // record per-symbol quote missing as a REJECT but do not count as evaluation
        try{ await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_${s}_${Date.now()}`, symbol: s, action: 'UNKNOWN' }, reason: { code: 'QUOTE_MISSING', message: 'Quote missing for symbol' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
        try{ const dqm = ensureDiag(s); dqm.quoteFound = false; dqm.rejectionReason = 'QUOTE_MISSING'; }catch(_){ }
        continue;
      }
      const currency = q.currency || null;
      let sekPrice = (typeof q.priceSek === 'number' && Number.isFinite(q.priceSek) && q.priceSek > 0) ? q.priceSek : null;
      const rawPrice = (typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0) ? q.price : null;
      if (currency && currency.toUpperCase() === 'USD' && sekPrice === null){
        // Attempt deterministic conversion using provider
        try{
          const md = await import('../market-data');
          const provider = md && typeof md.getMarketDataProvider === 'function' ? md.getMarketDataProvider() : (md && md.default) || null;
          if (provider && typeof (provider as any).getFxRate === 'function'){
            const rawFx = await (provider as any).getFxRate('USD','SEK');
            let rate: number | null = null;
            if (rawFx === null || rawFx === undefined) rate = null;
            else if (typeof rawFx === 'number') rate = Number(rawFx);
            else if (rawFx && typeof rawFx === 'object' && rawFx.rate) rate = Number(rawFx.rate);
            if (rate && Number.isFinite(rate) && rate > 0 && rawPrice && Number.isFinite(Number(rawPrice))){
              sekPrice = Number(rawPrice) * Number(rate);
            }
          }
        }catch(e){ /* ignore */ }
      }
      const usePrice = sekPrice !== null ? sekPrice : rawPrice;
      if (!usePrice || usePrice <= 0){
        try{ await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_${s}_${Date.now()}`, symbol: s, action: 'UNKNOWN' }, reason: { code: 'QUOTE_INVALID', message: 'Invalid price from quote' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
        continue;
      }

      // Determine buy signal: only buy on dip vs last evaluation for this symbol (prevents random buys)
      // Find last evaluation audit for symbol
      const allAudits = await auditStore.list();
      const lastEval = allAudits.find((a:any)=> a && a.summary && a.summary.decisionId && String(a.summary.decisionId).toLowerCase().includes(String(s).toLowerCase())) || null;
      let buySignal = false; let signalReason = 'No prior evaluation';
      if (lastEval && lastEval.raw && lastEval.raw.decision && typeof lastEval.raw.decision.referencePrice === 'number'){
        const lastRef = Number(lastEval.raw.decision.referencePrice);
        if (usePrice <= lastRef * 0.99){ buySignal = true; signalReason = 'Price dipped 1% vs last reference'; }
      }

      if (buySignal){
        // perform observe-only technical analysis before adding candidate (do not alter buy decision)
        let _techMeta_for_buy: any = null;
        try{
            try{
              _techMeta_for_buy = await fetchAndAnalyze(s);
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Buy candidate observed', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(s, _techMeta_for_buy) } as any, cycleAuditStore); }catch(e){}
            }catch(e:any){
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Buy candidate observed', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(s, { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) }) } as any, cycleAuditStore); }catch(_){ }
            }
        }catch(e:any){
          // on history error, log unavailable status but continue
          try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Buy candidate observed', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) } } as any, cycleAuditStore); }catch(_){ }
        }
        try{
          // Compute expected return estimate from technical meta + combined analysis
          let estimateForBuy: any = null;
          try{
            if (_techMeta_for_buy && _techMeta_for_buy.technicalMomentumPercent !== undefined){
              const techEngine = { status: _techMeta_for_buy.technicalAnalysisStatus || null, score: typeof _techMeta_for_buy.technicalScore === 'number' ? _techMeta_for_buy.technicalScore : undefined, signal: _techMeta_for_buy.technicalSignal || undefined, reasons: Array.isArray(_techMeta_for_buy.technicalReasons) ? _techMeta_for_buy.technicalReasons : undefined } as any;
              const fundEngine = (opts && opts.overrideUniverse && opts.overrideUniverse.fundamentals && opts.overrideUniverse.fundamentals[s]) ? opts.overrideUniverse.fundamentals[s] : null;
              const combined = combineAnalyses({ technical: techEngine, fundamental: fundEngine });
              estimateForBuy = estimateExpectedReturn({ momentumPercent: _techMeta_for_buy.technicalMomentumPercent, confidence: combined && typeof combined.confidence === 'number' ? combined.confidence : NaN });
            }
          }catch(_){ estimateForBuy = null; }

          // If estimate is null, do not create BUY candidate or call decision engine for BUY
          if (!estimateForBuy){
            try{ await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_est_${s}_${Date.now()}`, symbol: s, action: 'BUY' }, reason: { code: 'EXPECTED_RETURN_MISSING', message: 'Expected return estimate unavailable' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
            continue;
          }

          const decInput = { portfolio: { availableCash: portfolio.availableCash, totalValue: portfolio.totalValue, holdings: portfolio.holdings }, decision: { side: 'BUY', symbol: s, requestedNotionalSek: 8000, referencePrice: usePrice }, todaysTradeCount: 0, performanceReflection: perCycleReflection, expectedReturnPercent: estimateForBuy.expectedReturnPercent, tradeFeedbackSummary: await computeTradeFeedbackSummary(auditStore), adaptiveDecisionContext } as any;
          const decRes = DecisionEngine.evaluateDecision(decInput);
          const cand = { id: `buy_${s}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, symbol: s, action: 'BUY', confidence: decRes.confidence, referencePrice: usePrice, generatedAt: nowIso(), reasoning: ['Buy-on-dip'], requestedNotionalSek: 8000, tradeFeedbackEffect: (decRes as any).tradeFeedbackEffect, signalFeedbackEffect: (decRes as any).signalFeedbackEffect } as any;
          // persist estimate on candidate for auditability
          if (estimateForBuy && typeof estimateForBuy.expectedReturnPercent === 'number') (cand as any).expectedReturnPercent = estimateForBuy.expectedReturnPercent;
          cand.risk = decRes.risk;
          if (perCycleReflection) cand.performanceReflection = perCycleReflection;
          // Attach market regime classification as observation-only metadata
          try{
            const tech = _techMeta_for_buy || {} as any;
            const trendStrength = (typeof tech.technicalTrend === 'string') ? (tech.technicalTrend === 'UP' ? 0.8 : (tech.technicalTrend === 'DOWN' ? -0.8 : undefined)) : (typeof tech.technicalScore === 'number' ? Math.max(-1, Math.min(1, tech.technicalScore / 100)) : undefined);
            const momentum = typeof tech.technicalMomentumPercent === 'number' ? tech.technicalMomentumPercent : undefined;
            const volatility = typeof tech.technicalVolatilityPercent === 'number' ? (tech.technicalVolatilityPercent / 100) : undefined;
            const priceVsMovingAverage = typeof tech.priceVsMovingAverage === 'number' ? tech.priceVsMovingAverage : undefined;
            const volumeStrength = typeof tech.volumeStrength === 'number' ? tech.volumeStrength : undefined;
            try{ (cand as any).marketRegime = classifyMarketRegime({ trendStrength, momentum, volatility, priceVsMovingAverage, volumeStrength }); }catch(_){ }
          }catch(_){ }
          candidates.push(cand);
          try{ const d4 = ensureDiag(s); d4.decision = 'BUY'; d4.signal = d4.signal || 'BUY_CANDIDATE'; d4.confidence = typeof cand.confidence === 'number' ? cand.confidence : d4.confidence; d4.quoteFound = !!q; d4.quoteAgeSeconds = getQuoteAgeSeconds(q); }catch(_){ }
        }catch(e:any){
          // On decision engine error: append a REJECT audit and skip this candidate
          try{
            await cycleAuditStore.append({ kind: 'REJECT', decision: { id: `rej_dec_${s}_${Date.now()}`, symbol: s, action: 'BUY' }, reason: { code: 'DECISION_ENGINE_ERROR', message: String(e && e.message ? e.message : e) }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any);
          }catch(_){ }
          continue;
        }
      } else {
        if (!evaluatedSymbols.has(s)){
          evaluatedSymbols.add(s);
          evaluationCount++;
          // Observation-only path for symbols without buy signal: run technical analysis
          // and persist an EVALUATION audit so scheduler tests see the evaluation, but
          // opt-out of running the shadow outcome evaluator here (compute later via aggregator if needed).
          try{
            let _techMeta_for_buy_fallback: any = null;
            try{
              _techMeta_for_buy_fallback = await fetchAndAnalyze(s);
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Observed (no buy signal)', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(s, _techMeta_for_buy_fallback) } as any, cycleAuditStore, { evaluateShadowOutcome: false }); }catch(_){ }
            }catch(e:any){
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Observed (no buy signal)', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(s, { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) }) } as any, cycleAuditStore, { evaluateShadowOutcome: false }); }catch(_){ }
            }
          }catch(_){ /* tolerate any analysis errors */ }
        }
      }
    }
  }

  // If no candidates, produce HOLD
  if (!candidates.length){
    const now = nowIso();
    const hold = { id: `demo_hold_${now}`, symbol: 'NVDA', action: 'HOLD', confidence: 0, referencePrice: 0, generatedAt: now, reasoning: ['Saknar marknadsdata'] };
    runtime.latestDecision = hold as any;
    // Skip calling cycleTrader.handleDecision to avoid creating EVALUATIONs in zero-candidates flow
    // NOTE: `processedCandidates` = number of actionable BUY/SELL candidates processed
    runtime.latestCycle = { processedCandidates: 0, executed: 0, rejects: 1 } as any;
    runtime.lastUpdated = nowIso();
    const _rawList = await auditStore.list();
    const allAudits = Array.isArray(_rawList) ? _rawList : [];
    // Build adaptive context even when early-returning due to no candidates
    try{
      try{
        const cycleEntries3 = (allAudits || []).filter((a:any)=>{ try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; } });
        const tradeFeedbacks2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'TRADE_FEEDBACK') ? (a.raw.feedback || a.feedback || a.raw) : null).filter(Boolean);
        const outcomeEvaluations2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
        const learningSignals2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'LEARNING_SIGNAL') ? (a.raw.signal || a.signal || a.raw) : null).filter(Boolean);
        const decisionSummary = runtime && (runtime as any).latestCycle && (runtime as any).latestCycle.decisionSummary ? (runtime as any).latestCycle.decisionSummary : null;
        const victorReview2 = buildVictorReview(decisionSummary, tradeFeedbacks2, outcomeEvaluations2, learningSignals2, profile);
        const adaptiveContext2 = buildAdaptiveDecisionContext(profile, victorReview2);
        // set local per-cycle adaptiveDecisionContext for consistency
        adaptiveDecisionContext = adaptiveContext2;
        try{ await cycleAuditStore.append({ kind: 'ADAPTIVE_DECISION_CONTEXT', id: `adaptive_context_${cycleId}`, timestamp: nowIso(), context: adaptiveContext2, meta: { automatic: true } } as any); }catch(_){ }
        try{ runtime.latestCycle = { ...runtime.latestCycle, adaptiveDecisionContext: adaptiveContext2, victorReview: victorReview2 }; }catch(_){ }
        try{
          const snapshot3 = buildCycleIntelligenceSnapshot(decisionSummary, victorReview2, adaptiveContext2);
          try{ await cycleAuditStore.append({ kind: 'CYCLE_INTELLIGENCE_SNAPSHOT', id: `cycle_intel_${cycleId}`, timestamp: nowIso(), snapshot: snapshot3, meta: { automatic: true } } as any); }catch(_){ }
          try{ runtime.latestCycle = { ...runtime.latestCycle, cycleIntelligenceSnapshot: snapshot3 }; }catch(_){ }
        }catch(_){ }
      }catch(_){ }
    }catch(_){ }
    // Minimal: build and append DECISION_SUMMARY even when there are no candidates
    try{
    const all = allAudits;
    const cycleEntries = (all || []).filter((a)=>{ try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; } });
      const executedTrades = [];
      let rejectedTradesCount = 0;
      for (const e of cycleEntries){ const raw = e && e.raw ? e.raw : e; if (!raw) continue; if (raw.kind === 'EXECUTION' && raw.execution) executedTrades.push(raw.execution); if (raw.kind === 'REJECT') rejectedTradesCount++; }

      // reuse existing aggregator to compute shadowPerformanceSummary from stored EVALUATION audits
      let shadowPerformanceSummaryLocal = null;
      try{
        const outcomeEvaluationsLocal = (allAudits || []).filter((a)=>{ const raw = a && a.raw ? a.raw : a; try{ return raw && raw.kind === 'EVALUATION' && raw.cycleId !== cycleId; }catch(_){ return false; } }).map((a)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
        try{ shadowPerformanceSummaryLocal = aggregateShadowDecisionPerformance({ evaluations: outcomeEvaluationsLocal }); }catch(_){ shadowPerformanceSummaryLocal = null; }
      }catch(_){ shadowPerformanceSummaryLocal = null; }

      const diags = Array.from(diagnosticsBySymbol.values());
      const analyzedSymbols = diags.map((d)=> d && d.symbol).filter(Boolean);
      const eligibleSymbols = Array.isArray(eligibleInstruments) ? eligibleInstruments.map((i)=> (i.providerSymbol||i.id).toUpperCase()) : symbols || [];
      const skippedSymbols = diags.filter((d)=> d.rejectionReason === 'QUOTE_MISSING' || d.quoteFound === false).map((d)=> d.symbol).filter(Boolean);

      const summary = { cycleId, timestamp: nowIso(), analyzedSymbols, eligibleSymbols, skippedSymbols, decisions: [], executedTrades, rejectedTradesCount, confidenceAverage: null, topReason: null, riskBlocks: null, overallConclusion: 'NO_ACTION', marketSession: null, cycleDurationMs: Date.now() - cycleStartMs, skippedReasonsBySymbol: null, confidenceDistribution: null, strongestBullishReason: null, strongestBearishReason: null, cashBefore: null, cashAfter: null, portfolioValueBefore: null, portfolioValueAfter: null, decisionReasons: [], marketRegimeDistribution: null, dominantMarketRegime: null, shadowDecisionSummary: null, shadowPerformanceSummary: shadowPerformanceSummaryLocal };
      try{ await cycleAuditStore.append({ kind: 'DECISION_SUMMARY', id: `decision_summary_${cycleId}`, timestamp: nowIso(), summary, meta: { automatic: true } } as import('./types').AuditEntry); }catch(_){ }
      try{ runtime.latestCycle = { ...runtime.latestCycle, decisionSummary: summary }; }catch(_){ }
    }catch(_){ }
    return { ...runtime.latestCycle, evaluationCount };
  }

  // Try candidates sequentially. If a BUY is rejected with POSITION_LIMIT, mark and continue.
  let processed = 0; let executed = 0; let rejects = 0; let finalDecision: any = null;
  let executedBuy = 0; let executedSell = 0;
  for (const cand of candidates){
    processed++;
    runtime.latestDecision = cand;
    // mark this symbol as evaluated once per cycle (if not already counted)
    const sSym = (cand && cand.symbol || '').toUpperCase();
    if (!evaluatedSymbols.has(sSym)){
      evaluatedSymbols.add(sSym);
      evaluationCount++;
    }

    // Append an EVALUATION audit that represents the strategy decision (observe-only)
    try{
        try{
              const techMetaForCand = await fetchAndAnalyze(sSym);
              await appendEvaluation({ kind: 'EVALUATION', decision: cand, evaluation: { tradeFeedbackEffect: (cand as any).tradeFeedbackEffect, signalFeedbackEffect: (cand as any).signalFeedbackEffect }, reason: { action: cand.action, reason: 'Strategy decision' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(sSym, techMetaForCand) } as any, cycleAuditStore);
      }catch(e:any){
        await appendEvaluation({ kind: 'EVALUATION', decision: cand, evaluation: { tradeFeedbackEffect: (cand as any).tradeFeedbackEffect, signalFeedbackEffect: (cand as any).signalFeedbackEffect }, reason: { action: cand.action, reason: 'Strategy decision' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: getMetaForSymbol(sSym, { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) }) } as any, cycleAuditStore);
      }
    }catch(_){ }

    // decide whether to attempt execution based on per-cycle limits
    const side = (cand.action || '').toUpperCase();
    const allowExec = (side === 'BUY' && executedBuy < 1) || (side === 'SELL' && executedSell < 1) || (side !== 'BUY' && side !== 'SELL');

    // record eligibility in diagnostics
    try{ const dd = ensureDiag(sSym); dd.decision = cand.action; dd.confidence = typeof cand.confidence === 'number' ? cand.confidence : dd.confidence; dd.eligibleForExecution = !!allowExec; }catch(_){ }

    if (!allowExec){
      // append a REJECT audit indicating cycle-level execution limit
      try{
        await cycleAuditStore.append({ kind: 'REJECT', decision: cand, reason: { code: 'CYCLE_LIMIT', message: 'Per-cycle execution limit reached' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any);
      }catch(_){ }
      try{ const dd = ensureDiag(sSym); if (!dd.rejectionReason) dd.rejectionReason = 'CYCLE_LIMIT'; }catch(_){ }
      rejects++;
      // continue to next candidate (do not break)
      continue;
    }

    // Capture portfolio snapshot before attempting execution so we can compute cost-basis
    const beforeExecutionPortfolio = await portfolioAdapter.getPortfolio();
    // Apply adaptive confidence policy using the per-cycle adaptiveDecisionContext
    try{
      const adaptiveCtx = adaptiveDecisionContext || null;
      const origConf = typeof cand.confidence === 'number' ? cand.confidence : 0;
      try{ (cand as any).originalConfidence = origConf; }catch(_){ }
      try{ (cand as any).confidence = applyAdaptiveConfidencePolicy(origConf, adaptiveCtx); }catch(_){ }
    }catch(_){ }
    const res = await cycleTrader.handleDecision(cand as any);
    try{ const dd = ensureDiag(sSym); dd.executionAttempted = true; }catch(_){ }
    if (res && res.accepted){
      try{ const dd = ensureDiag(sSym); dd.executed = true; dd.rejectionReason = null; }catch(_){ }
      // attempt to compute trade evaluation for SELLs that fully close a position
      try{
        const exec: SimulatedExecution | null = (res.execution || res.transaction) || null;
        if (exec && String((exec as any).side || cand.action).toUpperCase() === 'SELL'){
          // fetch portfolio after execution to detect closure
          const afterExecutionPortfolio = await portfolioAdapter.getPortfolio();
          const sym = String(cand.symbol || '').toUpperCase();
          const stillHolding = Array.isArray(afterExecutionPortfolio.holdings) && afterExecutionPortfolio.holdings.find((h:any)=> String(h.symbol||'').toUpperCase() === sym);
          if (!stillHolding){
            // position closed: compute cost-basis from beforeExecutionPortfolio
            const beforeHolding = Array.isArray(beforeExecutionPortfolio.holdings) ? beforeExecutionPortfolio.holdings.find((h:any)=> String(h.symbol||'').toUpperCase() === sym) : null;
            const entryPrice = beforeHolding && typeof beforeHolding.averagePrice === 'number' ? Number(beforeHolding.averagePrice) : null;
            const exitPrice = typeof (exec as any).executedPrice === 'number' ? Number((exec as any).executedPrice) : null;
            const qty = typeof (exec as any).quantity === 'number' ? Number((exec as any).quantity) : null;
            if (entryPrice !== null && exitPrice !== null && qty !== null){
              // Prefer an existing evaluation object on the execution if it looks valid; otherwise compute a fallback
              let evaluation: any = null;
              try{
                const existing = (exec as any).evaluation;
                if (existing && typeof existing.pnlSek === 'number' && typeof existing.pnlPercent === 'number' && (existing.winner === true || existing.winner === false)){
                  evaluation = existing;
                }
              }catch(_){ /* ignore */ }
              if (!evaluation){
                evaluation = evaluateTrade({ entryPrice, exitPrice, quantity: qty, totalFees: exec.fee ?? 0 });
                try{ (exec as any).evaluation = evaluation; }catch(_){ }
              }
              // Attempt to resolve a single-entry BUY for a safe TradeReview
              try{
                const audits = await auditStore.list();
                let portfolioId = '';
                if (beforeExecutionPortfolio && typeof beforeExecutionPortfolio === 'object' && beforeExecutionPortfolio !== null){
                  const asRec = beforeExecutionPortfolio as Record<string, unknown>;
                  const idVal = asRec['id'];
                  if (typeof idVal === 'string') portfolioId = idVal;
                }
                const entry = resolveSingleEntryForReview({ audits, portfolioId, symbol: sym, soldQuantity: qty });
                if (entry){
                  const exitTs = nowIso();
                  const holdingMinutes = Math.max(0, Math.floor((new Date(exitTs).getTime() - new Date(entry.entryTimestamp).getTime()) / 60000));
                  const review = buildTradeReview({
                    executionId: entry.executionId,
                    symbol: sym,
                    entryPrice: entry.entryPrice,
                    exitPrice: exitPrice,
                    quantity: qty,
                    totalFees: exec.fee ?? 0,
                    holdingMinutes,
                    confidenceAtEntry: entry.confidenceAtEntry,
                    createdAt: exitTs,
                  });
                  try{ if (evaluation && typeof evaluation === 'object') (evaluation as Record<string, unknown>).tradeReview = review; }catch(_){ }
                }
              }catch(_){ /* tolerate resolver failures silently */ }
              // find the appended EXECUTION audit in the FileAuditStore and mutate its raw.execution to include the same evaluation object (reuse reference)
              try{
                const entries = (auditStore as any).entries as any[] | undefined;
                if (Array.isArray(entries)){
                  for (let i = entries.length - 1; i >= 0; i--){
                    const it = entries[i];
                    if (it && it.raw && it.raw.kind === 'EXECUTION' && it.raw.execution && it.raw.execution.id === exec.id){
                      try{ (it.raw.execution as any).evaluation = evaluation; }catch(_){ }
                      break;
                    }
                  }
                }
              }catch(_){ }
              // append a dedicated EVALUATION audit that reuses the same evaluation object
              try{
                await cycleAuditStore.append({ kind: 'EVALUATION', decision: cand, execution: exec, evaluation, portfolioBefore: beforeExecutionPortfolio, portfolioAfter: afterExecutionPortfolio, timestamp: nowIso(), meta: { automatic: true } } as any);
              }catch(_){ }
            }
          }
        }
      }catch(_){ }
      // record executed side counts but continue processing other symbols
      if (cand.action === 'BUY') executedBuy++;
      if (cand.action === 'SELL') executedSell++;
      executed = executedBuy + executedSell > 0 ? executedBuy + executedSell : executed;
      finalDecision = cand;
      // continue to next candidate (do not break)
      continue;
    }
    // rejected by trader: record and continue
    try{ const dd = ensureDiag(sSym); const code = res && (res.code || res.message) ? String(res.code || res.message).toUpperCase() : 'REJECTED';
      // map to prioritized primary blocker
      const priority = ['QUOTE_MISSING','STALE_QUOTE','MARKET_CLOSED','LOW_CONFIDENCE','RISK_LIMIT','POSITION_LIMIT','DAILY_LOSS_LIMIT','BROKER_REJECT','EXECUTION_DISABLED','CYCLE_LIMIT'];
      let mapped = null;
      if (code) mapped = code.replace(/[^A-Z0-9_]/g,'_');
      if (mapped){
        // prefer known mapping
        for (const p of priority){ if (mapped.includes(p)) { dd.rejectionReason = p; break; } }
        if (!dd.rejectionReason) dd.rejectionReason = mapped;
      } else { if (!dd.rejectionReason) dd.rejectionReason = 'REJECTED'; }
    }catch(_){ }
    rejects++;
    continue;
  }

  // NOTE: `processedCandidates` = number of actionable BUY/SELL candidates processed
  runtime.latestCycle = { processedCandidates: processed, executed, rejects } as any;
  runtime.latestDecision = finalDecision || candidates[candidates.length-1];
  runtime.lastUpdated = nowIso();
  // Build and append diagnostics summary for this automatic cycle (best-effort)
  try{
    const diags = Array.from(diagnosticsBySymbol.values());
    const analyzed = diags.length || evaluationCount || 0;
    const eligible = diags.filter((d:any)=> d.eligibleForExecution).length;
    const executedCount = diags.filter((d:any)=> d.executed).length;
    const blockerCounts: Record<string, number> = {};
    for (const d of diags){ const b = d.rejectionReason || 'NONE'; blockerCounts[b] = (blockerCounts[b]||0) + 1; }
    const diagnosticsAudit = { kind: 'AUTOPILOT_DIAGNOSTICS', diagnostics: { analyzed, eligible, executed: executedCount, blockers: blockerCounts, perSymbol: diags }, timestamp: nowIso(), meta: { automatic: true } } as any;
    // Build a compact Decision Summary derived from cycle-local information.
    try{
      // Gather cycle-scoped audit entries to extract executions and rejects
      const allAudits = Array.isArray(await auditStore.list()) ? await auditStore.list() : [];
      const cycleEntries = (allAudits || []).filter((a:any)=>{
        try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; }
      });
      const executedTrades = [] as any[];
      let rejectedTradesCount = 0;
      const reasonCounts: Record<string, number> = {};
      for (const e of cycleEntries){ const raw = e && e.raw ? e.raw : e; if (!raw) continue; if (raw.kind === 'EXECUTION' && raw.execution){ executedTrades.push(raw.execution); } if (raw.kind === 'REJECT') { rejectedTradesCount++; const rc = raw.reason && raw.reason.code ? String(raw.reason.code) : (raw.reason && raw.reason.message ? String(raw.reason.message) : 'REJECT'); reasonCounts[rc] = (reasonCounts[rc]||0) + 1; } }

      // placeholder for tradeFeedbacks (populated after decisionReasons built)
      const tradeFeedbacks: any[] = [];
      // Pre-compute outcome evaluations for this cycle and aggregate shadow performance
      let shadowPerformanceSummaryLocal: any = null;
      try{
        const allAudits = Array.isArray(await auditStore.list()) ? await auditStore.list() : [];
        const outcomeEvaluationsLocal = (allAudits || []).map((a:any)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
        try{ const agg = (await import('./shadow-decision-performance-aggregator')).default({ evaluations: outcomeEvaluationsLocal }); shadowPerformanceSummaryLocal = agg; }catch(_){ shadowPerformanceSummaryLocal = null; }
      }catch(_){ shadowPerformanceSummaryLocal = null; }

      // Compute topReason
      let topReason: string | null = null;
      try{ const entries = Object.entries(reasonCounts).sort((a,b)=> b[1]-a[1]); if (entries.length) topReason = entries[0][0]; }catch(_){ topReason = null; }

      const analyzedSymbols = diags.map((d:any)=> d.symbol).filter(Boolean);
      const eligibleSymbols = Array.isArray(eligibleInstruments) ? eligibleInstruments.map((i:any)=> (i.providerSymbol||i.id).toUpperCase()) : symbols || [];
      const skippedSymbols = diags.filter((d:any)=> d.rejectionReason === 'QUOTE_MISSING' || d.quoteFound === false).map((d:any)=> d.symbol).filter(Boolean);
      // skippedReasonsBySymbol: aggregate per-symbol rejection reasons from diagnostics and rejects
      const skippedReasonsBySymbol: Record<string,string[]> = {};
      for (const d of diags){ try{ if (d && d.symbol && d.rejectionReason) { const s = String(d.symbol).toUpperCase(); skippedReasonsBySymbol[s] = skippedReasonsBySymbol[s] || []; skippedReasonsBySymbol[s].push(String(d.rejectionReason)); } }catch(_){ } }
      for (const e of cycleEntries){ try{ const raw = e && e.raw ? e.raw : e; if (raw && raw.kind === 'REJECT' && raw.decision && raw.decision.symbol){ const s = String(raw.decision.symbol).toUpperCase(); const rc = raw.reason && raw.reason.code ? String(raw.reason.code) : (raw.reason && raw.reason.message ? String(raw.reason.message) : 'REJECT'); skippedReasonsBySymbol[s] = skippedReasonsBySymbol[s] || []; skippedReasonsBySymbol[s].push(rc); } }catch(_){ } }
      const decisionsForSummary = Array.isArray(candidates) ? candidates.map((c:any)=> ({ id: c.id, symbol: c.symbol, action: c.action, confidence: typeof c.confidence === 'number' ? c.confidence : undefined, expectedReturnPercent: (c as any).expectedReturnPercent ?? null, risk: c.risk || null })) : [];
      const confidenceAverage = decisionsForSummary.length ? Math.round((decisionsForSummary.reduce((s:any,c:any)=> s + (typeof c.confidence === 'number' ? c.confidence : 0), 0) / decisionsForSummary.length) * 100) / 100 : null;
      // confidenceDistribution: simple buckets
      const confidenceDistribution: Record<string, number> = { '0-20':0,'21-40':0,'41-60':0,'61-80':0,'81-100':0 };
      for (const d of decisionsForSummary){ try{ const v = typeof d.confidence === 'number' ? d.confidence : 0; if (v <= 20) confidenceDistribution['0-20']++; else if (v <= 40) confidenceDistribution['21-40']++; else if (v <= 60) confidenceDistribution['41-60']++; else if (v <= 80) confidenceDistribution['61-80']++; else confidenceDistribution['81-100']++; }catch(_){ } }
      const riskBlocks: Record<string, number> = {};
      for (const c of decisionsForSummary){ try{ if (c.risk && c.risk.level){ const k = String(c.risk.level); riskBlocks[k] = (riskBlocks[k]||0) + 1; } }catch(_){ } }
      // strongest bullish/bearish reasons: pick top occurring reason keywords from evaluations/rejects
      const bullishCounts: Record<string, number> = {};
      const bearishCounts: Record<string, number> = {};
      for (const e of cycleEntries){ try{ const raw = e && e.raw ? e.raw : e; if (!raw) continue; const msg = raw.reason && raw.reason.message ? String(raw.reason.message) : (raw.reason && raw.reason.code ? String(raw.reason.code) : null); const summaryDecision = (raw.decision && raw.decision.action) ? String(raw.decision.action).toUpperCase() : null; if (msg){ const m = msg.toLowerCase(); if (m.includes('buy') || m.includes('dip') || m.includes('momentum') || m.includes('positive')) { bullishCounts[msg] = (bullishCounts[msg]||0) + 1; } if (m.includes('sell') || m.includes('stop-loss') || m.includes('negative') || m.includes('low_confidence') || m.includes('position_limit')) { bearishCounts[msg] = (bearishCounts[msg]||0) + 1; } if (summaryDecision === 'BUY') bullishCounts[msg] = (bullishCounts[msg]||0) + 1; if (summaryDecision === 'SELL') bearishCounts[msg] = (bearishCounts[msg]||0) + 1; } }catch(_){ } }
      let strongestBullishReason: string | null = null;
      try{ const be = Object.entries(bullishCounts).sort((a,b)=> b[1]-a[1]); if (be.length) strongestBullishReason = be[0][0]; }catch(_){ strongestBullishReason = null; }
      let strongestBearishReason: string | null = null;
      try{ const be = Object.entries(bearishCounts).sort((a,b)=> b[1]-a[1]); if (be.length) strongestBearishReason = be[0][0]; }catch(_){ strongestBearishReason = null; }
      const overallConclusion = (Array.isArray(executedTrades) && executedTrades.length>0) ? 'EXECUTED' : (rejectedTradesCount>0 ? 'REJECTED' : 'NO_ACTION');

      // marketSession from NY helper
      let marketSession: any = null;
      try{ const ny = getNextNYOpenInstant(nowForCycle); marketSession = { marketOpen: ny && (ny as any).open === true ? true : false, nextOpenInstant: (ny && (ny as any).nextOpenInstant) ? (ny as any).nextOpenInstant.toString() : null }; }catch(_){ marketSession = { marketOpen: null, nextOpenInstant: null }; }

      // cash/portfolio before/after: derive from portfolio and any execution audits
      let cashBefore: number | null = null; let cashAfter: number | null = null; let portfolioValueBefore: number | null = null; let portfolioValueAfter: number | null = null;
      try{
        if (portfolio && typeof portfolio.availableCash === 'number') { cashBefore = portfolio.availableCash; portfolioValueBefore = typeof portfolio.totalValue === 'number' ? portfolio.totalValue : null; }
        // find first execution entry with portfolioBefore/after
        const firstExecEntry = cycleEntries.find((a:any)=> { const r = a && a.raw ? a.raw : a; return r && r.kind === 'EXECUTION' && (r.portfolioBefore || r.portfolioAfter); });
        if (firstExecEntry){ const r = firstExecEntry.raw || firstExecEntry; if (r.portfolioBefore && typeof r.portfolioBefore.availableCash === 'number') cashBefore = r.portfolioBefore.availableCash; if (r.portfolioAfter && typeof r.portfolioAfter.availableCash === 'number') cashAfter = r.portfolioAfter.availableCash; if (r.portfolioBefore && typeof r.portfolioBefore.totalValue === 'number') portfolioValueBefore = r.portfolioBefore.totalValue; if (r.portfolioAfter && typeof r.portfolioAfter.totalValue === 'number') portfolioValueAfter = r.portfolioAfter.totalValue; }
        // fallback: if no after, set after = before
        if (cashAfter === null) cashAfter = cashBefore; if (portfolioValueAfter === null) portfolioValueAfter = portfolioValueBefore;
      }catch(_){ }

      // Build DecisionReason objects per evaluated symbol using diagnostics and candidates
      const decisionReasons: any[] = [];
      try{
        const symSet = new Set<string>(analyzedSymbols.concat(eligibleSymbols || []).map((s:any)=> String(s).toUpperCase()));
        for (const sym of Array.from(symSet)){
          const diag = diagnosticsBySymbol.get(String(sym).toUpperCase()) || {};
          const cand = (candidates || []).find((c:any)=> String(c.symbol||'').toUpperCase() === String(sym).toUpperCase());
          const rejectsForSym = (cycleEntries || []).filter((a:any)=>{ const r = a && a.raw ? a.raw : a; try{ return r && r.kind === 'REJECT' && r.decision && String(r.decision.symbol||'').toUpperCase() === String(sym).toUpperCase(); }catch(_){ return false; } });
          const riskWarnings: string[] = [];
          try{ if (cand && cand.risk && Array.isArray((cand.risk as any).reasons)) riskWarnings.push(...(cand.risk as any).reasons.map(String)); }catch(_){ }
          const supportingReasons: string[] = [];
          try{ if (diag && diag.signal) supportingReasons.push(String(diag.signal)); if (diag && diag.reason) supportingReasons.push(String(diag.reason)); if (cand && (cand as any).reason) supportingReasons.push(String((cand as any).reason)); }catch(_){ }
          const primaryReason = diag && diag.rejectionReason ? String(diag.rejectionReason) : (rejectsForSym.length ? (rejectsForSym[0].raw && rejectsForSym[0].raw.reason && rejectsForSym[0].raw.reason.code ? String(rejectsForSym[0].raw.reason.code) : String(rejectsForSym[0].raw.reason && rejectsForSym[0].raw.reason.message || 'REJECT')) : (cand && cand.action ? `Decision:${cand.action}` : null));
          const marketSessionReason = (diag && typeof diag.marketOpen === 'boolean') ? (diag.marketOpen ? 'MARKET_OPEN' : 'MARKET_CLOSED') : null;
          const rejectedByRiskEngine = !!(cand && cand.risk && cand.risk.allowed === false);
          const rejectedByMarketHours = !!(diag && diag.marketOpen === false);
          const rejectedByFreshness = !!(diag && (diag.quoteFound === false || diag.isStale));
          const rejectedByPositionLimits = rejectsForSym.some((r:any)=>{ try{ const code = r.raw && r.raw.reason && r.raw.reason.code ? String(r.raw.reason.code) : null; return code === 'POSITION_LIMIT' || code === 'INSUFFICIENT_CASH'; }catch(_){return false;} });
          const dr: any = { symbol: String(sym).toUpperCase(), action: cand && cand.action ? cand.action : (diag && diag.decision ? diag.decision : 'HOLD'), confidence: cand && typeof cand.confidence === 'number' ? cand.confidence : (diag && typeof diag.confidence === 'number' ? diag.confidence : null), primaryReason, supportingReasons: supportingReasons.length ? supportingReasons : null, riskWarnings: riskWarnings.length ? riskWarnings : null, marketSessionReason, rejectedByRiskEngine, rejectedByMarketHours, rejectedByFreshness, rejectedByPositionLimits };
            // Preserve candidate marketRegime observation when present (do not reclassify)
            try{ if (cand && (cand as any).marketRegime && typeof (cand as any).marketRegime === 'object'){ const mr = (cand as any).marketRegime; dr.marketRegime = { regime: mr.regime, confidence: mr.confidence, reasons: Array.isArray(mr.reasons) ? mr.reasons.slice() : (mr.reasons ? [String(mr.reasons)] : []), riskNote: mr.riskNote ?? null };
              try{ dr.marketContextAdvice = buildMarketContextAdvice({ marketRegime: dr.marketRegime, technicalScore: null, momentum: null, volatility: (mr && typeof mr.confidence === 'number') ? (mr.confidence >= 100 ? 1 : undefined) : undefined }); }catch(_){ }
              // best-effort: build historical context from available audits (observation-only)
              try{
                const allAuditsForHist = Array.isArray(allAudits) ? allAudits : [];
                const completed = allAuditsForHist.map((a:any)=> a && a.raw ? a.raw : a).filter(Boolean).map((r:any)=>{
                  // normalize potential evaluation/feedback records
                  if (r.kind === 'TRADE_FEEDBACK' && r.feedback){ return { symbol: r.feedback && r.feedback.symbol ? String(r.feedback.symbol).toUpperCase() : null, returnPercent: typeof r.feedback.pnlPercent === 'number' ? r.feedback.pnlPercent : (typeof r.feedback.returnPercent === 'number' ? r.feedback.returnPercent : null), marketRegime: r.feedback && r.feedback.marketRegime ? r.feedback.marketRegime : null, marketContextAdvice: r.feedback && r.feedback.marketContextAdvice ? r.feedback.marketContextAdvice : null } as any; }
                  if (r.kind === 'EVALUATION' && r.evaluation){ return { symbol: r.evaluation && r.evaluation.symbol ? String(r.evaluation.symbol).toUpperCase() : null, returnPercent: typeof r.evaluation.returnPercent === 'number' ? r.evaluation.returnPercent : null, marketRegime: r.evaluation && r.evaluation.marketRegime ? r.evaluation.marketRegime : null, marketContextAdvice: r.evaluation && r.evaluation.marketContextAdvice ? r.evaluation.marketContextAdvice : null } as any; }
                  return null;
                }).filter(Boolean);
                try{ dr.historicalContext = buildHistoricalContext({ marketRegime: dr.marketRegime, marketContextAdvice: dr.marketContextAdvice, completedTradeEvaluations: completed }); }catch(_){ }
                // Attach decision confidence explanation (observation-only)
                try{ const expl = buildDecisionConfidenceExplanation({ decisionReason: dr, marketRegime: dr.marketRegime, marketContextAdvice: dr.marketContextAdvice, historicalContext: dr.historicalContext, adaptiveDecisionContext }); if (expl) dr.decisionConfidenceExplanation = expl; }catch(_){ }
                try{ const ev = buildDecisionEvidence({ decisionReason: dr, marketRegime: dr.marketRegime, marketContextAdvice: dr.marketContextAdvice, historicalContext: dr.historicalContext, adaptiveDecisionContext, decisionConfidenceExplanation: dr.decisionConfidenceExplanation }); if (ev) dr.decisionEvidence = ev; }catch(_){ }
                try{ const ec = analyzeEvidenceConsistency({ decisionEvidence: dr.decisionEvidence }); if (ec) dr.evidenceConsistency = ec; }catch(_){ }
                try{ const sid = buildEvidenceInformedDecision({ currentAction: dr.action, currentConfidence: dr.confidence, decisionEvidence: dr.decisionEvidence, evidenceConsistency: dr.evidenceConsistency }); if (sid) dr.evidenceInformedDecision = sid; }catch(_){ }
              }catch(_){ }
            } }catch(_){ }
          decisionReasons.push(dr);
        }
      }catch(_){ }

      // Build TradeFeedback objects now that decisionReasons exist
      try{
        for (const ex of executedTrades){
          try{
            const tradeId = ex.id || (`exec_${Date.now()}`);
            const symbol = String(ex.symbol || '').toUpperCase();
            const reasonsForSymbol = (decisionReasons || []).filter((d:any)=> String(d.symbol||'').toUpperCase() === symbol);
            const candidate = (candidates || []).find((c:any)=> String(c.symbol||'').toUpperCase() === symbol) || null;
            const confidenceAtExecution = candidate && typeof candidate.confidence === 'number' ? candidate.confidence : (reasonsForSymbol[0] && typeof reasonsForSymbol[0].confidence === 'number' ? reasonsForSymbol[0].confidence : null);
            const expectedDirection = candidate && candidate.action ? candidate.action : null;
            const executedAt = ex.generatedAt || nowIso();
            const evaluationDueAt = new Date(new Date(executedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
            const tf = { cycleId, tradeId, symbol, action: ex.side || (candidate && candidate.action) || 'UNKNOWN', confidenceAtExecution, expectedDirection, executedPrice: ex.executedPrice ?? null, executedAt, evaluationStatus: 'PENDING', evaluationDueAt, decisionReasons: reasonsForSymbol.length ? reasonsForSymbol : null } as any;
            try{ await cycleAuditStore.append({ kind: 'TRADE_FEEDBACK', id: `trade_feedback_${tradeId}`, timestamp: nowIso(), feedback: tf, meta: { automatic: true } } as any); }catch(_){ }
          }catch(_){ }
        }
      }catch(_){ }

      // Compute marketRegime distribution and dominant regime deterministically
      let marketRegimeDistribution: Record<string, number> | null = null;
      let dominantMarketRegime: string | null = null;
      try{
        const dist: Record<string, number> = {};
        for (const d of decisionReasons){
          try{
            const mr = d && d.marketRegime && d.marketRegime.regime ? String(d.marketRegime.regime) : null;
            if (mr){ dist[mr] = (dist[mr] || 0) + 1; }
          }catch(_){ }
        }
        if (Object.keys(dist).length) marketRegimeDistribution = dist;
        if (marketRegimeDistribution){
          // priority tie-break list
          const priority = ['HIGH_VOLATILITY','UNCERTAIN','STRONG_DOWNTREND','WEAK_DOWNTREND','RANGE_BOUND','WEAK_UPTREND','STRONG_UPTREND'];
          // find regime with highest count; on ties, use priority
          let bestCount = -1; let best: string | null = null;
          for (const k of Object.keys(marketRegimeDistribution)){
            const c = marketRegimeDistribution[k] || 0;
            if (c > bestCount){ bestCount = c; best = k; }
            else if (c === bestCount && best !== null){
              // tie-break by priority order
              const curPriority = priority.indexOf(k) >= 0 ? priority.indexOf(k) : priority.length;
              const bestPriority = priority.indexOf(best) >= 0 ? priority.indexOf(best) : priority.length;
              if (curPriority < bestPriority) best = k;
            }
          }
          dominantMarketRegime = best;
        }
      }catch(_){ marketRegimeDistribution = null; dominantMarketRegime = null; }

      // Build shadow decision summary based on existing evidenceInformedDecision (observation-only)
      let shadowDecisionSummary: any = null;
      try{
        const evaluated = Array.isArray(decisionReasons) ? decisionReasons.filter((d:any)=> d && d.evidenceInformedDecision && d.evidenceInformedDecision.recommendedAction) : [];
        const evaluatedCount = evaluated.length;
        let agreementCount = 0;
        const recommendedActionDistribution: { BUY:number; SELL:number; HOLD:number } = { BUY:0, SELL:0, HOLD:0 };
        const disagreementByTransition: Record<string, number> = {};
        for (const d of evaluated){
          try{
            const actual = String(d.action || 'HOLD');
            const rec = String((d.evidenceInformedDecision && d.evidenceInformedDecision.recommendedAction) || 'HOLD');
            if (actual === rec) agreementCount++;
            else {
              const key = `${actual}->${rec}`;
              disagreementByTransition[key] = (disagreementByTransition[key] || 0) + 1;
            }
            if (rec === 'BUY' || rec === 'SELL' || rec === 'HOLD') recommendedActionDistribution[rec as keyof typeof recommendedActionDistribution]++;
          }catch(_){ }
        }
        const disagreementCount = evaluatedCount - agreementCount;
        const agreementRate = evaluatedCount === 0 ? 0 : Math.round((agreementCount / evaluatedCount) * 100);
        shadowDecisionSummary = { evaluatedCount, agreementCount, disagreementCount, agreementRate, recommendedActionDistribution, disagreementByTransition: Object.keys(disagreementByTransition).length ? disagreementByTransition : {} };
      }catch(_){ shadowDecisionSummary = null; }

      const summary = { cycleId, timestamp: nowIso(), analyzedSymbols, eligibleSymbols, skippedSymbols, decisions: decisionsForSummary, executedTrades, rejectedTradesCount, confidenceAverage, topReason, riskBlocks: Object.keys(riskBlocks).length ? riskBlocks : null, overallConclusion, marketSession, cycleDurationMs: Date.now() - cycleStartMs, skippedReasonsBySymbol: Object.keys(skippedReasonsBySymbol).length ? skippedReasonsBySymbol : null, confidenceDistribution: Object.keys(confidenceDistribution).length ? confidenceDistribution : null, strongestBullishReason, strongestBearishReason, cashBefore, cashAfter, portfolioValueBefore, portfolioValueAfter, decisionReasons: decisionReasons.length ? decisionReasons : null, marketRegimeDistribution, dominantMarketRegime, shadowDecisionSummary, shadowPerformanceSummary: shadowPerformanceSummaryLocal } as any;
      try{ await cycleAuditStore.append({ kind: 'DECISION_SUMMARY', id: `decision_summary_${cycleId}`, timestamp: nowIso(), summary, meta: { automatic: true } } as any); }catch(_){ }

      // expose on runtime for quick observation
      try{ runtime.latestCycle = { ...runtime.latestCycle, decisionSummary: summary }; }catch(_){ }

      // Build Victor Review and Adaptive Decision Context for the completed cycle
      try{
        // Extract cycle-scoped entries again (best-effort)
        const all = Array.isArray(await auditStore.list()) ? await auditStore.list() : [];
        const cycleEntries2 = (all || []).filter((a:any)=>{ try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; } });
        const tradeFeedbacks = cycleEntries2.map((a:any)=> (a && a.raw && a.raw.kind === 'TRADE_FEEDBACK') ? (a.raw.feedback || a.feedback || a.raw) : null).filter(Boolean);
        const outcomeEvaluations = cycleEntries2.map((a:any)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
        // previously computed shadowPerformanceSummary is included on `summary` during creation
        // learningSignals are not persisted by default; attempt to find any if tests push them
        const learningSignals = cycleEntries2.map((a:any)=> (a && a.raw && a.raw.kind === 'LEARNING_SIGNAL') ? (a.raw.signal || a.signal || a.raw) : null).filter(Boolean);

        // Build victor review using available objects and the earlier `profile` captured at cycle start
        const victorReview = buildVictorReview(summary, tradeFeedbacks, outcomeEvaluations, learningSignals, profile);
        // Append victor review as an audit entry (compact)
        try{ await cycleAuditStore.append({ kind: 'DECISION_SUMMARY', id: `victor_review_${cycleId}`, timestamp: nowIso(), victorReview, meta: { automatic: true } } as any); }catch(_){ }

        // Build adaptive decision context deterministically and keep it as per-cycle local
        adaptiveDecisionContext = buildAdaptiveDecisionContext(profile, victorReview);
        try{ await cycleAuditStore.append({ kind: 'ADAPTIVE_DECISION_CONTEXT', id: `adaptive_context_${cycleId}`, timestamp: nowIso(), context: adaptiveDecisionContext, meta: { automatic: true } } as any); }catch(_){ }

        // Attach to runtime.latestCycle for quick observation (do not rely on runtime for policy)
        try{ runtime.latestCycle = { ...runtime.latestCycle, adaptiveDecisionContext: adaptiveDecisionContext, victorReview }; }catch(_){ }
        try{
          const snapshot = buildCycleIntelligenceSnapshot(summary, victorReview, adaptiveDecisionContext);
          try{ await cycleAuditStore.append({ kind: 'CYCLE_INTELLIGENCE_SNAPSHOT', id: `cycle_intel_${cycleId}`, timestamp: nowIso(), snapshot, meta: { automatic: true } } as any); }catch(_){ }
          try{ runtime.latestCycle = { ...runtime.latestCycle, cycleIntelligenceSnapshot: snapshot }; }catch(_){ }
        }catch(_){ }
      }catch(_){ /* tolerate failures */ }

    }catch(_){ /* tolerate summary build failures */ }
    try{ await cycleAuditStore.append(diagnosticsAudit); }catch(_){ }
    // expose on runtime for quick observation
    try{ runtime.latestCycle = { ...runtime.latestCycle, diagnosticsSummary: { analyzed, eligible, executed: executedCount, blockers: blockerCounts } }; }catch(_){ }
    // Ensure AdaptiveDecisionContext is built/attached even if the summary build failed earlier
    try{
      const existing = adaptiveDecisionContext ? true : false;
      if (!existing){
        // attempt to gather cycle entries
        try{
          const all2 = Array.isArray(await auditStore.list()) ? await auditStore.list() : [];
          const cycleEntries3 = (all2 || []).filter((a:any)=>{ try{ const raw = a && a.raw ? a.raw : a; return raw && raw.cycleId === cycleId; }catch(_){ return false; } });
          const tradeFeedbacks2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'TRADE_FEEDBACK') ? (a.raw.feedback || a.feedback || a.raw) : null).filter(Boolean);
          const outcomeEvaluations2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'EVALUATION') ? (a.raw.evaluation || a.evaluation || a.raw) : null).filter(Boolean);
          const learningSignals2 = cycleEntries3.map((a:any)=> (a && a.raw && a.raw.kind === 'LEARNING_SIGNAL') ? (a.raw.signal || a.signal || a.raw) : null).filter(Boolean);
          const decisionSummary = runtime && (runtime as any).latestCycle && (runtime as any).latestCycle.decisionSummary ? (runtime as any).latestCycle.decisionSummary : null;
          const victorReview2 = buildVictorReview(decisionSummary, tradeFeedbacks2, outcomeEvaluations2, learningSignals2, profile);
          const adaptiveContext2 = buildAdaptiveDecisionContext(profile, victorReview2);
          // set local per-cycle variable
          adaptiveDecisionContext = adaptiveContext2;
          try{ await cycleAuditStore.append({ kind: 'ADAPTIVE_DECISION_CONTEXT', id: `adaptive_context_${cycleId}`, timestamp: nowIso(), context: adaptiveContext2, meta: { automatic: true } } as any); }catch(_){ }
          try{ runtime.latestCycle = { ...runtime.latestCycle, adaptiveDecisionContext: adaptiveContext2, victorReview: victorReview2 }; }catch(_){ }
          try{
            const snapshot2 = buildCycleIntelligenceSnapshot(decisionSummary, victorReview2, adaptiveContext2);
            try{ await cycleAuditStore.append({ kind: 'CYCLE_INTELLIGENCE_SNAPSHOT', id: `cycle_intel_${cycleId}`, timestamp: nowIso(), snapshot: snapshot2, meta: { automatic: true } } as any); }catch(_){ }
            try{ runtime.latestCycle = { ...runtime.latestCycle, cycleIntelligenceSnapshot: snapshot2 }; }catch(_){ }
          }catch(_){ }
        }catch(_){ /* ignore */ }
      }
    }catch(_){ }
  }catch(_){ }
  // update scheduler last/next when manual (automatic) cycle finishes
  return { ...runtime.latestCycle, evaluationCount };
}

// Helper to ensure every EVALUATION audit includes a technicalAnalysis meta object.
export async function appendEvaluation(entry: any, store?: import('./types').AuditStore, opts?: { evaluateShadowOutcome?: boolean }){
  try{
    entry.meta = entry.meta || {};
    if (!Object.prototype.hasOwnProperty.call(entry.meta, 'technicalAnalysis')){
      entry.meta.technicalAnalysis = { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: 'MISSING_TECHNICAL', technicalAnalysisErrorMessage: null };
    }
    // Derive a short human-readable technical summary from existing technicalAnalysis
    try{
      const ta = entry.meta.technicalAnalysis || {};
      // initialize technicalSummary only if not present to avoid overwriting any explicit test data
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'technicalSummary')){
        if (ta.technicalAnalysisStatus === 'success'){
          const trend = ta.technicalTrend || null;
          const signal = ta.technicalSignal || null;
          const score = typeof ta.technicalScore === 'number' ? ta.technicalScore : (typeof ta.technicalScore === 'string' ? Number(ta.technicalScore) : null);
          const reason = Array.isArray(ta.technicalReasons) && ta.technicalReasons.length ? String(ta.technicalReasons[0]) : (ta.technicalAnalysisErrorMessage || null);
          const textParts = [] as string[];
          if (trend) textParts.push(`Trend: ${trend}`);
          if (signal) textParts.push(`Signal: ${signal}`);
          if (score !== null && score !== undefined) textParts.push(`Score: ${score}`);
          if (reason) textParts.push(`Reason: ${reason}`);
          entry.meta.technicalSummary = { trend, signal, score, reason, text: textParts.join(' • ') };
        } else {
          entry.meta.technicalSummary = { text: 'Technical analysis unavailable' };
        }
      }
    }catch(_){ /* swallow summary generation errors */ }
    // Derive a compact list of short reasons from the existing technicalAnalysis
    try{
      const ta = entry.meta.technicalAnalysis || {};
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'technicalReasons')){
        if (ta.technicalAnalysisStatus === 'success'){
          const trend = ta.technicalTrend || null;
          const momentum = (typeof ta.technicalMomentumPercent === 'number' && Number.isFinite(ta.technicalMomentumPercent)) ? Math.round(ta.technicalMomentumPercent) : null;
          const volatility = (typeof ta.technicalVolatilityPercent === 'number' && Number.isFinite(ta.technicalVolatilityPercent)) ? Math.round(ta.technicalVolatilityPercent) : null;
          const score = (typeof ta.technicalScore === 'number' && Number.isFinite(ta.technicalScore)) ? Math.round(ta.technicalScore) : null;
          const important = Array.isArray(ta.technicalReasons) && ta.technicalReasons.length ? String(ta.technicalReasons[0]) : (ta.technicalAnalysisErrorMessage || null);
          const rows: string[] = [];
          // Combine trend and score on the first row
          if (trend && typeof score === 'number') rows.push(`Trend: ${trend} • Score: ${score}`);
          else if (trend) rows.push(`Trend: ${trend}`);
          else if (typeof score === 'number') rows.push(`Score: ${score}`);
          // add momentum, volatility, and important reason as subsequent rows
          if (typeof momentum === 'number') rows.push(`Momentum: ${momentum}%`);
          if (typeof volatility === 'number') rows.push(`Volatility: ${volatility}%`);
          if (important) rows.push(`Reason: ${important}`);
          // ensure max 4 rows
          entry.meta.technicalReasons = rows.slice(0, 4);
          if (!entry.meta.technicalReasons || !entry.meta.technicalReasons.length) entry.meta.technicalReasons = [`No technical reasons available`];
        } else {
          entry.meta.technicalReasons = ['Technical analysis unavailable'];
        }
      }
    }catch(_){ /* ignore */ }
    // Derive a short decision explanation based on available decision and technicalAnalysis
    try{
      // do not overwrite if present
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'decisionExplanation')){
        const decision = entry && entry.decision ? entry.decision : null;
        const actualAction = decision && decision.action ? String(decision.action) : null;
        const ta = entry.meta.technicalAnalysis || {};
        if (!ta || ta.technicalAnalysisStatus !== 'success'){
          entry.meta.decisionExplanation = 'Victor avvaktar eftersom teknisk analys saknas.';
        } else {
          const techSignal = ta.technicalSignal ? String(ta.technicalSignal) : null;
          // If technical signal differs from actual action, mention it
          if (techSignal && actualAction && techSignal.toUpperCase() !== actualAction.toUpperCase()){
            entry.meta.decisionExplanation = `Victor avvaktar. Den tekniska signalen är ${techSignal}, men strategins övriga villkor gav ${actualAction}.`;
          } else if (actualAction) {
            entry.meta.decisionExplanation = `Victor agerar: ${actualAction}.`;
          } else {
            entry.meta.decisionExplanation = `Victor avvaktar.`;
          }
        }
      }
    }catch(_){ /* ignore explanation errors */ }
    // Derive decisionContext metadata for evaluations
    try{
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'decisionContext')){
        const ta = entry.meta.technicalAnalysis || {};
        const status = ta.technicalAnalysisStatus || 'unavailable';
        let technicalConfidence: number | null = null;
        if (status === 'success' && ta && typeof ta.technicalScore !== 'undefined' && ta.technicalScore !== null){
          const parsed = Number(ta.technicalScore);
          if (Number.isFinite(parsed)) technicalConfidence = Math.round(parsed);
          else technicalConfidence = null;
        } else {
          technicalConfidence = null;
        }
        const techSignal = ta.technicalSignal ? String(ta.technicalSignal) : null;
        const actualAction = entry && entry.decision && entry.decision.action ? String(entry.decision.action) : null;
        const signalsConflict = techSignal && actualAction ? (techSignal.toUpperCase() !== actualAction.toUpperCase()) : false;
        let recommendationStrength: 'LOW'|'MEDIUM'|'HIGH' = 'LOW';
        if (technicalConfidence === null){ recommendationStrength = 'LOW'; }
        else if (technicalConfidence >= 75) { recommendationStrength = 'HIGH'; }
        else if (technicalConfidence >= 50) { recommendationStrength = 'MEDIUM'; }
        else { recommendationStrength = 'LOW'; }
        // compute overallDecisionConfidence per rules: start with technicalConfidence (or 0 if unavailable),
        // reduce by 20 if signalsConflict, clamp 0..100, round to int
        let overallDecisionConfidence: number = 0;
        if (status === 'success' && typeof technicalConfidence === 'number'){
          overallDecisionConfidence = Math.round(Math.max(0, Math.min(100, technicalConfidence - (signalsConflict ? 20 : 0))));
        } else {
          overallDecisionConfidence = 0;
        }

        entry.meta.decisionContext = {
          technicalConfidence,
          technicalStatus: status,
          signalsConflict,
          recommendationStrength,
          overallDecisionConfidence,
        };
        // executiveSummary: one-sentence summary built from existing fields
        try{
          let executiveSummary = 'Technical analysis unavailable.';
          if (status === 'success'){
            if (signalsConflict){
              if (recommendationStrength === 'HIGH') executiveSummary = 'Strong technical setup, but conflicting signals reduce confidence.';
              else if (recommendationStrength === 'MEDIUM') executiveSummary = 'Technical outlook is positive, but conflicting signals reduce confidence.';
              else executiveSummary = 'Technical outlook is weak and conflicting signals reduce confidence.';
            } else {
              if (recommendationStrength === 'HIGH') executiveSummary = 'Strong technical setup with no conflicting signals.';
              else if (recommendationStrength === 'MEDIUM') executiveSummary = 'Technical outlook is positive with moderate confidence.';
              else executiveSummary = 'Technical outlook is weak.';
            }
          }
          entry.meta.decisionContext.executiveSummary = executiveSummary;
        }catch(_){ /* ignore executiveSummary errors */ }
      }
    }catch(_){ /* ignore */ }

    // Add combinedAnalysis using available technicalAnalysis and optional fundamentalAnalysis
    try{
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'combinedAnalysis')){
        const tech = entry.meta.technicalAnalysis ? entry.meta.technicalAnalysis : null;
        const fund = entry.meta.fundamentalAnalysis ? entry.meta.fundamentalAnalysis : null;
        try{
          const techEngine = tech ? { status: tech.technicalAnalysisStatus || tech.status, score: typeof tech.technicalScore === 'number' ? tech.technicalScore : (typeof tech.technicalScore === 'string' ? Number(tech.technicalScore) : undefined), signal: tech.technicalSignal || tech.signal, reasons: Array.isArray(tech.technicalReasons) ? tech.technicalReasons : undefined } : null;
          const fundEngine = fund ? { status: fund.status || fund.technicalAnalysisStatus, score: typeof fund.score === 'number' ? fund.score : (typeof fund.score === 'string' ? Number(fund.score) : undefined), signal: fund.signal || fund.technicalSignal, reasons: Array.isArray(fund.reasons) ? fund.reasons : undefined } : null;
          const combined = combineAnalyses({ technical: techEngine as any, fundamental: fundEngine as any });
          entry.meta.combinedAnalysis = combined;
        }catch(_){ /* swallow errors from aggregator */ }
      }
    }catch(_){ /* ignore combined analysis errors */ }

    // Ensure evaluationSource meta is present and reflects which analyses were used
    try{
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'evaluationSource')){
        const technicalUsed = !!entry.meta.technicalAnalysis;
        const fundamentalUsed = !!entry.meta.fundamentalAnalysis;
        const aggregatorUsed = !!entry.meta.combinedAnalysis;
        let agreement: 'HIGH'|'MEDIUM'|'LOW' = 'HIGH';
        let conflictingSignals = false;
        try{
          const ca = entry.meta.combinedAnalysis;
          if (ca && typeof ca.agreement === 'string') agreement = ca.agreement;
          if (ca && typeof ca.conflictingSignals === 'boolean') conflictingSignals = Boolean(ca.conflictingSignals);
        }catch(_){ }
        entry.meta.evaluationSource = { technicalUsed, fundamentalUsed, aggregatorUsed, agreement, conflictingSignals };
      }
    }catch(_){ /* ignore */ }

    // Compute decisionComparison here (in evaluation flow) so storage layer remains passive.
    try{
      if (!Object.prototype.hasOwnProperty.call(entry.meta, 'decisionComparison')){
        const dec = entry && entry.decision ? entry.decision : null;
        const strategyAction = dec && dec.action ? String(dec.action).toUpperCase() : 'HOLD';
        const aggSignal = entry.meta.combinedAnalysis && typeof entry.meta.combinedAnalysis.overallSignal === 'string' ? String(entry.meta.combinedAnalysis.overallSignal).toUpperCase() : 'HOLD';
        const aggregatorSignal = aggSignal || 'HOLD';
        const matches = strategyAction === aggregatorSignal;
        // Do NOT modify entry.decision.action
        entry.meta.decisionComparison = { strategyAction, aggregatorSignal, matches };
      }
    }catch(_){ }

    // Compute alignmentStats for EVALUATION audits by inspecting previous EVALUATION entries
    try{
      if (entry && entry.kind === 'EVALUATION'){
        try{
          const prev = await auditStore.list();
          const symbol = entry && entry.decision && entry.decision.symbol ? String(entry.decision.symbol).toUpperCase() : null;
          const prevEvals = Array.isArray(prev) ? prev.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION' && a.raw.decision && symbol ? String(a.raw.decision.symbol).toUpperCase() === symbol : true) : [];
          // Count only previous evaluations that have a decisionComparison
          let prevComparisons = 0;
          let prevMatches = 0;
          for (const p of prevEvals){
            try{
              const dc = p && p.raw && p.raw.meta && p.raw.meta.decisionComparison;
              if (dc){ prevComparisons++; if (dc.matches) prevMatches++; }
            }catch(_){ }
          }
          const thisDc = entry.meta && entry.meta.decisionComparison ? entry.meta.decisionComparison : null;
          const thisMatch = thisDc && !!thisDc.matches ? 1 : 0;
          const totalComparisons = prevComparisons + (thisDc ? 1 : 0);
          const matchingComparisons = prevMatches + thisMatch;
          const matchRate = Math.round((totalComparisons > 0 ? (matchingComparisons / totalComparisons) * 100 : 0));
          entry.meta.alignmentStats = { totalComparisons, matchingComparisons, matchRate };
        }catch(_){ /* ignore alignment compute errors */ }
      }
    }catch(_){ }

  }catch(_){ /* ignore normalization errors */ }
  // Attach shadowDecisionOutcome when possible (observation-only)
  try{
    // default: evaluate shadow outcome unless explicitly opted out
    const shouldEvaluateShadow = !(opts && opts.evaluateShadowOutcome === false);
    if (shouldEvaluateShadow){
      if (entry && entry.kind === 'EVALUATION'){
        try{
          const sym = entry.decision && entry.decision.symbol ? String(entry.decision.symbol).toUpperCase() : (entry.execution && entry.execution.symbol ? String(entry.execution.symbol).toUpperCase() : null);
          let originalAction: string | null = null;
          let originalRefPrice: number | null = null;
          let storedShadowAction: string | null = null;
          try{
            const prev = Array.isArray(await (store || auditStore).list()) ? await (store || auditStore).list() : [];
            for (const p of prev){
              try{
                const raw = p && p.raw ? p.raw : p;
                if (!raw) continue;
                if (raw.kind === 'DECISION_SUMMARY'){
                  const summ = raw.summary || raw.decisionSummary || raw;
                  if (summ && Array.isArray(summ.decisions)){
                    const found = summ.decisions.find((d:any)=> d && (String(d.symbol||'').toUpperCase() === sym));
                    if (found){ originalAction = String(found.action || '').toUpperCase() || originalAction; if (typeof found.referencePrice === 'number') originalRefPrice = Number(found.referencePrice); }
                  }
                  if (summ && Array.isArray(summ.decisionReasons)){
                    const dr = summ.decisionReasons.find((d:any)=> d && (String(d.symbol||'').toUpperCase() === sym));
                    if (dr && dr.evidenceInformedDecision && dr.evidenceInformedDecision.recommendedAction) storedShadowAction = String(dr.evidenceInformedDecision.recommendedAction).toUpperCase();
                  }
                }
                if (raw.kind === 'TRADE_FEEDBACK'){
                  const fb = raw.feedback || raw;
                  if (fb && Array.isArray(fb.decisionReasons)){
                    const dr = fb.decisionReasons.find((d:any)=> d && (String(d.symbol||'').toUpperCase() === sym));
                    if (dr && dr.evidenceInformedDecision && dr.evidenceInformedDecision.recommendedAction) storedShadowAction = storedShadowAction || String(dr.evidenceInformedDecision.recommendedAction).toUpperCase();
                  }
                }
              }catch(_){ }
            }
          }catch(_){ }

          let refPrice: number | null = null;
          let evalPrice: number | null = null;
          try{ if (originalRefPrice !== null) refPrice = originalRefPrice; }catch(_){ }
          try{ if (entry.decision && typeof entry.decision.referencePrice === 'number') refPrice = entry.decision.referencePrice; }catch(_){ }
          try{ if (entry.execution && typeof entry.execution.executedPrice === 'number') evalPrice = entry.execution.executedPrice; }catch(_){ }
          try{ if (entry.evaluation && typeof entry.evaluation.exitPrice === 'number') evalPrice = evalPrice || entry.evaluation.exitPrice; }catch(_){ }

          const actualAct = originalAction || (entry.decision && entry.decision.action ? String(entry.decision.action).toUpperCase() : null);
          const shadowAct = storedShadowAction || null;
          const out = evaluateShadowDecisionOutcome({ actualAction: actualAct || 'HOLD', shadowAction: shadowAct || 'HOLD', referencePrice: refPrice ?? undefined, evaluationPrice: evalPrice ?? undefined, neutralThresholdPercent: 5 });
          entry.evaluation = entry.evaluation || {};
          entry.evaluation.shadowDecisionOutcome = out;
        }catch(_){ }
      }
    }
  }catch(_){ }
  return (store || auditStore).append(entry);
}

export async function setPaperTradingEnabled(enabled: boolean){
  runtime.enabled = enabled;
  runtime.trader = createPaperTrader({ portfolioAdapter, auditStore, config: { ...config, enabled } });
  runtime.lastUpdated = nowIso();
}

export async function executePaperTradeDecision(decision: PaperTradeDecision){
  runtime.latestDecision = decision;
  // capture before snapshot
  const beforeExecutionPortfolio = await portfolioAdapter.getPortfolio();
  const res = await runtime.trader.handleDecision(decision as any);
  // If executed and SELL that closes a position, compute and attach evaluation and update audit
  try{
    if (res && res.accepted){
      const exec: SimulatedExecution | null = (res.execution || res.transaction) || null;
      if (exec && String((exec as any).side || decision.action).toUpperCase() === 'SELL'){
        const afterExecutionPortfolio = await portfolioAdapter.getPortfolio();
        const sym = String(decision.symbol || '').toUpperCase();
        const stillHolding = Array.isArray(afterExecutionPortfolio.holdings) && afterExecutionPortfolio.holdings.find((h:any)=> String(h.symbol||'').toUpperCase() === sym);
        if (!stillHolding){
          const beforeHolding = Array.isArray(beforeExecutionPortfolio.holdings) ? beforeExecutionPortfolio.holdings.find((h:any)=> String(h.symbol||'').toUpperCase() === sym) : null;
          const entryPrice = beforeHolding && typeof beforeHolding.averagePrice === 'number' ? Number(beforeHolding.averagePrice) : null;
          const exitPrice = typeof (exec as any).executedPrice === 'number' ? Number((exec as any).executedPrice) : null;
          const qty = typeof (exec as any).quantity === 'number' ? Number((exec as any).quantity) : null;
          if (entryPrice !== null && exitPrice !== null && qty !== null){
            // Prefer an existing evaluation object on the execution if it looks valid; otherwise compute a fallback
            let evaluation: any = null;
            try{
              const existing = (exec as any).evaluation;
              if (existing && typeof existing.pnlSek === 'number' && typeof existing.pnlPercent === 'number' && (existing.winner === true || existing.winner === false)){
                evaluation = existing;
              }
            }catch(_){ /* ignore */ }
            if (!evaluation){
              evaluation = evaluateTrade({ entryPrice, exitPrice, quantity: qty, totalFees: exec.fee ?? 0 });
              try{ (exec as any).evaluation = evaluation; }catch(_){ }
            }
            // Attempt to resolve a single-entry BUY for a safe TradeReview
            try{
              const audits = await auditStore.list();
              let portfolioId = '';
              if (beforeExecutionPortfolio && typeof beforeExecutionPortfolio === 'object' && beforeExecutionPortfolio !== null){
                const asRec = beforeExecutionPortfolio as Record<string, unknown>;
                const idVal = asRec['id'];
                if (typeof idVal === 'string') portfolioId = idVal;
              }
              const entry = resolveSingleEntryForReview({ audits, portfolioId, symbol: sym, soldQuantity: qty });
              if (entry){
                const exitTs = nowIso();
                const holdingMinutes = Math.max(0, Math.floor((new Date(exitTs).getTime() - new Date(entry.entryTimestamp).getTime()) / 60000));
                const review = buildTradeReview({
                  executionId: entry.executionId,
                  symbol: sym,
                  entryPrice: entry.entryPrice,
                  exitPrice: exitPrice,
                  quantity: qty,
                  totalFees: exec.fee ?? 0,
                  holdingMinutes,
                  confidenceAtEntry: entry.confidenceAtEntry,
                  createdAt: exitTs,
                });
                try{ if (evaluation && typeof evaluation === 'object') (evaluation as Record<string, unknown>).tradeReview = review; }catch(_){ }
              }
            }catch(_){ /* tolerate resolver failures silently */ }
            try{
              const entries = (auditStore as any).entries as any[] | undefined;
              if (Array.isArray(entries)){
                for (let i = entries.length - 1; i >= 0; i--){
                  const it = entries[i];
                  if (it && it.raw && it.raw.kind === 'EXECUTION' && it.raw.execution && it.raw.execution.id === exec.id){
                    try{ (it.raw.execution as any).evaluation = evaluation; }catch(_){ }
                    break;
                  }
                }
              }
            }catch(_){ }
            try{ await auditStore.append({ kind: 'EVALUATION', decision, execution: exec, evaluation, portfolioBefore: beforeExecutionPortfolio, portfolioAfter: afterExecutionPortfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
          }
        }
      }
    }
  }catch(_){ }

  // update lightweight runtime state for observability
  runtime.latestCycle = res && (res as any).accepted ? { processedCandidates: 1, executed: 1, rejects: 0 } : { processedCandidates: 1, executed: 0, rejects: 1 } as any;
  runtime.latestDecision = decision;
  runtime.lastUpdated = nowIso();
  return { result: res, state: await getPaperTradingState() };
}

export { startAutonomousScheduler, stopAutonomousScheduler };

// Evaluate outcome for a single TradeFeedback using provided current market price.
// This function is explicit and does not fetch market data.
export function evaluateTradeOutcome(feedback:any, currentPrice?: number){
  const now = nowIso();
  try{
    const tradeId = feedback && feedback.tradeId ? String(feedback.tradeId) : (feedback && feedback.id ? String(feedback.id) : `unknown_${Date.now()}`);
    const executedPrice = (feedback && typeof feedback.executedPrice === 'number') ? Number(feedback.executedPrice) : null;
    const cp = (typeof currentPrice === 'number' && Number.isFinite(currentPrice)) ? Number(currentPrice) : null;
    let priceChangePercent: number | null = null;
    let absolutePnL: number | null = null;
    if (executedPrice !== null && cp !== null && executedPrice !== 0){
      priceChangePercent = ((cp - executedPrice) / executedPrice) * 100;
      priceChangePercent = Math.round(priceChangePercent * 100) / 100;
      // absolute PnL cannot be accurately computed without quantity; best-effort: use notional if present
      const notional = feedback && typeof feedback.notional === 'number' ? Number(feedback.notional) : null;
      const quantity = feedback && typeof feedback.quantity === 'number' ? Number(feedback.quantity) : null;
      if (quantity !== null) absolutePnL = Math.round(((cp - executedPrice) * quantity) * 100) / 100;
      else if (notional !== null && executedPrice !== 0) absolutePnL = Math.round(((cp - executedPrice) * (notional / executedPrice)) * 100) / 100;
      else absolutePnL = null;
    }

    const expectedDirection = feedback && feedback.expectedDirection ? String(feedback.expectedDirection).toUpperCase() : null;
    let expectedDirectionCorrect = false;
    if (priceChangePercent !== null && expectedDirection){
      if (expectedDirection === 'BUY') expectedDirectionCorrect = priceChangePercent > 0;
      else if (expectedDirection === 'SELL') expectedDirectionCorrect = priceChangePercent < 0;
      else expectedDirectionCorrect = false;
    }

    const confidence = feedback && typeof feedback.confidenceAtExecution === 'number' ? Number(feedback.confidenceAtExecution) : null;
    // Heuristic: confidenceAccurate when confidence >=50 and expectedDirectionCorrect true
    const confidenceAccurate = (confidence !== null && expectedDirectionCorrect) ? (confidence >= 50) : false;

    let evaluationResult: 'WIN'|'LOSS'|'NEUTRAL' = 'NEUTRAL';
    if (priceChangePercent === null){ evaluationResult = 'NEUTRAL'; }
    else if (expectedDirectionCorrect) evaluationResult = 'WIN';
    else evaluationResult = 'LOSS';

    const outcomeReason = priceChangePercent === null ? 'Insufficient price data' : (evaluationResult === 'WIN' ? 'Price moved in expected direction' : 'Price moved opposite to expectation');

    const out = { tradeId, evaluatedAt: now, currentPrice: cp, priceChangePercent, absolutePnL, expectedDirectionCorrect, confidenceAccurate, evaluationResult, outcomeReason } as any;
    return out as import('./types').OutcomeEvaluation;
  }catch(e){
    return { tradeId: (feedback && feedback.tradeId) ? String(feedback.tradeId) : `err_${Date.now()}`, evaluatedAt: now, currentPrice: null, priceChangePercent: null, absolutePnL: null, expectedDirectionCorrect: false, confidenceAccurate: false, evaluationResult: 'NEUTRAL', outcomeReason: String((e as any) && (e as any).message ? (e as any).message : e) } as any;
  }
}

// Generate a deterministic learning signal from an OutcomeEvaluation and its TradeFeedback.
export function generateLearningSignal(outcome:any, feedback:any){
  const now = nowIso();
  try{
    const tradeId = outcome && outcome.tradeId ? String(outcome.tradeId) : (feedback && feedback.tradeId ? String(feedback.tradeId) : `unknown_${Date.now()}`);
    const symbol = feedback && feedback.symbol ? String(feedback.symbol).toUpperCase() : (feedback && feedback.tradeId ? null : null);
    const evalResult = outcome && outcome.evaluationResult ? String(outcome.evaluationResult) : 'NEUTRAL';
    const confidence = feedback && typeof feedback.confidenceAtExecution === 'number' ? Number(feedback.confidenceAtExecution) : (feedback && typeof feedback.confidence === 'number' ? Number(feedback.confidence) : null);
    const confidenceAccurate = !!(outcome && typeof outcome.confidenceAccurate === 'boolean' ? outcome.confidenceAccurate : false);
    const expectedCorrect = !!(outcome && typeof outcome.expectedDirectionCorrect === 'boolean' ? outcome.expectedDirectionCorrect : false);

    // Determine lesson category deterministically using only supplied objects
    let lesson: any = 'NEUTRAL';
    let suggestedConfidenceAdjustment: number | null = null;
    let suggestedRiskAdjustment: number | null = null;

    // Confidence-based rules
    if (confidence !== null && typeof confidence === 'number'){
      if (evalResult === 'LOSS' && confidence >= 70){
        lesson = 'CONFIDENCE_TOO_HIGH';
        suggestedConfidenceAdjustment = -10; // suggest reduce 10 percentage points
      } else if (evalResult === 'WIN' && confidence < 50){
        lesson = 'CONFIDENCE_TOO_LOW';
        suggestedConfidenceAdjustment = +10; // suggest increase 10 percentage points
      }
    }

    // Risk-based rules from decisionReasons present in feedback
    try{
      const drs = Array.isArray(feedback && feedback.decisionReasons ? feedback.decisionReasons : feedback && feedback.decisionReasons ? feedback.decisionReasons : []) ? (feedback.decisionReasons || []) : [];
      const riskWarnings = drs.reduce((acc:any, d:any)=> acc.concat(Array.isArray(d.riskWarnings) ? d.riskWarnings : []), [] as string[]);
      if (riskWarnings.length){
        // If there were risk warnings and outcome was LOSS -> risk too aggressive
        if (evalResult === 'LOSS'){
          lesson = 'RISK_TOO_AGGRESSIVE';
          suggestedRiskAdjustment = -0.1; // suggest reduce risk tolerance by 10%
        } else if (evalResult === 'WIN'){
          // maybe risk was too conservative if wins and low confidence
          if (confidence !== null && confidence < 50){ lesson = 'RISK_TOO_CONSERVATIVE'; suggestedRiskAdjustment = +0.05; }
        }
      }
    }catch(_){ }

    // If none of the above changed and evaluation was correct, mark CORRECT_DECISION
    if (lesson === 'NEUTRAL' && evalResult === 'WIN' && expectedCorrect) lesson = 'CORRECT_DECISION';

    // Compose summary
    const summaryParts: string[] = [];
    summaryParts.push(`Result: ${evalResult}`);
    if (confidence !== null) summaryParts.push(`Confidence: ${confidence}`);
    if (typeof suggestedConfidenceAdjustment === 'number') summaryParts.push(`SuggestConfidenceAdj: ${suggestedConfidenceAdjustment}`);
    if (typeof suggestedRiskAdjustment === 'number') summaryParts.push(`SuggestRiskAdj: ${suggestedRiskAdjustment}`);
    const summary = summaryParts.join(' | ');

    const signal = {
      tradeId,
      symbol,
      generatedAt: now,
      evaluationResult: evalResult,
      confidenceAtExecution: confidence !== undefined ? confidence : null,
      confidenceAccurate: confidenceAccurate,
      expectedDirectionCorrect: expectedCorrect,
      lessonCategory: lesson,
      suggestedConfidenceAdjustment: suggestedConfidenceAdjustment,
      suggestedRiskAdjustment: suggestedRiskAdjustment,
      summary
    } as any;
    return signal as import('./types').LearningSignal;
  }catch(e){
    return { tradeId: (feedback && feedback.tradeId) ? String(feedback.tradeId) : `err_${Date.now()}`, generatedAt: now, evaluationResult: 'NEUTRAL', confidenceAtExecution: null, confidenceAccurate: false, expectedDirectionCorrect: false, lessonCategory: 'NEUTRAL', suggestedConfidenceAdjustment: null, suggestedRiskAdjustment: null, summary: String((e as any) && (e as any).message ? (e as any).message : e) } as any;
  }
}

// Pure deterministic aggregator: build a performance profile from an array of LearningSignal
export function buildPerformanceProfile(learningSignals: LearningSignal[]){
  const signals = Array.isArray(learningSignals) ? learningSignals : [];
  const totalTrades = signals.length;
  let wins = 0, losses = 0, neutral = 0;
  let confidenceSum = 0; let confidenceCount = 0;
  let confidenceAccurateCount = 0; let confidenceAccurateDenom = 0;
  const lessonBreakdown: Record<string, number> = {};
  let suggestedConfidenceSum = 0; let suggestedConfidenceCount = 0;
  let suggestedRiskSum = 0; let suggestedRiskCount = 0;

  for (const s of signals){
    const res = s && s.evaluationResult ? String(s.evaluationResult) : 'NEUTRAL';
    if (res === 'WIN') wins++;
    else if (res === 'LOSS') losses++;
    else neutral++;

    if (s && typeof s.confidenceAtExecution === 'number' && !Number.isNaN(s.confidenceAtExecution)){
      confidenceSum += s.confidenceAtExecution;
      confidenceCount++;
    }
    if (s && typeof s.confidenceAccurate === 'boolean'){
      confidenceAccurateDenom++;
      if (s.confidenceAccurate) confidenceAccurateCount++;
    }

    const lesson = s && s.lessonCategory ? String(s.lessonCategory) : 'NEUTRAL';
    lessonBreakdown[lesson] = (lessonBreakdown[lesson] || 0) + 1;

    if (s && typeof s.suggestedConfidenceAdjustment === 'number' && !Number.isNaN(s.suggestedConfidenceAdjustment)){
      suggestedConfidenceSum += s.suggestedConfidenceAdjustment;
      suggestedConfidenceCount++;
    }
    if (s && typeof s.suggestedRiskAdjustment === 'number' && !Number.isNaN(s.suggestedRiskAdjustment)){
      suggestedRiskSum += s.suggestedRiskAdjustment;
      suggestedRiskCount++;
    }
  }

  const winRate = totalTrades === 0 ? 0 : (wins / totalTrades);
  const averageConfidence = confidenceCount === 0 ? 0 : (confidenceSum / confidenceCount);
  const confidenceAccuracy = confidenceAccurateDenom === 0 ? 0 : (confidenceAccurateCount / confidenceAccurateDenom);
  const recommendedConfidenceBias = suggestedConfidenceCount === 0 ? 0 : (suggestedConfidenceSum / suggestedConfidenceCount);
  const recommendedRiskBias = suggestedRiskCount === 0 ? 0 : (suggestedRiskSum / suggestedRiskCount);

  const summary = `trades=${totalTrades} wins=${wins} losses=${losses} neutral=${neutral} winRate=${(winRate*100).toFixed(1)}% avgConf=${averageConfidence.toFixed(1)}`;

  return {
    totalTrades,
    wins,
    losses,
    neutral,
    winRate,
    averageConfidence,
    confidenceAccuracy,
    lessonBreakdown,
    recommendedConfidenceBias,
    recommendedRiskBias,
    summary
  } as const;
}

// Pure deterministic Victor review pipeline
export function buildVictorReview(
  decisionSummary: import('./types').DecisionSummary | null,
  tradeFeedbacks: import('./types').TradeFeedback[] | null,
  outcomeEvaluations: import('./types').OutcomeEvaluation[] | null,
  learningSignals: import('./types').LearningSignal[] | null,
  performanceProfile: any
){
  const ds = decisionSummary || ({} as import('./types').DecisionSummary);
  const tfs = Array.isArray(tradeFeedbacks) ? tradeFeedbacks : [];
  const outs = Array.isArray(outcomeEvaluations) ? outcomeEvaluations : [];
  const ls = Array.isArray(learningSignals) ? learningSignals : [];
  const pf = performanceProfile || {};

  const cycleId = ds.cycleId || (tfs.length ? tfs[0].cycleId : null) || 'unknown';
  const generatedAt = ds.timestamp || (ls.length ? ls[0].generatedAt : (outs.length ? outs[0].evaluatedAt : null)) || null;

  const totalTrades = pf && typeof pf.totalTrades === 'number' ? pf.totalTrades : ls.length || tfs.length || 0;
  const winRate = pf && typeof pf.winRate === 'number' ? pf.winRate : (totalTrades === 0 ? 0 : (ls.filter(s => s.evaluationResult === 'WIN').length / totalTrades));
  const avgConf = pf && typeof pf.averageConfidence === 'number' ? pf.averageConfidence : (ls.reduce((s:any,x:any)=> s + (typeof x.confidenceAtExecution === 'number' ? x.confidenceAtExecution : 0), 0) / (ls.filter((x:any)=> typeof x.confidenceAtExecution === 'number').length || 1));
  const confAcc = pf && typeof pf.confidenceAccuracy === 'number' ? pf.confidenceAccuracy : (ls.filter((x:any)=> x.confidenceAccurate).length / (ls.length || 1));

  const executiveSummary = `Cycle ${cycleId}: ${totalTrades} trades, winRate=${(winRate*100).toFixed(1)}%, avgConf=${(Number.isFinite(avgConf) ? avgConf.toFixed(1) : 'N/A')}`;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestedFocusAreas: string[] = [];

  if (winRate >= 0.6) strengths.push('High win rate');
  if (confAcc >= 0.6) strengths.push('Confidence predictions are generally accurate');
  if ((pf && pf.recommendedRiskBias) === 0 || (pf && pf.recommendedRiskBias === undefined)) strengths.push('Stable risk recommendations');

  if (winRate < 0.4) weaknesses.push('Low win rate');
  if (confAcc < 0.5) weaknesses.push('Low confidence accuracy');
  if (pf && typeof pf.recommendedConfidenceBias === 'number' && Math.abs(pf.recommendedConfidenceBias) > 5) weaknesses.push('Large suggested confidence adjustments');

  if (weaknesses.includes('Low win rate')) suggestedFocusAreas.push('Investigate decision quality and signal sources');
  if (weaknesses.includes('Low confidence accuracy')) suggestedFocusAreas.push('Calibrate confidence scoring and model calibration');
  if (weaknesses.includes('Large suggested confidence adjustments')) suggestedFocusAreas.push('Adjust confidence bias incrementally and monitor');

  // Inspect learning signals for common lesson categories
  const lessonCounts: Record<string, number> = {};
  for (const l of ls){ const cat = l && l.lessonCategory ? String(l.lessonCategory) : 'NEUTRAL'; lessonCounts[cat] = (lessonCounts[cat]||0)+1; }
  if (lessonCounts['CONFIDENCE_TOO_HIGH']) suggestedFocusAreas.push('Reduce overconfidence on flagged trades');
  if (lessonCounts['CONFIDENCE_TOO_LOW']) suggestedFocusAreas.push('Increase conviction or review signal strength');
  if (lessonCounts['RISK_TOO_AGGRESSIVE']) suggestedFocusAreas.push('Tighten risk controls for flagged cases');

  // Confidence and risk recommendations
  const confidenceRecommendation = (pf && typeof pf.recommendedConfidenceBias === 'number') ? pf.recommendedConfidenceBias : (ls.reduce((s:any,x:any)=> s + (typeof x.suggestedConfidenceAdjustment === 'number' ? x.suggestedConfidenceAdjustment : 0),0) / (ls.filter((x:any)=> typeof x.suggestedConfidenceAdjustment === 'number').length || 1));
  const riskRecommendation = (pf && typeof pf.recommendedRiskBias === 'number') ? pf.recommendedRiskBias : (ls.reduce((s:any,x:any)=> s + (typeof x.suggestedRiskAdjustment === 'number' ? x.suggestedRiskAdjustment : 0),0) / (ls.filter((x:any)=> typeof x.suggestedRiskAdjustment === 'number').length || 1));

  // Readiness score: combine winRate (60%), confidenceAccuracy (30%), add small base (10%), adjust for riskRecommendation
  const base = 10;
  let riskPenalty = 0;
  if (typeof riskRecommendation === 'number'){
    if (riskRecommendation < -0.05) riskPenalty = 10; // large negative risk suggest reduces readiness
    else if (riskRecommendation > 0.05) riskPenalty = -5; // positive risk tolerance improvement
  }
  let readiness = Math.round(winRate * 60 + confAcc * 30 + base - riskPenalty);
  readiness = Math.max(0, Math.min(100, readiness));

  // Next improvement: deterministic suggestion
  let nextImprovement = 'Maintain current approach';
  if (readiness < 40) nextImprovement = 'Immediate review: recalibrate signals and tighten risk controls';
  else if (readiness < 70) nextImprovement = 'Focus on confidence calibration and targeted risk tuning';
  else nextImprovement = 'Incremental optimization: fine-tune confidence bias and monitor';

  return {
    cycleId,
    generatedAt,
    executiveSummary,
    strengths,
    weaknesses,
    suggestedFocusAreas,
    confidenceRecommendation,
    riskRecommendation,
    readinessScore: readiness,
    nextImprovement
  } as const;
}

// Pure deterministic Adaptive Decision Context builder
export function buildAdaptiveDecisionContext(performanceProfile: any, victorReview: any){
  const pf = performanceProfile || {};
  const vr = victorReview || {};

  const confidenceRecommendation = typeof vr.confidenceRecommendation === 'number' ? vr.confidenceRecommendation : (typeof pf.recommendedConfidenceBias === 'number' ? pf.recommendedConfidenceBias : 0);
  const riskRecommendation = typeof vr.riskRecommendation === 'number' ? vr.riskRecommendation : (typeof pf.recommendedRiskBias === 'number' ? pf.recommendedRiskBias : 0);

  const lessonBreakdown = pf.lessonBreakdown && typeof pf.lessonBreakdown === 'object' ? pf.lessonBreakdown as Record<string, number> : (pf.lessonBreakdown || {});
  const preferredLessonCategories: string[] = [];
  const avoidLessonCategories: string[] = [];
  for (const k of Object.keys(lessonBreakdown)){
    const count = Number(lessonBreakdown[k] || 0);
    if (count <= 0) continue;
    if (k === 'CORRECT_DECISION') preferredLessonCategories.push(k);
    if (k === 'CONFIDENCE_TOO_HIGH' || k === 'CONFIDENCE_TOO_LOW' || k === 'RISK_TOO_AGGRESSIVE' || k === 'RISK_TOO_CONSERVATIVE') avoidLessonCategories.push(k);
  }

  const currentStrengths = Array.isArray(vr.strengths) ? vr.strengths.slice() : [];
  const currentWeaknesses = Array.isArray(vr.weaknesses) ? vr.weaknesses.slice() : [];
  const focusAreas = Array.isArray(vr.suggestedFocusAreas) ? vr.suggestedFocusAreas.slice() : [];

  const reviewSummary = typeof vr.executiveSummary === 'string' ? vr.executiveSummary : (pf && pf.summary ? String(pf.summary) : 'No summary available');

  const generatedAt = vr.generatedAt || (pf && pf.generatedAt) || 'unknown';

  // Determine simple biases based on inputs (pure deterministic)
  let confidenceBias = 0;
  if (typeof confidenceRecommendation === 'number') confidenceBias = confidenceRecommendation;
  else if (pf && typeof pf.winRate === 'number'){
    if (pf.winRate > 0.6) confidenceBias = 2; else if (pf.winRate < 0.4) confidenceBias = -5; else confidenceBias = 0;
  }

  let riskBias = 0;
  if (typeof riskRecommendation === 'number') riskBias = riskRecommendation;
  else if (vr && typeof vr.readinessScore === 'number'){
    if (vr.readinessScore > 70) riskBias = 0.02; else if (vr.readinessScore < 40) riskBias = -0.05; else riskBias = 0;
  }

  return {
    confidenceBias,
    riskBias,
    preferredLessonCategories,
    avoidLessonCategories,
    currentStrengths,
    currentWeaknesses,
    focusAreas,
    reviewSummary,
    generatedAt
  } as const;
}

// Pure deterministic Cycle Intelligence Snapshot builder
export function buildCycleIntelligenceSnapshot(decisionSummary: import('./types').DecisionSummary | null, victorReview: any, adaptiveDecisionContext: any){
  const ds = decisionSummary || ({} as import('./types').DecisionSummary);
  const vr = victorReview || {};
  const ac = adaptiveDecisionContext || {};

  const cycleId = ds.cycleId || (vr && vr.cycleId) || 'unknown';
  const generatedAt = (vr && vr.generatedAt) || (ds && ds.timestamp) || (ac && ac.generatedAt) || null;

  const readinessScore = typeof vr.readinessScore === 'number' ? vr.readinessScore : (typeof ac.readinessScore === 'number' ? ac.readinessScore : (typeof vr.readiness === 'number' ? vr.readiness : 0));

  const headline = readinessScore >= 70 ? 'Cycle performing well' : (readinessScore < 40 ? 'Immediate review recommended' : 'Mixed signals — targeted improvements');

  const confidenceState = vr && typeof vr.confidenceRecommendation === 'number' ? `Bias ${vr.confidenceRecommendation}` : (ac && typeof ac.confidenceBias === 'number' ? `Bias ${ac.confidenceBias}` : 'Neutral');
  const riskState = ac && typeof ac.riskBias === 'number' ? (ac.riskBias > 0 ? `Risk tolerant (+${ac.riskBias})` : (ac.riskBias < 0 ? `Risk conservative (${ac.riskBias})` : 'Risk neutral')) : 'Risk unknown';
  const marketState = ds && ds.marketSession && typeof ds.marketSession.marketOpen === 'boolean' ? (ds.marketSession.marketOpen ? 'Market open' : 'Market closed') : 'Market state unknown';

  const strongestInsight = (vr && Array.isArray(vr.strengths) && vr.strengths.length) ? vr.strengths[0] : ((ac && Array.isArray(ac.preferredLessonCategories) && ac.preferredLessonCategories.length) ? ac.preferredLessonCategories[0] : 'No clear insight');
  const biggestWeakness = (vr && Array.isArray(vr.weaknesses) && vr.weaknesses.length) ? vr.weaknesses[0] : ((ac && Array.isArray(ac.currentWeaknesses) && ac.currentWeaknesses.length) ? ac.currentWeaknesses[0] : 'No major weakness');
  const nextPriority = (vr && vr.nextImprovement) ? vr.nextImprovement : ((vr && Array.isArray(vr.suggestedFocusAreas) && vr.suggestedFocusAreas.length) ? vr.suggestedFocusAreas[0] : ((ac && Array.isArray(ac.focusAreas) && ac.focusAreas.length) ? ac.focusAreas[0] : 'Monitor and iterate'));

  return {
    cycleId,
    generatedAt,
    headline,
    confidenceState,
    riskState,
    marketState,
    strongestInsight,
    biggestWeakness,
    nextPriority,
    readinessScore
  } as const;
}

// Apply adaptive confidence policy: deterministic, clamps to 0-100, max adjustment +/-10
export function applyAdaptiveConfidencePolicy(originalConfidence: number, adaptiveDecisionContext: any){
  // Validate originalConfidence
  let orig = typeof originalConfidence === 'number' && !Number.isNaN(originalConfidence) ? originalConfidence : 0;
  // Extract bias from adaptiveDecisionContext
  const bias = (adaptiveDecisionContext && typeof adaptiveDecisionContext.confidenceBias === 'number') ? Number(adaptiveDecisionContext.confidenceBias) : 0;
  // Limit bias to +/-10 per requirement
  const limitedBias = Math.max(-10, Math.min(10, bias));
  // Apply bias (additive percentage points)
  let adjusted = orig + limitedBias;
  // Clamp to 0-100
  adjusted = Math.max(0, Math.min(100, adjusted));
  // Round to 2 decimal places for determinism
  adjusted = Math.round(adjusted * 100) / 100;
  return adjusted;
}

// Start autonomous scheduler lazily once on module initialization in non-test environments.
// Tests may control scheduler manually (NODE_ENV=test).
try{
  // Always ensure the global singleton references the current run implementation so hot-reload
  // can swap the callback without creating duplicate timers.
  try{ getGlobalScheduler().runTick = runAutomaticCycleImplementation; }catch(_){ }
  // Start in-memory scheduler only when explicitly enabled via env.
  // Default: do not start automatically unless running non-test and mode set to "in_memory".
  if (process.env.NODE_ENV !== 'test' && process.env.PAPER_TRADER_SCHEDULER_MODE === 'in_memory'){
    startAutonomousScheduler();
  }
}catch(e){}

export default { getPaperTradingState, runManualPaperTradingCycle, setPaperTradingEnabled, getPerformanceSummary, getPerformanceProfile };
