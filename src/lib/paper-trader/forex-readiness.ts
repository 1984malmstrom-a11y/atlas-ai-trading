import { STALE_THRESHOLD_MS } from '../market-data/quotes-service';
import { resolveCurrencyToSekRate } from '../market-data/fx-conversion';
import { computeForexSessionStatus } from '../forex-market';

export type ForexReadinessState = {
  sessionStatus: 'OPEN' | 'CLOSED' | 'INVALID_DATE';
  marketDataPairCount: number;
  tradingEnabledPairCount: number;
  quoteReadyCount: number;
  stalePairCount: number;
  unavailablePairCount: number;
  conversionReadyCount: number;
  conversionBlockedCount: number;
  executionReadyCount: number;
  blockedPairCount: number;
  checkedAt: string;
  notionalModel: 'VERIFIED_CONVERSION' | 'MIXED' | 'UNAVAILABLE';
  blockingReasons: Record<string, number>;
};

function normalizeKey(s?: string | null){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g, '_'); }

export function buildForexReadinessState(opts: { now?: Date; instruments?: any[]; quotes?: any[]; maxAgeMs?: number }): ForexReadinessState {
  try{
    const now = opts.now instanceof Date ? opts.now : new Date();
    const instruments = Array.isArray(opts.instruments) ? opts.instruments : [];
    const quotesArr = Array.isArray(opts.quotes) ? opts.quotes : [];
    const maxAge = typeof opts.maxAgeMs === 'number' ? opts.maxAgeMs : (STALE_THRESHOLD_MS || 120_000);

    // Build canonical quote map similar to other modules
    const quotesByCanonical: Record<string, any> = {};
    for (const q of quotesArr){
      try{
        const key = q && (q.instrumentId || q.symbol) ? normalizeKey(String(q.instrumentId || q.symbol)) : null;
        if (key) quotesByCanonical[key] = q;
      }catch(_){ }
    }

    let sessionStatus: any = 'INVALID_DATE';
    try{ sessionStatus = computeForexSessionStatus(now); }catch(_){ sessionStatus = 'INVALID_DATE'; }

    const forexInstruments = Array.isArray(instruments) ? instruments.filter(i => String((i && i.assetType)||'').toUpperCase() === 'FOREX') : [];

    let marketDataPairCount = 0;
    let tradingEnabledPairCount = 0;
    let quoteReadyCount = 0;
    let stalePairCount = 0;
    let unavailablePairCount = 0;
    let conversionReadyCount = 0;
    let conversionBlockedCount = 0;
    let executionReadyCount = 0;
    let blockedPairCount = 0;
    const blockingReasons: Record<string, number> = {};

    const reasonInc = (r: string|undefined)=>{ const k = String(r||'UNKNOWN'); blockingReasons[k] = (blockingReasons[k]||0) + 1; };

    // If session closed, executionReadyCount must be zero per requirements
    const sessionOpen = sessionStatus === 'OPEN';

    for (const inst of forexInstruments){
      const marketDataEnabled = inst.marketDataEnabled === true || (inst.marketDataEnabled === undefined && inst.enabled === true);
      if (marketDataEnabled) marketDataPairCount++;
      if (inst.tradingEnabled) tradingEnabledPairCount++;

      // find quote
      const sym = normalizeKey(String(inst.providerSymbol || inst.id || inst.name || ''));
      const q = quotesByCanonical[sym] || null;
      let quoteFresh = false;
      if (!q){ unavailablePairCount++; reasonInc('QUOTE_UNAVAILABLE'); }
      else {
        const ts = q.marketTimestamp ?? q.timestamp ?? q.observedAt ?? null;
        const price = (typeof q.price === 'number' ? q.price : (typeof q.priceSek === 'number' ? q.priceSek : null));
        if (!ts){ unavailablePairCount++; reasonInc('QUOTE_TIMESTAMP_INVALID'); }
        else {
          // Accept ISO strings and numeric epoch values (seconds or ms)
          let tsMs: number | null = null;
          if (typeof ts === 'number') tsMs = ts > 1e12 ? ts : ts * 1000;
          else if (/^\d+$/.test(String(ts).trim())){ const n = Number(String(ts).trim()); tsMs = n > 1e12 ? n : n * 1000; }
          else { const p = Date.parse(String(ts)); tsMs = isFinite(p) ? p : null; }
          if (!tsMs){ unavailablePairCount++; reasonInc('QUOTE_TIMESTAMP_INVALID'); }
          else {
            const age = now.getTime() - tsMs;
            if (age < 0){ stalePairCount++; reasonInc('QUOTE_TIMESTAMP_FUTURE'); }
            // Respect the normalized quote's `isStale` classification produced by
            // the centralized quotes-service. That service applies market-session
            // aware overrides (e.g. consider same trading date fresh). Use that
            // classification as authoritative to avoid double-counting an age
            // check that may disagree with provider-aware logic.
            else if (q.isStale){ stalePairCount++; reasonInc('QUOTE_STALE'); }
            else if (!Number.isFinite(Number(price)) || price <= 0){ unavailablePairCount++; reasonInc('QUOTE_PRICE_INVALID'); }
            else { quoteReadyCount++; quoteFresh = true; }
          }
        }
      }

      // conversion check: resolve currency to SEK using same quotes map
      const qc = String(inst.quoteCurrency || inst.currency || 'USD').toUpperCase();
      const conv = resolveCurrencyToSekRate({ currency: qc, quotesByCanonicalSymbol: quotesByCanonical, now, maxAgeMs: maxAge });
      if (conv && conv.status === 'VERIFIED'){ conversionReadyCount++; }
      else { conversionBlockedCount++; switch(conv && conv.status){ case 'MISSING_RATE': reasonInc('FOREX_CONVERSION_RATE_MISSING'); break; case 'STALE_RATE': reasonInc('FOREX_CONVERSION_RATE_STALE'); break; case 'FUTURE_RATE': reasonInc('FOREX_CONVERSION_RATE_FUTURE'); break; case 'INVALID_RATE': reasonInc('FOREX_CONVERSION_RATE_INVALID'); break; case 'UNSUPPORTED_PATH': reasonInc('FOREX_CONVERSION_PATH_UNSUPPORTED'); break; default: reasonInc('FOREX_NOTIONAL_CONVERSION_UNAVAILABLE'); } }

      // Execution ready if session open, trading enabled, fresh quote, and verified conversion, and not data-only
      const isDataOnly = marketDataEnabled && !inst.tradingEnabled;
      const execReady = sessionOpen && !!inst.tradingEnabled && quoteFresh && conv && conv.status === 'VERIFIED' && !isDataOnly;
      if (execReady) executionReadyCount++; else { blockedPairCount++; // determine primary blocking reason ordering
        if (!sessionOpen){ reasonInc('FOREX_SESSION_CLOSED'); }
        else if (!inst.tradingEnabled){ reasonInc('FOREX_TRADING_DISABLED'); }
        else if (!q){ reasonInc('QUOTE_UNAVAILABLE'); }
        else if (q && (q.isStale || (!q.marketTimestamp && !q.timestamp && !q.observedAt))){ reasonInc('QUOTE_STALE'); }
        else if (!(conv && conv.status === 'VERIFIED')){ /* already accounted above */ }
      }
    }

    // Determine notionalModel
    const notionalModel = conversionReadyCount === 0 ? 'UNAVAILABLE' : (conversionReadyCount === forexInstruments.length ? 'VERIFIED_CONVERSION' : 'MIXED');

    return {
      sessionStatus: (sessionStatus as any) || 'INVALID_DATE',
      marketDataPairCount,
      tradingEnabledPairCount,
      quoteReadyCount,
      stalePairCount,
      unavailablePairCount,
      conversionReadyCount,
      conversionBlockedCount,
      executionReadyCount: sessionOpen ? executionReadyCount : 0,
      blockedPairCount,
      checkedAt: now.toISOString(),
      notionalModel,
      blockingReasons,
    } as ForexReadinessState;
  }catch(e){
    // fail-closed safe state
    return {
      sessionStatus: 'INVALID_DATE', marketDataPairCount:0, tradingEnabledPairCount:0, quoteReadyCount:0, stalePairCount:0, unavailablePairCount:0, conversionReadyCount:0, conversionBlockedCount:0, executionReadyCount:0, blockedPairCount:0, checkedAt: (new Date()).toISOString(), notionalModel: 'UNAVAILABLE', blockingReasons: {},
    } as ForexReadinessState;
  }
}

export default { buildForexReadinessState };
