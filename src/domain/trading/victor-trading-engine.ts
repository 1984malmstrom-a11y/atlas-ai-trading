const _so = 'server' + '-only';
void import(_so).catch(()=>{});

import { TwelveDataMarketDataProvider } from './market-providers';
import { AtlasPaperBrokerProvider } from './broker-providers';
import { TRADABLE_UNIVERSE } from './tradable-universe';
import { VictorTradingMandate, VictorTradeDecision, DEFAULT_PAPER_AUTO_MANDATE, VictorTradingMode } from './victor-types';
import fs from 'fs/promises';
import path from 'path';
import { canExecuteForexOrder } from '../../lib/forex-market';
import { resolveCurrencyToSekRate, resolveForexPriceSek, FxSekConversionResult } from '../../lib/market-data/fx-conversion';

const AUDIT_PATH = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');

function nowIso(){ return new Date().toISOString(); }

function deterministicDecisionForQuote(instrumentId: string, quote: any): VictorTradeDecision {
  const change = quote.changePercent ?? 0;
  const generatedAt = nowIso();
  const conf = Math.min(0.99, 0.5 + Math.abs(change)/10);
  // Do NOT derive expectedReturnPercent from confidence. Use an explicit value from upstream analysis (quote.expectedReturnPercent) if provided.
  const explicitExp = typeof (quote && (quote as any).expectedReturnPercent) === 'number' && Number.isFinite((quote as any).expectedReturnPercent) ? Number((quote as any).expectedReturnPercent) : undefined;
  if (change >= 1.0) return { instrumentId, action: 'SELL', confidence: conf, expectedReturnPercent: explicitExp, thesis: 'Price up; trim exposure', signals: ['price_up'], risks: [], timeHorizon: 'SWING', generatedAt };
  if (change <= -1.0) return { instrumentId, action: 'BUY', confidence: conf, expectedReturnPercent: explicitExp, thesis: 'Price down; opportunity', signals: ['price_drop'], risks: [], timeHorizon: 'SWING', generatedAt };
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

  // Freshness threshold for quotes (ms) — shared for all markets
  const FRESH_MS = 2 * 60 * 1000; // 2 minutes

  // Prepare providers
  const md = new TwelveDataMarketDataProvider();
  const broker = new AtlasPaperBrokerProvider();

  // Auto-select market to analyze based on open markets.
  // If caller provided an explicit mandate that differs from the default, respect it.
  const shouldAutoSelect = (()=>{
    if (!opts.mandate) return true;
    try{
      // If mandate appears to be the DEFAULT_PAPER_AUTO_MANDATE (same mode and same allowedInstrumentIds), treat it as implicit and allow auto-selection.
      const sameMode = opts.mandate.mode === DEFAULT_PAPER_AUTO_MANDATE.mode;
      const sameIds = Array.isArray(opts.mandate.allowedInstrumentIds) && Array.isArray(DEFAULT_PAPER_AUTO_MANDATE.allowedInstrumentIds) && opts.mandate.allowedInstrumentIds.length === DEFAULT_PAPER_AUTO_MANDATE.allowedInstrumentIds.length && opts.mandate.allowedInstrumentIds.every((v,i)=>v === DEFAULT_PAPER_AUTO_MANDATE.allowedInstrumentIds[i]);
      return sameMode && sameIds;
    }catch(e){ return false; }
  })();
  if (shouldAutoSelect){
    try{
    const now = new Date();

    // Helper: Stockholm-local time parts
    const stockholmParts = (()=>{
      try{
        const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour12:false, hour: '2-digit', minute: '2-digit', weekday: 'short' });
        const parts = f.formatToParts(now).reduce((acc: any,p:any)=>{ acc[p.type]=p.value; return acc; }, {});
        return { hour: Number(parts.hour), minute: Number(parts.minute), weekday: String(parts.weekday) };
      }catch(e){ return null; }
    })();

    // US open logic (unchanged): New York hours
    const etParts = (()=>{
      try{
        const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12:false, hour: '2-digit', minute: '2-digit' });
        const parts = f.formatToParts(now).reduce((acc: any,p:any)=>{ acc[p.type]=p.value; return acc; }, {});
        return { hour: Number(parts.hour), minute: Number(parts.minute) };
      }catch(e){ return null; }
    })();
    const isWeekdayInNY = (d:Date)=>{ const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday:'short' }).format(d); return !['Sat','Sun'].includes(wd); };
    const isUSOpen = (()=>{
      if (!etParts || !isWeekdayInNY(now)) return false;
      const minutes = etParts.hour*60 + etParts.minute; const open = 9*60+30; const close = 16*60;
      return minutes >= open && minutes < close;
    })();

    // Determine Stockholm weekend/rollover for Forex
    const isStockholmWeekend = (()=>{ if (!stockholmParts) return false; return ['Sat','Sun'].includes(String(stockholmParts.weekday)); })();
    const isForexLocalRollover = (()=>{ if (!stockholmParts) return false; return Number(stockholmParts.hour) === 23; })();

    let selectedMarket = 'None';
    if (isUSOpen){
      selectedMarket = 'US Stocks';
      const usIds = TRADABLE_UNIVERSE.filter(i => i.enabled && (String(i.exchange).toUpperCase().includes('NASDAQ') || String(i.exchange).toUpperCase().includes('NYSE'))).map(i=>i.id);
      if (usIds.length) mandate = { ...mandate, allowedInstrumentIds: usIds };
    } else {
      // Consider Forex only if not weekend and not during the 23:00-00:00 Stockholm rollover
      const considerForex = !isStockholmWeekend && !isForexLocalRollover;
      if (considerForex){
        // Fetch FX quotes and require at least one fresh quote to consider FX as active market
        const fxInstruments = TRADABLE_UNIVERSE.filter(i => i.enabled && String(i.exchange).toUpperCase() === 'FOREX');
        const fxIds = fxInstruments.map(i=>i.id);
        if (fxIds.length){
          const fxSymbols = fxInstruments.map(i => i.providerSymbol || i.name);
          try{
            const fxQuotes = await md.getQuotes(fxSymbols);
            const freshFx = fxQuotes.filter(q => {
              if (!q || q.isStale || !q.timestamp) return false;
              const ts = new Date(q.timestamp).getTime();
              if (isNaN(ts)) return false;
              const ageMs = Date.now() - ts;
              return ageMs >= 0 && ageMs <= FRESH_MS;
            });
            if (freshFx.length > 0){
              selectedMarket = 'Forex';
              // map fresh symbols back to ids
              const symToId = new Map<string,string>();
              for (const inst of fxInstruments) symToId.set((inst.providerSymbol||inst.name).toUpperCase(), inst.id);
              const freshIds = freshFx.map(fq => symToId.get(fq.symbol.toUpperCase())).filter(Boolean) as string[];
              if (freshIds.length) mandate = { ...mandate, allowedInstrumentIds: freshIds };
            }
          }catch(e){ /* ignore and fall through to crypto */ }
        }
      }

      // If no market chosen yet, fall back to Crypto
      if (selectedMarket === 'None'){
        const cryptoInstruments = TRADABLE_UNIVERSE.filter(i => i.enabled && String(i.exchange).toUpperCase() === 'CRYPTO');
        const cryptoIds = cryptoInstruments.map(i=>i.id);
        if (cryptoIds.length){
          // Fetch crypto quotes and only keep instruments with fresh, non-stale quotes
          const cryptoSymbols = cryptoInstruments.map(i => i.providerSymbol || i.name);
          try{
            const cryptoQuotes = await md.getQuotes(cryptoSymbols);
            const freshCrypto = cryptoQuotes.filter(q => {
              if (!q || q.isStale || !q.timestamp) return false;
              const ts = new Date(q.timestamp).getTime();
              if (isNaN(ts)) return false;
              const ageMs = Date.now() - ts;
              return ageMs >= 0 && ageMs <= FRESH_MS;
            });
            if (freshCrypto.length > 0){
              selectedMarket = 'Crypto';
              const symToId = new Map<string,string>();
              for (const inst of cryptoInstruments) symToId.set((inst.providerSymbol||inst.name).toUpperCase(), inst.id);
              const freshIds = freshCrypto.map(fq => symToId.get(fq.symbol.toUpperCase())).filter(Boolean) as string[];
              if (freshIds.length) mandate = { ...mandate, allowedInstrumentIds: freshIds };
            } else {
              // No valid crypto quotes — end cycle with HOLD/no_market_data
              console.log('[victor] Crypto selected but no fresh crypto quotes available. Ending cycle.');
              const audit = { timestamp: nowIso(), mode: mandate.mode, mandate, account: await broker.getAccount(), positions: await broker.getPositions(), decisions: [], proposals: [], executed: [], reason: { code: 'NO_MARKET_DATA', message: 'No fresh crypto quotes' } };
              await appendAudit(audit);
              return { ok: true, report: { audit } };
            }
          }catch(e){
            const audit = { timestamp: nowIso(), mode: mandate.mode, mandate, account: await broker.getAccount(), positions: await broker.getPositions(), decisions: [], proposals: [], executed: [], reason: { code: 'MARKET_DATA_ERROR', message: String(e) } };
            await appendAudit(audit);
            return { ok: true, report: { audit } };
          }
        } else {
          console.log('[victor] No crypto market configured. Skipping cycle.');
          const audit = { timestamp: nowIso(), mode: mandate.mode, mandate, account: await broker.getAccount(), positions: await broker.getPositions(), decisions: [], proposals: [], executed: [], note: 'No open market' };
          await appendAudit(audit);
          return { ok: true, report: { audit } };
        }
      }
    }
    console.log('[victor] Selected market:', selectedMarket);
    }catch(e){ console.warn('[victor] market selection failed', e); }
  }

  const account = await broker.getAccount();
  const positions = await broker.getPositions();

  // Fetch market data for allowed instruments
  const allowed = TRADABLE_UNIVERSE.filter(i => mandate.allowedInstrumentIds.includes(i.id) && i.enabled);
  // limit number of symbols to fetch to avoid large batch requests; prefer a small representative set
  const allowedLimited = allowed.slice(0, 3);
  const symbols = allowedLimited.map(i => i.providerSymbol || i.name);
  // Include USD/SEK as conversion dependency when fetching FX universe so conversion helper can use it
  if (allowedLimited.some(i => String(i.exchange).toUpperCase() === 'FOREX')){
    if (!symbols.map(s=>String(s).toUpperCase()).includes('USD/SEK')) symbols.push('USD/SEK');
  }
  console.log('[victor] Selected symbols for this cycle:', symbols.map(s=>String(s)).join(', '));
  const quotes = await md.getQuotes(symbols);

  // Map symbol->instrumentId
  const quoteMap = new Map<string, any>();
  for (const q of quotes) quoteMap.set(q.symbol.toUpperCase(), q);

  // Build per-cycle canonical quote map for conversion helper
  const quotesByCanonicalSymbol: Record<string, any> = {};
  const normalizeCanonicalKey = (s: string | undefined | null) => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  for (const q of quotes){
    const key = q && (q.instrumentId || q.symbol) ? normalizeCanonicalKey(String(q.instrumentId || q.symbol)) : null;
    if (key) quotesByCanonicalSymbol[key] = q;
  }

  // Per-cycle conversion cache by currency
  const currencyToSekByCurrency = new Map<string, FxSekConversionResult>();
  const now = new Date();
  const maxAgeMs = FRESH_MS;
  for (const inst of allowed){
    const qc = String((inst as any).quoteCurrency || inst.currency || 'USD').toUpperCase();
    if (!currencyToSekByCurrency.has(qc)){
      try{
        const conv = resolveCurrencyToSekRate({ currency: qc, quotesByCanonicalSymbol, now, maxAgeMs });
        currencyToSekByCurrency.set(qc, conv);
      }catch(e){ currencyToSekByCurrency.set(qc, { status: 'MISSING_RATE', sourceCurrency: qc, targetCurrency: 'SEK', path: [], isFresh: false, reasons: [String(e)] }); }
    }
  }

  // Build decisions
  const decisions: VictorTradeDecision[] = [];
  for (const inst of allowed){
    const symbol = (inst.providerSymbol || inst.name).toUpperCase();
    const q = quoteMap.get(symbol);
    // Freshness guard: require a valid, non-stale timestamp within FRESH_MS and not in the future
    if (!q || q.isStale || !q.timestamp){
      decisions.push({ instrumentId: inst.id, action: 'HOLD', confidence: 0, thesis: 'No quote', signals: [], risks: ['stale_data'], timeHorizon: 'SWING', generatedAt: nowIso() });
      continue;
    }
    const ts = new Date(q.timestamp).getTime();
    if (isNaN(ts)){
      decisions.push({ instrumentId: inst.id, action: 'HOLD', confidence: 0, thesis: 'Invalid timestamp', signals: [], risks: ['stale_data'], timeHorizon: 'SWING', generatedAt: nowIso() });
      continue;
    }
    const ageMs = Date.now() - ts;
    if (ageMs < 0 || ageMs > FRESH_MS){
      decisions.push({ instrumentId: inst.id, action: 'HOLD', confidence: 0, thesis: 'Stale/future timestamp', signals: [], risks: ['stale_data'], timeHorizon: 'SWING', generatedAt: nowIso() });
      continue;
    }

    // Compute conversion and priceSek for this instrument's quote currency
    const qc = String((inst as any).quoteCurrency || inst.currency || '').toUpperCase();
    const conv = currencyToSekByCurrency.get(qc) || null;
    let priceSekInfo: any = null;
    try{
      priceSekInfo = resolveForexPriceSek({ instrument: inst as any, quote: { price: q.price, marketTimestamp: q.timestamp }, conversion: conv as FxSekConversionResult, now });
      if (priceSekInfo && priceSekInfo.priceSek) q.priceSek = priceSekInfo.priceSek;
    }catch(e){ /* ignore; leave q.priceSek as-is */ }

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
    // Determine SEK-normalized unit price to compute quantity/ notional
    const priceSek = (q && typeof q.priceSek === 'number' && Number.isFinite(q.priceSek) && q.priceSek > 0) ? Number(q.priceSek) : ((q && typeof q.price === 'number' && Number.isFinite(q.price)) ? Number(q.price) : undefined);
    if (!priceSek){
      // Without a SEK-normalized price we cannot compute notional safely — skip
      const auditEntry = { timestamp: nowIso(), mode: mandate.mode, mandate, account, positions, decisions: [dec], proposals: [], executed: [], reason: { code: 'FOREX_NOTIONAL_CONVERSION_UNAVAILABLE', message: 'Missing SEK-normalized price' } };
      await appendAudit(auditEntry);
      continue;
    }
    // build request: allow fractional quantity for FOREX, integer quantities for STOCK
    let qty: number;
    if (String((inst as any).assetType || '').toUpperCase() === 'FOREX'){
      qty = orderValueSek / priceSek; // fractional allowed
    } else {
      qty = Math.floor(orderValueSek / (priceSek || (q && q.price) || 1)) || 1;
    }
    if (qty <= 0) continue;
    const clientId = `o_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    // If this is a BUY, require an explicit finite expectedReturnPercent from Victor's decision; otherwise skip creating a BUY order.
    if (dec.action === 'BUY' && !(typeof dec.expectedReturnPercent === 'number' && Number.isFinite(dec.expectedReturnPercent))) {
      // Skip BUY when Victor did not supply expectedReturnPercent
      tradesThisCycle++;
      continue;
    }

    const req = {
      instrumentId: inst.id,
      symbol: symbol,
      side: dec.action === 'BUY' ? 'BUY' : 'SELL',
      quantity: qty,
      clientOrderId: clientId,
      expectedReturnPercent: typeof dec.expectedReturnPercent === 'number' && Number.isFinite(dec.expectedReturnPercent) ? dec.expectedReturnPercent : undefined,
      price: (q && typeof q.price === 'number') ? Number(q.price) : undefined,
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

      // For FOREX instruments enforce execution gate without changing risk/decision rules
      try{
        if (String((inst as any).assetType || '').toUpperCase() === 'FOREX'){
          const qc = String((inst as any).quoteCurrency || inst.currency || '').toUpperCase();
          const convForInst = currencyToSekByCurrency.get(qc) || null;
          const gate = canExecuteForexOrder({ now, quote: q, instrument: inst, conversion: convForInst as FxSekConversionResult | null });
          if (!gate.allowed){
            executed.push({ proposal: req, result: { status: 'BLOCKED', code: gate.reasons && gate.reasons.length ? gate.reasons[0] : 'FOREX_BLOCKED', reasons: gate.reasons } });
            tradesThisCycle++;
            continue;
          }
        }
      }catch(e){ /* best-effort: if gate fails, block safe */
        executed.push({ proposal: req, result: { status: 'BLOCKED', code: 'FOREX_GATE_ERROR', message: String(e) } });
        tradesThisCycle++;
        continue;
      }

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
