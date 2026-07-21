const _so = 'server' + '-only';
void import(_so).catch(()=>{});

import { TwelveDataMarketDataProvider } from './market-providers';
import { AtlasPaperBrokerProvider } from './broker-providers';
import { TRADABLE_UNIVERSE } from './tradable-universe';
import { VictorTradingMandate, VictorTradeDecision, DEFAULT_PAPER_AUTO_MANDATE, VictorTradingMode } from './victor-types';
import fs from 'fs/promises';
import path from 'path';

const AUDIT_PATH = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');

function nowIso(){ return new Date().toISOString(); }

function deterministicDecisionForQuote(instrumentId: string, quote: any): VictorTradeDecision {
  const change = quote.changePercent ?? 0;
  const generatedAt = nowIso();
  if (change >= 1.0) return { instrumentId, action: 'SELL', confidence: Math.min(0.99, 0.5 + Math.abs(change)/10), thesis: 'Price up; trim exposure', signals: ['price_up'], risks: [], timeHorizon: 'SWING', generatedAt };
  if (change <= -1.0) return { instrumentId, action: 'BUY', confidence: Math.min(0.99, 0.5 + Math.abs(change)/10), thesis: 'Price down; opportunity', signals: ['price_drop'], risks: [], timeHorizon: 'SWING', generatedAt };
  return { instrumentId, action: 'HOLD', confidence: 0.5, thesis: 'No clear signal', signals: [], risks: [], timeHorizon: 'SWING', generatedAt };
}

async function appendAudit(entry: any){
  try{
    let arr: any[] = [];
    try{ const raw = await fs.readFile(AUDIT_PATH, 'utf-8'); arr = JSON.parse(raw) || []; }catch(e){ arr = []; }
    arr.push(entry);
    await fs.writeFile(AUDIT_PATH, JSON.stringify(arr, null, 2), 'utf-8');
  }catch(e){ console.error('Failed to write audit log', e); }
}

// Helper: count successful executed trades in audit file for local calendar day of `now`
export async function countSuccessfulExecutionsToday(now: Date = new Date()): Promise<number>{
  try{
    const raw = await fs.readFile(AUDIT_PATH, 'utf-8');
    const arr = JSON.parse(raw) || [];
    let count = 0;
    for (const a of arr){
      if (!a || !a.timestamp) continue;
      const ts = new Date(a.timestamp);
      if (isNaN(ts.getTime())) continue;
      // ignore future timestamps
      if (ts.getTime() > now.getTime()) continue;
      if (ts.getFullYear() !== now.getFullYear() || ts.getMonth() !== now.getMonth() || ts.getDate() !== now.getDate()) continue;
      // a.executed is expected to be an array of { proposal, result }
      if (!Array.isArray(a.executed)) continue;
      for (const e of a.executed){
        if (e && e.result && e.result.status === 'EXECUTED') count++;
      }
    }
    return count;
  }catch(e){ return 0; }
}

export type VictorTradingRunResult = { ok: boolean; report: any };

