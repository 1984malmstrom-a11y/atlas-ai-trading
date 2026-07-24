import createPaperTrader from './engine';
import { PaperTraderConfig, PaperTradeDecision, SimulatedExecution, AuditEntry } from './types';
import analyzePriceSeries from './technical';
import fs from 'fs';
import path from 'path';

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
      cycleId: e.id || null,
      decisionId: decision && decision.id ? decision.id : null,
      symbol: decision && (decision.symbol || decision.instrumentId) || null,
      action: decision && decision.action ? decision.action : null,
      confidence: decision && typeof decision.confidence === 'number' ? decision.confidence : null,
      referencePrice: decision && typeof decision.referencePrice === 'number' ? decision.referencePrice : null,
      quoteTimestamp: decision && (decision.generatedAt || null),
      risks: decision && (decision.risks || decision.reasoning) || null,
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
  let state = {
    id: 'demo', baseCurrency: 'SEK', totalValue: initialCash, availableCash: initialCash, totalReturnPercent: 0, benchmarkReturnPercent: 0, holdings: [] as any[]
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
      const before = JSON.parse(JSON.stringify(state));
      const sym = exec.symbol.toUpperCase();
      if (exec.side === 'BUY'){
        state.availableCash = Math.round((state.availableCash - exec.notional - exec.fee) * 100)/100;
        let found = state.holdings.find((h:any)=> h.symbol === sym);
        if (found){ found.quantity += exec.quantity; found.currentPrice = exec.executedPrice; found.marketValue = Math.round(found.quantity * found.currentPrice * 100)/100; }
        else { state.holdings.push({ id: `h_${sym}`, symbol: sym, name: sym, assetType: 'Stock', quantity: exec.quantity, averagePrice: exec.executedPrice, currentPrice: exec.executedPrice, marketValue: Math.round(exec.quantity * exec.executedPrice * 100)/100, unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 }); }
      } else {
        const found = state.holdings.find((h:any)=> h.symbol === sym);
        const sellQty = Math.min(found ? found.quantity : 0, exec.quantity);
        const proceeds = Math.round(sellQty * exec.executedPrice * 100)/100;
        state.availableCash = Math.round((state.availableCash + proceeds - exec.fee) * 100)/100;
        if (found){ found.quantity = Math.round((found.quantity - sellQty) * 100)/100; found.currentPrice = exec.executedPrice; found.marketValue = Math.round(found.quantity * found.currentPrice * 100)/100; if(found.quantity<=0) state.holdings = state.holdings.filter((h:any)=> h!==found); }
      }
      const mv = state.holdings.reduce((s:any,h:any)=> s + (h.marketValue||0), 0);
      state.totalValue = Math.round((state.availableCash + mv) * 100)/100;
      // persist after each execution synchronously
      persist();
      return JSON.parse(JSON.stringify(state));
    }
  };
}

// initialize runtime
const AUDIT_PATH = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');
const auditStore = new FileAuditStore(AUDIT_PATH);
const portfolioAdapter = createInMemoryPortfolioAdapter(START_CAPITAL);

// export FileAuditStore for focused tests
export { FileAuditStore };

// --- Test helpers (exported for unit tests) ---
export function __setTestTrader(t:any){
  try{ (runtime as any).trader = t; }catch(e){}
}

export function __setTestPortfolio(adapter:any){
  try{ (runtime as any).portfolioAdapter = adapter; }catch(e){}
}

export async function __appendTestAudits(entries: any[]){
  try{
    for (const e of entries){ await auditStore.append(e); }
  }catch(e){}
}

