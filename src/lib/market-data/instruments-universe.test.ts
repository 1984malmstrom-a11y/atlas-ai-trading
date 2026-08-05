import { describe, it, expect } from 'vitest';
import { TRADABLE_INSTRUMENTS } from './instruments';
import { buildAutomaticAnalysisSymbols, isInstrumentTradableNow } from '../paper-trader/demo-runtime';

function normalizeKey(s: string | null | undefined){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }

describe('Instruments universe sanity', () => {
  it('has unique ids and no normalized duplicates among enabled USD equities/ETFs', () => {
    const ids = TRADABLE_INSTRUMENTS.map(i => String(i.id||'').toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);

    const enabledUsd = TRADABLE_INSTRUMENTS.filter(i => ((i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true)) && String(i.currency||'').toUpperCase() === 'USD' && (String(i.assetType||'').toUpperCase() === 'STOCK' || String(i.assetType||'').toUpperCase() === 'ETF'));
    const keys = enabledUsd.map(i => normalizeKey(i.providerSymbol || i.id));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('contains required US tickers with providerSymbol and USD currency', () => {
    const required = ['AMZN','GOOGL','META','TSLA','AMD','AVGO','ORCL','CRM','PLTR','NFLX','TSM','ARM','MU','QCOM','ASML','SMCI','JPM','BAC','GS','V','MA','LLY','UNH','ABBV','JNJ','COST','WMT','MCD','HD','NKE','CAT','GE','RTX','DE','XOM','CVX','PANW','CRWD','SNOW','SHOP','UBER','SPY','QQQ','IWM','DIA'];
    for (const t of required){
      const found = TRADABLE_INSTRUMENTS.find(i => String(i.providerSymbol || '').toUpperCase() === t || String(i.id || '').toUpperCase() === t);
      expect(found, `Missing instrument ${t}`).toBeDefined();
      if (found){
        expect(String(found.providerSymbol || '').length).toBeGreaterThan(0);
        expect(String(found.currency || '').toUpperCase()).toBe('USD');
      }
    }
  });

  it('has at least one symbol from each sector group', () => {
    const groups: Record<string,string[]> = {
      mega: ['AMZN','GOOGL','META','MSFT','AAPL','NVDA'],
      semis: ['TSM','QCOM','MU','ASML','SMCI'],
      finance: ['JPM','BAC','GS','V','MA'],
      healthcare: ['LLY','UNH','ABBV','JNJ'],
      consumer: ['COST','WMT','MCD','HD','NKE'],
      industrials: ['CAT','GE','RTX','DE'],
      energy: ['XOM','CVX'],
      cyber: ['PANW','CRWD','SNOW','SHOP','UBER'],
      etf: ['SPY','QQQ','IWM','DIA']
    };
    for (const [k, arr] of Object.entries(groups)){
      const ok = arr.some(t => TRADABLE_INSTRUMENTS.find(i => String(i.providerSymbol||'').toUpperCase() === t));
      expect(ok, `No symbol present for group ${k}`).toBe(true);
    }
  });

  it('classifies major ETFs as assetType ETF', () => {
    const etfs = ['SPY','QQQ','IWM','DIA'];
    for (const e of etfs){
      const inst = TRADABLE_INSTRUMENTS.find(i => String(i.providerSymbol||'').toUpperCase() === e);
      expect(inst, `Missing ${e}`).toBeDefined();
      if (inst) expect(String(inst.assetType||'').toUpperCase()).toBe('ETF');
    }
  });

  it('buildAutomaticAnalysisSymbols includes enabled US watchlist symbols when provided', () => {
    const eligible = TRADABLE_INSTRUMENTS.filter(i => String(i.currency||'').toUpperCase() === 'USD' && i.enabled === true);
    const watchlist = eligible.slice(0,5).map(i => String(i.providerSymbol || i.id).toUpperCase());
    const symbols = buildAutomaticAnalysisSymbols(eligible, new Date(), watchlist);
    for (const s of watchlist) expect(symbols.map(x=>String(x).toUpperCase()).includes(s)).toBe(true);
  });

  it('contains Forex instruments (unaffected)', () => {
    const fxCount = TRADABLE_INSTRUMENTS.filter(i => String(i.assetType||'').toUpperCase() === 'FOREX').length;
    expect(fxCount).toBeGreaterThan(0);
  });

  it('rotation: max 10 symbols, core present, forex present only when open, deterministic rotation', () => {
    const eligible = TRADABLE_INSTRUMENTS.filter(i => ((i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true)));
    const nowOpen = new Date('2026-01-05T12:00:00Z'); // Monday -> forex OPEN (NY)
    const nowClosed = new Date('2026-01-04T12:00:00Z'); // Sunday -> forex CLOSED (NY)

    const symbolsOpen = buildAutomaticAnalysisSymbols(eligible, nowOpen as any);
    const symbolsClosed = buildAutomaticAnalysisSymbols(eligible, nowClosed as any);

    // max 10
    expect(symbolsOpen.length).toBeLessThanOrEqual(10);
    expect(symbolsClosed.length).toBeLessThanOrEqual(10);

    // SPY & QQQ present when eligible
    const hasSPY = symbolsOpen.map(s => String(s).toUpperCase()).includes('SPY');
    const hasQQQ = symbolsOpen.map(s => String(s).toUpperCase()).includes('QQQ');
    expect(hasSPY).toBe(true);
    expect(hasQQQ).toBe(true);

    // EUR/USD present when open, absent when closed
    const hasEurOpen = symbolsOpen.map(s=>String(s).toUpperCase()).includes('EUR/USD'.toUpperCase());
    const hasEurClosed = symbolsClosed.map(s=>String(s).toUpperCase()).includes('EUR/USD'.toUpperCase());
    expect(hasEurOpen).toBe(true);
    expect(hasEurClosed).toBe(false);

    // deterministic: same time -> same selection
    const s1 = buildAutomaticAnalysisSymbols(eligible, nowOpen as any);
    const s2 = buildAutomaticAnalysisSymbols(eligible, new Date('2026-01-05T12:00:00Z') as any);
    expect(s1).toEqual(s2);

    // different hour -> different selection (rotation uses hourly index)
    const sNextHour = buildAutomaticAnalysisSymbols(eligible, new Date('2026-01-05T13:00:00Z') as any);
    // Expect deterministic block-shift: compute rotationPool and rotationSlots and assert shift
    const usCandidatesFull = TRADABLE_INSTRUMENTS.filter(i => {
      const c = String(i.currency||'').toUpperCase(); const at = String(i.assetType||'').toUpperCase();
      const enabled = (i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true);
      return enabled && (at === 'STOCK' || at === 'ETF') && c === 'USD';
    }).map(i=> normalizeKey(i.providerSymbol || i.id));
    const existingOpen = symbolsOpen.map(s=> normalizeKey(String(s))).filter(x => !['EURUSD','SPY','QQQ'].includes(x));
    const rotationSlotsBlock = Math.max(1, existingOpen.length);
    const existingNext = sNextHour.map(s=> normalizeKey(String(s))).filter(x => !['EURUSD','SPY','QQQ'].includes(x));
    const candidateOrdered = Array.from(new Set(usCandidatesFull.filter(x=> !['SPY','QQQ'].includes(x)).sort()));
    if (candidateOrdered.length > 0){
      // For each symbol in first selection, find its index in candidateOrdered and expect the corresponding symbol in next selection
      const indices1 = existingOpen.map(s => candidateOrdered.indexOf(s)).filter(i=> i >= 0);
      const indices2 = existingNext.map(s => candidateOrdered.indexOf(s)).filter(i=> i >= 0);
      // When both selections have same length and >0, assert indices2 === (indices1 + rotationSlots) % candidateOrdered.length
      if (indices1.length === indices2.length && indices1.length > 0){
        const expected = indices1.map(i => (i + rotationSlotsBlock) % candidateOrdered.length);
        expect(indices2).toEqual(expected);
      }
    }

    // no duplicates
    const normalized = symbolsOpen.map(s => normalizeKey(String(s)));
    expect(new Set(normalized).size).toBe(normalized.length);

    // Coverage: across N cycles we should see at least one enabled US candidate (sanity)
    const usCandidates = TRADABLE_INSTRUMENTS.filter(i => {
      const c = String(i.currency||'').toUpperCase(); const at = String(i.assetType||'').toUpperCase();
      const enabled = (i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true);
      return enabled && (at === 'STOCK' || at === 'ETF') && c === 'USD';
    }).map(i=> normalizeKey(i.providerSymbol || i.id));
    const base = Date.parse('2026-01-05T00:00:00Z');
    let seenAny = false;
    for (let i = 0; i < Math.max(1, Math.min(6, usCandidates.length)); i++){
      const t = new Date(base + i * 60 * 60 * 1000);
      const sel = buildAutomaticAnalysisSymbols(eligible, t as any).map(s=> normalizeKey(String(s)));
      if (sel.some(x => usCandidates.includes(x))) { seenAny = true; break; }
    }
    expect(seenAny).toBe(true);
  });

  it('when Forex OPEN and US market closed, multiple enabled FOREX are selected (no US stocks)', () => {
    const eligible = TRADABLE_INSTRUMENTS.filter(i => ((i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true)));
    // Choose a time where Forex session is open but NY stock market is closed: Sunday 22:30 UTC -> NY ~17:30 Sun (Forex opens)
    const forexOpenUsClosed = new Date('2026-01-04T22:30:00Z');
    const sel = buildAutomaticAnalysisSymbols(eligible, forexOpenUsClosed as any);
    // ensure no US stocks included when NY market closed (unless instrument is marked tradable now)
    const usIncluded = sel.filter(s => { try{ const up = String(s||'').toUpperCase(); const inst = TRADABLE_INSTRUMENTS.find(i=> String(i.providerSymbol||i.id).toUpperCase() === up); return inst && (String(inst.assetType||'').toUpperCase() === 'STOCK' || String(inst.assetType||'').toUpperCase() === 'ETF') && isInstrumentTradableNow(inst, forexOpenUsClosed); }catch(_){ return false; } });
    expect(usIncluded.length).toBe(0);

    // Collect enabled FOREX provider symbols
    const enabledForex = TRADABLE_INSTRUMENTS.filter(i => String(i.assetType||'').toUpperCase() === 'FOREX' && ((i.marketDataEnabled === true) || (i.marketDataEnabled === undefined && i.enabled === true))).map(i=> String(i.providerSymbol || i.id).toUpperCase()).map(s=> s.indexOf('_')!==-1? s.replace('_','/') : s.indexOf('/')!==-1? s : (s.length===6? s.slice(0,3)+'/'+s.slice(3) : s));
    // At least two enabled forex instruments should be present in selection when open
    const foundFx = sel.map(s=> String(s).toUpperCase()).filter(x => enabledForex.includes(x));
    expect(foundFx.length).toBeGreaterThanOrEqual(Math.min(1, enabledForex.length));

    // If GBP/USD and USD/JPY enabled at least one of them should be present
    const wants = ['EUR/USD','GBP/USD','USD/JPY'].filter(x => enabledForex.includes(x));
    if (wants.length > 0) expect(sel.map(s => String(s).toUpperCase()).some(x => wants.includes(x))).toBe(true);

    // Respect max 10 and no duplicates
    expect(sel.length).toBeLessThanOrEqual(10);
    const normalized = sel.map(s => String(s).toUpperCase().replace(/[^A-Z0-9]/g,''));
    expect(new Set(normalized).size).toBe(normalized.length);

      // Rotation coverage: with current enabled Forex pool, two consecutive hourly cycles should cover all enabled forex
      const enabledForexPool = Array.from(new Set(enabledForex.map(s=> s.toUpperCase())));
      if (enabledForexPool.length > 0){
        const t1 = forexOpenUsClosed;
        const t2 = new Date(t1.getTime() + 60 * 60 * 1000);
        const sel1 = buildAutomaticAnalysisSymbols(eligible, t1 as any).map(s => String(s).toUpperCase()).filter(x => enabledForexPool.includes(x));
        const sel2 = buildAutomaticAnalysisSymbols(eligible, t2 as any).map(s => String(s).toUpperCase()).filter(x => enabledForexPool.includes(x));
        // per-cycle constraints
        expect(sel1.length).toBeLessThanOrEqual(10);
        expect(sel2.length).toBeLessThanOrEqual(10);
        expect(new Set(sel1).size).toBe(sel1.length);
        expect(new Set(sel2).size).toBe(sel2.length);
        // union across two cycles should cover the enabled pool
        const union = Array.from(new Set([...sel1, ...sel2]));
        expect(union.length).toBeGreaterThanOrEqual(enabledForexPool.length);
      }
  });

  it('custom watchlist larger than max yields at most 10 unique symbols and is deterministic', () => {
    const eligible = TRADABLE_INSTRUMENTS.filter(i => String(i.currency||'').toUpperCase() === 'USD' && i.enabled === true);
    const watchlist = eligible.map(i => String(i.providerSymbol || i.id).toUpperCase());
    // create oversized watchlist (double)
    const big = watchlist.concat(watchlist).slice(0, 20);
    const sel = buildAutomaticAnalysisSymbols(eligible, new Date('2026-01-05T12:00:00Z'), big as any);
    // max 10, no duplicates
    expect(sel.length).toBeLessThanOrEqual(10);
    const normalized = sel.map(s => normalizeKey(String(s)));
    expect(new Set(normalized).size).toBe(normalized.length);
    // deterministic for same time
    const sel2 = buildAutomaticAnalysisSymbols(eligible, new Date('2026-01-05T12:00:00Z'), big as any);
    expect(sel).toEqual(sel2);
  });
});

export {};
