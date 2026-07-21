import createPaperTrader from './engine';
import { PaperTraderConfig, PaperTradeDecision, SimulatedExecution, AuditEntry } from './types';
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
};

// singleton runtime stored at module scope
const START_CAPITAL = 100000;

function nowIso(){ return new Date().toISOString(); }

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
const auditStore = new InMemoryAuditStore();
const portfolioAdapter = createInMemoryPortfolioAdapter(START_CAPITAL);

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
};

export async function getPaperTradingState(){
  const p = await portfolioAdapter.getPortfolio();
  const audits = await auditStore.list();
  return {
    enabled: runtime.enabled,
    mode: 'PAPER',
    startCapital: runtime.startCapital,
    availableCash: p.availableCash,
    holdings: p.holdings,
    totalValue: p.totalValue,
    totalReturnSek: Math.round((p.totalValue - runtime.startCapital) * 100)/100,
    totalReturnPercent: Math.round(((p.totalValue / runtime.startCapital - 1) * 100) * 100)/100,
    latestDecision: runtime.latestDecision || null,
    latestCycle: runtime.latestCycle || null,
    auditEntries: audits,
    lastUpdated: runtime.lastUpdated,
  };
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

export async function runManualPaperTradingCycle(){
  // Build simple deterministic demo decision set
  const symbols = ['NVDA','MSFT','AAPL'];
  const quotes = await fetchQuotes();
  // pick first available symbol with a valid price
  let decision = null as any;
  if (quotes && Array.isArray(quotes)){
    for (const s of symbols){
      const q = quotes.find((x:any)=> (x.symbol||'').toUpperCase() === s);
      if (q && typeof q.price === 'number' && q.price > 0){
        decision = {
          id: `demo_${s}_${Date.now()}`,
          symbol: s,
          action: 'BUY',
          confidence: 80,
          referencePrice: q.price,
          generatedAt: nowIso(),
          reasoning: [
            'Simulerad Victor-cykel för verifiering av Paper Trader V1.',
            'Positionen hålls inom Atlas riskgräns på 10 %.',
            'Ingen riktig order skickas till marknaden.'
          ],
          requestedNotionalSek: 8000,
        };
        break;
      }
    }
  }

  // If no quotes, produce HOLD decisions for each symbol (first result)
  if (!decision){
    const now = nowIso();
    const hold = { id: `demo_hold_${now}`, symbol: 'NVDA', action: 'HOLD', confidence: 0, referencePrice: 0, generatedAt: now, reasoning: ['Saknar marknadsdata'] };
    runtime.latestDecision = hold as any;
    const res = await runtime.trader.handleDecision(hold as any);
    runtime.latestCycle = { processed: 1, executed: 0, rejects: res.accepted?0:1 };
    runtime.latestDecision = hold as any;
    runtime.lastUpdated = nowIso();
    return runtime.latestCycle;
  }

  runtime.latestDecision = decision;
  const cycle = await runtime.trader.runCycle([decision]);
  runtime.latestCycle = cycle;
  runtime.lastUpdated = nowIso();
  return cycle;
}

export async function setPaperTradingEnabled(enabled: boolean){
  runtime.enabled = enabled;
  runtime.trader = createPaperTrader({ portfolioAdapter, auditStore, config: { ...config, enabled } });
  runtime.lastUpdated = nowIso();
}

export default { getPaperTradingState, runManualPaperTradingCycle, setPaperTradingEnabled };