export async function __clearAudits(){
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

const trader = createPaperTrader({ portfolioAdapter, auditStore, config });

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

const SCHED_KEY = '__atlas_paper_trader_scheduler__';
// Module-scoped scheduler state (avoid cross-module globals)
let moduleScheduler: SchedulerState | null = null;
function getGlobalScheduler(): SchedulerState {
  if (!moduleScheduler){
    moduleScheduler = { timerId: null, inProgress: false, lastRunAt: null, intervalMs: 60_000, runTick: null } as SchedulerState;
  }
  return moduleScheduler;
}
export function getSchedulerState(){ return getGlobalScheduler(); }

// Implementation used as the dynamic runTick that can be swapped on hot-reload
async function runAutomaticCycleImplementation(){
  const sched = getGlobalScheduler();
  if (sched.inProgress) return; // prevent overlap
  sched.inProgress = true;
  // initialize diagnostics
  sched.lastAutomaticRunStatus = null;
  sched.lastAutomaticRunMessage = null;
  sched.lastAutomaticEvaluationCount = null;
  sched.lastAutomaticAuditCountBefore = null;
  sched.lastAutomaticAuditCountAfter = null;

  try{
    // snapshot audit counts before run
    let beforeList: any[] = [];
    try{ beforeList = await auditStore.list(); }catch(_){ beforeList = []; }
    const beforeCount = Array.isArray(beforeList) ? beforeList.length : 0;
    const beforeEvalCount = Array.isArray(beforeList) ? beforeList.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION').length : 0;

    // perform the scheduled cycle; allowWhenScheduler ensures manual guard is bypassed for scheduler
    const res: any = await runManualPaperTradingCycle({ allowWhenScheduler: true });

    // snapshot after run
    let afterList: any[] = [];
    try{ afterList = await auditStore.list(); }catch(_){ afterList = []; }
    const afterCount = Array.isArray(afterList) ? afterList.length : 0;
    const afterEvalCount = Array.isArray(afterList) ? afterList.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION').length : 0;

    // determine evaluationCount: prefer explicit result property if present
    let evalCount: number | null = null;
    try{ if (res && typeof (res as any).evaluationCount === 'number') evalCount = (res as any).evaluationCount; }catch(_){ evalCount = null; }
    if (evalCount === null) evalCount = afterEvalCount - beforeEvalCount;

    // determine status and message
    if (res && res.skipped){
      sched.lastAutomaticRunStatus = 'skipped';
      sched.lastAutomaticRunMessage = res.code || String(res.reason || 'skipped');
    } else {
      sched.lastAutomaticRunStatus = 'success';
      sched.lastAutomaticRunMessage = null;
    }

    sched.lastAutomaticAuditCountBefore = beforeCount;
    sched.lastAutomaticAuditCountAfter = afterCount;
    sched.lastAutomaticEvaluationCount = typeof evalCount === 'number' ? evalCount : null;

  }catch(e:any){
    try{ sched.lastAutomaticRunStatus = 'error'; sched.lastAutomaticRunMessage = String(e && e.message ? e.message : e); }catch(_){ }
  }finally{
    // record finish time and clear inProgress so next interval can run
    try{ sched.lastRunAt = Date.now(); }catch(_){ sched.lastRunAt = null; }
    sched.inProgress = false;
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

export async function runManualPaperTradingCycle(opts?: { allowWhenScheduler?: boolean, overrideUniverse?: { quotes?: any[], portfolio?: any } }){
  // Prevent overlapping with automatic scheduler when called externally
  try{
    const sched = getGlobalScheduler();
    if (sched.inProgress && !opts?.allowWhenScheduler) return { skipped: true, code: 'SCHEDULER_IN_PROGRESS' } as any;
  }catch(e){}

  // Build simple deterministic demo decision set
  const symbols = ['MSFT','NVDA','AAPL','AMZN','GOOGL','META','AMD','TSLA','JPM','XOM'];
  const quotes = opts && opts.overrideUniverse && Array.isArray(opts.overrideUniverse.quotes) ? opts.overrideUniverse.quotes : await fetchQuotes();
  // Plan actions: first evaluate existing holdings, then consider buy candidates
  const candidates: any[] = [];
  let evaluationCount = 0;
  const evaluatedSymbols = new Set<string>();
  // snapshot evaluation count before run so we can compute actual appended evaluations
  let _beforeEvalCount = 0;
  try{ const _beforeList = await auditStore.list(); _beforeEvalCount = Array.isArray(_beforeList) ? _beforeList.filter((a:any)=> a && a.raw && a.raw.kind === 'EVALUATION').length : 0; }catch(_){ _beforeEvalCount = 0; }
  const portfolio = opts && opts.overrideUniverse && opts.overrideUniverse.portfolio ? opts.overrideUniverse.portfolio : await portfolioAdapter.getPortfolio();
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
            const td = await import('../market-data/twelve-data');
            const provider = new td.TwelveDataMarketDataProvider();
            const histP = provider.getHistoricalDailyCloses(sym, 30);
            historicalRequestsBySymbol.set(sym, histP);
          }
          const hist = await historicalRequestsBySymbol.get(sym);
          const techMeta: any = { technicalAnalysisMode: 'observe-only' };
          if (hist && Array.isArray(hist.closes)){
            const analysis = analyzePriceSeries(hist.closes);
            techMeta.technicalAnalysisStatus = 'success';
            techMeta.technicalTrend = analysis.trend;
            techMeta.technicalMomentumPercent = analysis.momentumPercent;
            techMeta.technicalVolatilityPercent = analysis.volatilityPercent;
            techMeta.technicalScore = analysis.technicalScore;
            techMeta.technicalSignal = analysis.signal;
            techMeta.technicalReasons = analysis.reasons;
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

  // use module-scope helpers exported for tests

  // Evaluate existing holdings first
  if (Array.isArray(portfolio.holdings)){
    for (const h of portfolio.holdings){
      const symbol = (h.symbol||'').toUpperCase();
      const q = quotes && Array.isArray(quotes) ? quotes.find((x:any)=> (x.symbol||'').toUpperCase() === symbol) : null;
      const evalRes = evaluateHoldingActionPublic(h,q);
      // count this symbol as evaluated once per cycle (holdings always count)
      if (!evaluatedSymbols.has(symbol)){
        evaluatedSymbols.add(symbol);
        evaluationCount++;
      }
      // Attach centralized technical analysis (observe-only) using historical daily closes
      try{
        const techMeta = await fetchAndAnalyze(symbol);
        try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${symbol}_${Date.now()}`, symbol, action: evalRes.action, confidence: 0, referencePrice: q && (q.priceSek||q.price) || h.currentPrice, generatedAt: nowIso() }, reason: { action: evalRes.action, reason: evalRes.reason, score: evalRes.score }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true, technicalAnalysis: techMeta } } as any); }catch(e){}
      }catch(_){
        try{ await auditStore.append({ kind: 'EVALUATION', decision: { id: `eval_${symbol}_${Date.now()}`, symbol, action: evalRes.action, confidence: 0, referencePrice: q && (q.priceSek||q.price) || h.currentPrice, generatedAt: nowIso() }, reason: { action: evalRes.action, reason: evalRes.reason, score: evalRes.score }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true, technicalAnalysis: { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: 'PROVIDER_ERROR', technicalAnalysisErrorMessage: 'Fetch failed' } } } as any); }catch(_){ }
      }
      if (evalRes.action === 'SELL'){
        plannedSymbols.add(symbol);
        candidates.push({ id: `sell_${symbol}_${Date.now()}`, symbol, action: 'SELL', confidence: 100, referencePrice: q && (q.priceSek||q.price) || h.currentPrice, generatedAt: nowIso(), requestedNotionalSek: Math.round((h.quantity || 0) * (q && (q.priceSek||q.price) || h.currentPrice) || 0) });
      }
    }
  }

  // Now consider buy candidates from symbols list, skip those already planned for sell
  if (quotes && Array.isArray(quotes)){
    for (const s of symbols){
      if (plannedSymbols.has(s)) continue;
      const q = quotes.find((x:any)=> (x.symbol||'').toUpperCase() === s);
      if (!q){
        // record per-symbol quote missing as a REJECT but do not count as evaluation
        try{ await auditStore.append({ kind: 'REJECT', decision: { id: `rej_${s}_${Date.now()}`, symbol: s, action: 'UNKNOWN' }, reason: { code: 'QUOTE_MISSING', message: 'Quote missing for symbol' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
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
        try{ await auditStore.append({ kind: 'REJECT', decision: { id: `rej_${s}_${Date.now()}`, symbol: s, action: 'UNKNOWN' }, reason: { code: 'QUOTE_INVALID', message: 'Invalid price from quote' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any); }catch(_){ }
        continue;
      }

      // Determine buy signal: only buy on dip vs last evaluation for this symbol (prevents random buys)
      // Find last evaluation audit for symbol
      const allAudits = await auditStore.list();
      const lastEval = allAudits.find((a:any)=> a && a.summary && a.summary.decisionId && String(a.summary.decisionId).includes(s.toLowerCase())) || null;
      let buySignal = false; let signalReason = 'No prior evaluation';
      if (lastEval && lastEval.raw && lastEval.raw.decision && typeof lastEval.raw.decision.referencePrice === 'number'){
        const lastRef = Number(lastEval.raw.decision.referencePrice);
        if (usePrice <= lastRef * 0.99){ buySignal = true; signalReason = 'Price dipped 1% vs last reference'; }
      }

      if (buySignal){
        // perform observe-only technical analysis before adding candidate (do not alter buy decision)
        try{
            try{
              const techMeta = await fetchAndAnalyze(s);
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Buy candidate observed', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true, technicalAnalysis: techMeta } } as any); }catch(e){}
            }catch(e:any){
              try{ await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Buy candidate observed', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true, technicalAnalysis: { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) } } } as any); }catch(_){ }
            }
        }catch(e:any){
          // on history error, log unavailable status but continue
          try{ await auditStore.append({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: 'Buy candidate observed', score: 0 }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true, technicalAnalysis: { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) } } } as any); }catch(_){}
        }
        candidates.push({ id: `buy_${s}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, symbol: s, action: 'BUY', confidence: 80, referencePrice: usePrice, generatedAt: nowIso(), reasoning: ['Buy-on-dip'], requestedNotionalSek: 8000 });
      } else {
        // create a lightweight evaluation audit for visibility and attach centralized technical analysis
        try{
          if (!evaluatedSymbols.has(s)){
            evaluatedSymbols.add(s);
            evaluationCount++;
          }
            try{
              const techMeta = await fetchAndAnalyze(s);
              await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: signalReason }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true, technicalAnalysis: techMeta } } as any);
            }catch(e:any){
              await appendEvaluation({ kind: 'EVALUATION', decision: { id: `eval_${s}_${Date.now()}`, symbol: s, action: 'HOLD', confidence: 0, referencePrice: usePrice, generatedAt: nowIso() }, reason: { action: 'HOLD', reason: signalReason }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true, technicalAnalysis: { technicalAnalysisMode: 'observe-only', technicalAnalysisStatus: 'unavailable', technicalAnalysisErrorCode: e && e.code ? e.code : 'PROVIDER_ERROR', technicalAnalysisErrorMessage: e && e.message ? e.message : String(e) } } } as any);
            }
        }catch(e){}
      }
    }
  }

  // If no candidates, produce HOLD
  if (!candidates.length){
    const now = nowIso();
    const hold = { id: `demo_hold_${now}`, symbol: 'NVDA', action: 'HOLD', confidence: 0, referencePrice: 0, generatedAt: now, reasoning: ['Saknar marknadsdata'] };
    runtime.latestDecision = hold as any;
    const res = await runtime.trader.handleDecision(hold as any);
    // NOTE: `processedCandidates` = number of actionable BUY/SELL candidates processed
    runtime.latestCycle = { processedCandidates: 1, executed: 0, rejects: res.accepted?0:1 } as any;
    runtime.latestDecision = hold as any;
    runtime.lastUpdated = nowIso();
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

    // decide whether to attempt execution based on per-cycle limits
    const side = (cand.action || '').toUpperCase();
    const allowExec = (side === 'BUY' && executedBuy < 1) || (side === 'SELL' && executedSell < 1) || (side !== 'BUY' && side !== 'SELL');

    if (!allowExec){
      // append a REJECT audit indicating cycle-level execution limit
      try{
        await auditStore.append({ kind: 'REJECT', decision: cand, reason: { code: 'CYCLE_LIMIT', message: 'Per-cycle execution limit reached' }, portfolioBefore: portfolio, timestamp: nowIso(), meta: { automatic: true } } as any);
      }catch(_){ }
      rejects++;
      // continue to next candidate (do not break)
      continue;
    }

    const res = await runtime.trader.handleDecision(cand as any);
    if (res && res.accepted){
      // record executed side counts but continue processing other symbols
      if (cand.action === 'BUY') executedBuy++;
      if (cand.action === 'SELL') executedSell++;
      executed = executedBuy + executedSell > 0 ? executedBuy + executedSell : executed;
      finalDecision = cand;
      // continue to next candidate (do not break)
      continue;
    }
    // rejected by trader: record and continue
    rejects++;
    continue;
  }

  // NOTE: `processedCandidates` = number of actionable BUY/SELL candidates processed
  runtime.latestCycle = { processedCandidates: processed, executed, rejects } as any;
  runtime.latestDecision = finalDecision || candidates[candidates.length-1];
  runtime.lastUpdated = nowIso();
  // update scheduler last/next when manual (automatic) cycle finishes
  return { ...runtime.latestCycle, evaluationCount };
}

