import {
  PaperTradeDecision,
  PaperTraderConfig,
  PortfolioAdapter,
  AuditStore,
  Clock,
  IdGenerator,
  SimulatedExecution,
  AuditEntry,
  DecisionResult,
  CycleResult,
  Portfolio,
} from './types';

const DEFAULTS: Required<Pick<PaperTraderConfig, 'enabled' | 'minimumBuyConfidence' | 'minimumSellConfidence' | 'maxPositionPercent' | 'maxOrderValueSek' | 'feesBps' | 'slippageBps' | 'cooldownMs' | 'maxTradesPerCycle'>> = {
  enabled: false,
  minimumBuyConfidence: 72,
  minimumSellConfidence: 78,
  maxPositionPercent: 0.10,
  maxOrderValueSek: 25_000,
  feesBps: 10, // 0.10%
  slippageBps: 5, // 0.05%
  cooldownMs: 60_000,
  maxTradesPerCycle: 2,
};

function toIso(d: Date){ return d.toISOString(); }

function round2(n: number){ return Math.round(n * 100) / 100; }

class InMemoryAudit implements AuditStore {
  private entries: AuditEntry[] = [];
  async append(entry: AuditEntry){ this.entries.push(entry); }
  async list(){ return this.entries.slice(); }
}

export function createPaperTrader(opts: {
  portfolioAdapter: PortfolioAdapter;
  auditStore?: AuditStore;
  clock?: Clock;
  idGenerator?: IdGenerator;
  config?: PaperTraderConfig;
}){
  const portfolioAdapter = opts.portfolioAdapter;
  const auditStore = opts.auditStore || new InMemoryAudit();
  const clock: Clock = opts.clock || { now: () => new Date() };
  const idGen: IdGenerator = opts.idGenerator || { next: (p?:string) => `${p||'id'}_${Date.now()}` };
  const cfg: Required<typeof DEFAULTS> = { ...DEFAULTS, ...(opts.config||{}) } as any;

  const locks = new Map<string, boolean>();
  const cooldowns = new Map<string, number>();

  async function appendAudit(e: Omit<AuditEntry,'id'|'timestamp'>){
    // Deep-clone the payload to create an immutable snapshot
    let payload: any;
    try{ payload = JSON.parse(JSON.stringify(e)); }catch(_){ payload = { ...e }; }
    const entry: AuditEntry = { id: idGen.next('audit'), timestamp: toIso(clock.now()), ...payload };
    await auditStore.append(entry);
    return entry;
  }

  function keyFor(d: PaperTradeDecision){ return `${d.symbol}:${d.action}`; }

  async function handleDecision(decision: PaperTradeDecision): Promise<DecisionResult>{
    // log received
    await appendAudit({ kind: 'RECEIVED', decision });

    // 1. GLOBAL_DISABLED
    if (!cfg.enabled && (decision.action === 'BUY' || decision.action === 'SELL')){
      const reason = { code: 'GLOBAL_DISABLED', message: 'Paper trader disabled' };
      await appendAudit({ kind: 'REJECT', decision, reason });
      return { accepted: false, code: reason.code, message: reason.message };
    }

    // 2. VALIDATION
    if (!decision.symbol || typeof decision.symbol !== 'string'){
      const reason = { code: 'INVALID_SYMBOL', message: 'Invalid symbol' };
      await appendAudit({ kind: 'REJECT', decision, reason });
      return { accepted: false, code: reason.code, message: reason.message };
    }
    if (typeof decision.confidence !== 'number' || decision.confidence < 0 || decision.confidence > 100){
      const reason = { code: 'INVALID_CONFIDENCE', message: 'Confidence must be 0-100' };
      await appendAudit({ kind: 'REJECT', decision, reason });
      return { accepted: false, code: reason.code, message: reason.message };
    }
    if (typeof decision.referencePrice !== 'number' || decision.referencePrice <= 0){
      const reason = { code: 'INVALID_PRICE', message: 'referencePrice must be > 0' };
      await appendAudit({ kind: 'REJECT', decision, reason });
      return { accepted: false, code: reason.code, message: reason.message };
    }
    if (!['BUY','SELL','HOLD'].includes(decision.action)){
      const reason = { code: 'INVALID_ACTION', message: 'Invalid action' };
      await appendAudit({ kind: 'REJECT', decision, reason });
      return { accepted: false, code: reason.code, message: reason.message };
    }

    // 3. HOLD
    if (decision.action === 'HOLD'){
      await appendAudit({ kind: 'HOLD', decision });
      return { accepted: false, code: 'HOLD', message: 'Hold logged', execution: null };
    }

    // 4. CONFIDENCE
    if (decision.action === 'BUY' && decision.confidence < cfg.minimumBuyConfidence){
      const reason = { code: 'LOW_CONFIDENCE', message: 'Buy below threshold' };
      await appendAudit({ kind: 'REJECT', decision, reason });
      return { accepted: false, code: reason.code, message: reason.message };
    }
    if (decision.action === 'SELL' && decision.confidence < cfg.minimumSellConfidence){
      const reason = { code: 'LOW_CONFIDENCE', message: 'Sell below threshold' };
      await appendAudit({ kind: 'REJECT', decision, reason });
      return { accepted: false, code: reason.code, message: reason.message };
    }

    const k = keyFor(decision);

    // 5. IN_FLIGHT_LOCK
    if (locks.get(k)){
      const reason = { code: 'IN_FLIGHT', message: 'Execution in flight for symbol' };
      await appendAudit({ kind: 'REJECT', decision, reason });
      return { accepted: false, code: reason.code, message: reason.message };
    }

    // 6. COOLDOWN/DEDUPE
    const last = cooldowns.get(k) || 0;
    const nowMs = clock.now().getTime();
    if (nowMs - last < cfg.cooldownMs){
      const reason = { code: 'COOLDOWN', message: 'Decision within cooldown window' };
      await appendAudit({ kind: 'REJECT', decision, reason });
      return { accepted: false, code: reason.code, message: reason.message };
    }

    // pre-read portfolio
    const before = await portfolioAdapter.getPortfolio();
    const existing = before.holdings.find(h => h.symbol.toUpperCase() === decision.symbol.toUpperCase());
    const existingMarketValue = existing ? existing.marketValue : 0;
    const totalValue = before.totalValue;

    // 7. ORDERSTORLEK (deterministic)
    const requested = typeof decision.requestedNotionalSek === 'number' && decision.requestedNotionalSek > 0 ? decision.requestedNotionalSek : cfg.maxOrderValueSek;
    // If a caller explicitly requested a notional larger than available cash, reject early
    if (typeof decision.requestedNotionalSek === 'number' && decision.requestedNotionalSek > 0 && decision.requestedNotionalSek > before.availableCash){
      const reason = { code: 'INSUFFICIENT_CASH', message: 'Requested notional exceeds available cash' };
      await appendAudit({ kind: 'REJECT', decision, reason, portfolioBefore: before });
      return { accepted: false, code: reason.code, message: reason.message };
    }
    // cap by maxOrderValue
    let notional = Math.min(requested, cfg.maxOrderValueSek);

    // cap by position remaining
    const positionCap = totalValue * cfg.maxPositionPercent;
    const remainingCap = Math.max(0, positionCap - existingMarketValue);
    notional = Math.min(notional, remainingCap);

    // compute deterministic execution price
    const slippageFactor = cfg.slippageBps / 10000;
    let execPrice = decision.referencePrice;
    if (decision.action === 'BUY') execPrice = round2(decision.referencePrice * (1 + slippageFactor));
    else execPrice = round2(decision.referencePrice * (1 - slippageFactor));

    // fee estimation
    const fee = round2(notional * (cfg.feesBps / 10000));

    // 7b: CASH check for BUY
    if (decision.action === 'BUY'){
      const affordable = Math.max(0, before.availableCash - fee);
      if (affordable <= 0){
        const reason = { code: 'INSUFFICIENT_CASH', message: 'No available cash' };
        await appendAudit({ kind: 'REJECT', decision, reason, portfolioBefore: before });
        return { accepted: false, code: reason.code, message: reason.message };
      }
      if (notional > affordable) notional = affordable;
    }

    // Recompute quantity
    let qty = Math.floor(notional / execPrice);
    if (decision.action === 'SELL'){
      const heldQty = existing ? existing.quantity : 0;
      if (heldQty <= 0){
        const reason = { code: 'NO_HOLDING', message: 'No holding to sell' };
        await appendAudit({ kind: 'REJECT', decision, reason, portfolioBefore: before });
        return { accepted: false, code: reason.code, message: reason.message };
      }
      // limit quantity by holding
      if (qty <= 0) {
        // if requestedNotional was small, allow selling at least 1 if requested notional > 0
        if (decision.requestedNotionalSek && decision.requestedNotionalSek > 0){
          qty = Math.min(heldQty, Math.max(1, Math.floor(decision.requestedNotionalSek / execPrice)));
        }
      }
      qty = Math.min(heldQty, qty);
    }

    // If final order size is <= 0 -> reject
    if (qty <= 0){
      const reason = { code: 'ORDER_TOO_SMALL', message: 'Computed order quantity is zero' };
      await appendAudit({ kind: 'REJECT', decision, reason, portfolioBefore: before });
      return { accepted: false, code: reason.code, message: reason.message };
    }

    // Check projected position cap again using final notional
    const finalNotional = round2(qty * execPrice);
    const projectedPosition = existingMarketValue + (decision.action === 'BUY' ? finalNotional : -finalNotional);
    if (projectedPosition > positionCap + 0.0001){
      const reason = { code: 'POSITION_LIMIT', message: 'Would exceed position cap' };
      await appendAudit({ kind: 'REJECT', decision, reason, portfolioBefore: before });
      return { accepted: false, code: reason.code, message: reason.message };
    }

    // 9. BUY CASH CHECK already performed above

    // Prepare execution
    const exec: SimulatedExecution = {
      id: idGen.next('exec'),
      decisionId: decision.id,
      symbol: decision.symbol,
      side: decision.action,
      quantity: qty,
      executedPrice: execPrice,
      notional: finalNotional,
      fee: round2(finalNotional * (cfg.feesBps / 10000)),
      generatedAt: toIso(clock.now()),
    };

    // 5b: acquire lock
    locks.set(k, true);
    try{
      // apply execution via adapter
      const beforeSnapshot = before;
      const after = await portfolioAdapter.applyExecution(exec);

      // append audit execution
      const entry = await appendAudit({ kind: 'EXECUTION', decision, execution: exec, portfolioBefore: beforeSnapshot, portfolioAfter: after });
      // set cooldown and count
      cooldowns.set(k, nowMs);
      return { accepted: true, execution: exec };
    }finally{
      locks.delete(k);
    }
  }

  async function runCycle(decisions: PaperTradeDecision[]): Promise<CycleResult>{
    let processed = 0; let executed = 0; let rejects = 0; const entries: AuditEntry[] = [];
    for (const d of decisions){
      if (processed >= decisions.length) break;
      if (executed >= cfg.maxTradesPerCycle){
        // still log remaining as received and reject due to cycle limit
        const reason = { code: 'CYCLE_LIMIT', message: 'Max trades per cycle reached' };
        await appendAudit({ kind: 'REJECT', decision: d, reason });
        rejects++;
        processed++;
        continue;
      }
      const res = await handleDecision(d);
      processed++;
      if (res.accepted){ executed++; }
      else { rejects++; }
    }
    const all = await auditStore.list();
    return { processed, executed, rejects, entries: all };
  }

  async function getAuditEntries(){ return auditStore.list(); }

  function isEnabled(){ return cfg.enabled; }

  return { handleDecision, runCycle, getAuditEntries, isEnabled };
}