export async function runVictorTradingCycle(opts: { mandate?: VictorTradingMandate; trigger: 'MANUAL' | 'SCHEDULED' }) : Promise<VictorTradingRunResult> {
  let mandate = opts.mandate || DEFAULT_PAPER_AUTO_MANDATE;
  // Normalisera `maxPositionPercent` så både "10" (procentsats) och "0.10" (decimal)
  // behandlas som 10% internt.
  if (typeof mandate.maxPositionPercent === 'number' && mandate.maxPositionPercent > 1) {
    mandate = { ...mandate, maxPositionPercent: mandate.maxPositionPercent / 100 };
  }
  // Block live modes
  if (mandate.mode === 'LIVE_MANUAL' || mandate.mode === 'LIVE_AUTO') throw new Error('Live trading is not enabled');

  // Prepare providers
  const md = new TwelveDataMarketDataProvider();
  const broker = new AtlasPaperBrokerProvider();

  const account = await broker.getAccount();
  const positions = await broker.getPositions();

  // Fetch market data for allowed instruments
  const allowed = TRADABLE_UNIVERSE.filter(i => mandate.allowedInstrumentIds.includes(i.id) && i.enabled);
  const symbols = allowed.map(i => i.providerSymbol || i.name);
  const quotes = await md.getQuotes(symbols);

  // Map symbol->instrumentId
  const quoteMap = new Map<string, any>();
  for (const q of quotes) quoteMap.set(q.symbol.toUpperCase(), q);

  // Build decisions
  const decisions: VictorTradeDecision[] = [];
  for (const inst of allowed){
    const symbol = (inst.providerSymbol || inst.name).toUpperCase();
    const q = quoteMap.get(symbol);
    if (!q){
      // mark as stale
      decisions.push({ instrumentId: inst.id, action: 'HOLD', confidence: 0, thesis: 'No quote', signals: [], risks: ['stale_data'], timeHorizon: 'SWING', generatedAt: nowIso() });
      continue;
    }
    const d = deterministicDecisionForQuote(inst.id, q);
    decisions.push(d);
  }

  // Validate and create orders
  const orderProposals: any[] = [];
  let executed: any[] = [];

  // restriction counters
  let tradesThisCycle = 0;

  // Count successful trades from previous audit entries once before starting cycle
  const successfulTradesToday = await countSuccessfulExecutionsToday();
  let successfulTradesThisCycle = 0;

  for (const dec of decisions){
    if (dec.action === 'HOLD') continue;
    if (!mandate.allowedInstrumentIds.includes(dec.instrumentId)) continue;
    if (tradesThisCycle >= mandate.maxTradesPerCycle) break;
    // find instrument config
    const inst = TRADABLE_UNIVERSE.find(i=>i.id===dec.instrumentId)!;
    if (!inst) continue;
    const symbol = (inst.providerSymbol || inst.name).toUpperCase();
    const q = quoteMap.get(symbol);
    if (!q) continue;
    // compute order value: use mandate.maxOrderValueSek as cap and simple rule
    const orderValueSek = Math.min(mandate.maxOrderValueSek, Math.max(500, Math.round((dec.confidence || 0.6) * mandate.maxOrderValueSek)));
    if (orderValueSek < 500) continue;
    // build request
    const qty = Math.floor(orderValueSek / q.price) || 1;
    if (qty <= 0) continue;
    const req = {
      instrumentId: inst.id,
      symbol: symbol,
      side: dec.action === 'BUY' ? 'BUY' : 'SELL',
      quantity: qty,
      orderType: 'MARKET'
    };
    orderProposals.push({ decision: dec, request: req });
    // execute if PAPER_AUTO and allowed
    if (mandate.mode === 'PAPER_AUTO'){
      // check daily limit BEFORE placing order using previously-counted successfulTradesToday
      try{
        const limit = mandate.maxTradesPerDay;
        if (typeof limit === 'number' && isFinite(limit) && limit > 0){
          if (successfulTradesToday + successfulTradesThisCycle >= limit){
            const auditEntry = {
              timestamp: nowIso(),
              mode: mandate.mode,
              mandate,
              account,
              positions,
              decisions: [dec],
              proposals: [req],
              executed: [],
              reason: { code: 'MAX_TRADES_PER_DAY_REACHED', message: 'Max trades per day reached', current: successfulTradesToday + successfulTradesThisCycle, limit }
            };
            await appendAudit(auditEntry);
            continue;
          }
        }
      }catch(e){ /* best-effort, fall through */ }

      const res = await broker.placeOrder(req as any);
      executed.push({ proposal: req, result: res });
      // increase local successful counter only when broker reports explicit EXECUTED status
      try{
        if (res && res.status === 'EXECUTED'){
          successfulTradesThisCycle++;
        }
      }catch(e){ }
    }
    tradesThisCycle++;
  }

  const audit = {
    timestamp: nowIso(),
    mode: mandate.mode,
    mandate,
    account,
    positions,
    decisions,
    proposals: orderProposals,
    executed,
  };
  await appendAudit(audit);

  return { ok: true, report: { audit } };
}