// Helper to ensure every EVALUATION audit includes a technicalAnalysis meta object.
async function appendEvaluation(entry: any){
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
  }catch(_){ /* ignore normalization errors */ }
  return auditStore.append(entry);
}

export async function setPaperTradingEnabled(enabled: boolean){
  runtime.enabled = enabled;
  runtime.trader = createPaperTrader({ portfolioAdapter, auditStore, config: { ...config, enabled } });
  runtime.lastUpdated = nowIso();
}

export async function executePaperTradeDecision(decision: PaperTradeDecision){
  runtime.latestDecision = decision;
  const res = await runtime.trader.handleDecision(decision as any);
  // update lightweight runtime state for observability
  runtime.latestCycle = res && (res as any).accepted ? { processedCandidates: 1, executed: 1, rejects: 0 } : { processedCandidates: 1, executed: 0, rejects: 1 } as any;
  runtime.latestDecision = decision;
  runtime.lastUpdated = nowIso();
  return { result: res, state: await getPaperTradingState() };
}

export { startAutonomousScheduler, stopAutonomousScheduler };

// Start autonomous scheduler lazily once on module initialization in non-test environments.
// Tests may control scheduler manually (NODE_ENV=test).
try{
  // Always ensure the global singleton references the current run implementation so hot-reload
  // can swap the callback without creating duplicate timers.
  try{ getGlobalScheduler().runTick = runAutomaticCycleImplementation; }catch(_){ }
  if (process.env.NODE_ENV !== 'test'){
    startAutonomousScheduler();
  }
}catch(e){}

export default { getPaperTradingState, runManualPaperTradingCycle, setPaperTradingEnabled };