export type PaperTrader = ReturnType<typeof createPaperTrader>;

export default createPaperTrader;

// Pure helper: apply an execution deterministically to a portfolio snapshot.
export function applyPaperExecutionToPortfolio(portfolio: Portfolio, exec: SimulatedExecution){
  const state = JSON.parse(JSON.stringify(portfolio)) as any;
  const sym = String(exec.symbol||'').toUpperCase();
  if (exec.side === 'BUY'){
    state.availableCash = Math.round((state.availableCash - exec.notional - exec.fee) * 100)/100;
    const found = state.holdings.find((h:any)=> h.symbol === sym);
    if (found){ found.quantity = Math.round((found.quantity + exec.quantity) * 100)/100; found.currentPrice = exec.executedPrice; found.marketValue = Math.round(found.quantity * found.currentPrice * 100)/100; }
    else { state.holdings.push({ id: `h_${sym}`, symbol: sym, name: sym, quantity: exec.quantity, averagePrice: exec.executedPrice, currentPrice: exec.executedPrice, marketValue: Math.round(exec.quantity * exec.executedPrice * 100)/100 }); }
  } else {
    const found = state.holdings.find((h:any)=> h.symbol === sym);
    const sellQty = Math.min(found ? found.quantity : 0, exec.quantity);
    const proceeds = Math.round(sellQty * exec.executedPrice * 100)/100;
    state.availableCash = Math.round((state.availableCash + proceeds - exec.fee) * 100)/100;
    if (found){ found.quantity = Math.round((found.quantity - sellQty) * 100)/100; found.currentPrice = exec.executedPrice; found.marketValue = Math.round(found.quantity * found.currentPrice * 100)/100; if(found.quantity<=0) state.holdings = state.holdings.filter((h:any)=> h!==found); }
  }
  const mv = state.holdings.reduce((s:any,h:any)=> s + (h.marketValue||0), 0);
  state.totalValue = Math.round((state.availableCash + mv) * 100)/100;
  return state as Portfolio;
}
