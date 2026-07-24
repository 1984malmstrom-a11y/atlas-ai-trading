"use client";

import React, { useEffect, useMemo, useState } from "react";
import LeftSidebar from '../../components/dashboard-v1/LeftSidebar';
import { getMockMarketData } from "../../lib/mock-market-monitor";
import { computeUSMarketStatus } from "../../lib/us-market";
import CompanyLogo from "../../components/CompanyLogo";
// polling provided by MarketPollingClient mounted in root layout

type UIQuote = {
  symbol: string;
  name?: string | null;
  price: number | null;
  prevPrice: number | null;
  previousClose?: number | null;
  volume?: number;
  updatedAt?: string | null;
  dataStatus?: string | null; // LIVE|DELAYED|STALE|UNAVAILABLE|MOCK
  currency?: string | null;
  change?: number | null;
  changePercent?: number | null;
  provider?: string | null;
  marketTimestamp?: string | null;
};

  // Show primary US instruments + FX in the V1 market view
  const TARGET_SYMBOLS = ["NVDA", "MSFT", "AAPL", "USD/SEK", "EUR/SEK"];

  function flagForSymbol(sym?: string) {
    if (!sym) return '';
    const s = sym.toUpperCase();
    if (s.includes('.ST')) return '🇸🇪';
    if (s.includes('.CO')) return '🇩🇰';
    if (s.includes('.US') || s.match(/^[A-Z]{1,5}$/)) return '🇺🇸';
    return '';
  }

function formatChangePct(oldVal: number | null, newVal: number | null) {
  if (oldVal === null || oldVal === 0 || newVal === null) return "0.00%";
  const pct = ((newVal - oldVal) / Math.abs(oldVal)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-medium ${className}`}>{children}</span>
  );
}

export default function MarketMonitorPage() {
  const mockInitial = useMemo(() => getMockMarketData(), []);
  const [quotes, setQuotes] = useState<UIQuote[]>(() => TARGET_SYMBOLS.map(sym => ({ symbol: sym, name: null, price: null, prevPrice: null, volume: 0, updatedAt: null, dataStatus: 'MOCK' })));
  const [hasLive, setHasLive] = useState(false);
  const POLL_MS = 30 * 1000; // used for display only (30s)
  const POLL_SECONDS = Math.floor(POLL_MS / 1000);
  const [secondsLeft, setSecondsLeft] = useState(POLL_SECONDS);
  const [usingProvider, setUsingProvider] = useState(false);
  const [usingMock, setUsingMock] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [flashMap, setFlashMap] = useState<Record<string, 'up'|'down'|undefined>>({});
  // Forex session history for sparklines (not persisted)
  const forexHistoryRef = React.useRef<Record<string, number[]>>({ 'USD/SEK': [], 'EUR/SEK': [] });

  // Helper: get ET (America/New_York) wall-clock parts
  function getETParts() {
    try{
      const f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12:false });
      const parts = f.formatToParts(new Date());
      const map: any = {};
      for(const p of parts) map[p.type] = p.value;
      return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second) };
    }catch(e){ return null; }
  }

  function minutesUntilET(targetHour:number,targetMinute:number){
    const parts = getETParts(); if(!parts) return null;
    const nowM = parts.hour*60 + parts.minute;
    const targetM = targetHour*60 + targetMinute;
    let diff = targetM - nowM;
    // same day or next weekday
    if(diff < 0) diff += 24*60; // next day
    return diff;
  }

  function formatHoursMinutesFromMinutes(mins:number){
    const h = Math.floor(mins/60); const m = mins%60; return `${h} h ${m} min`;
  }

  // Use shared helper `computeUSMarketStatus` from src/lib/us-market.ts

  useEffect(()=>{
    // subscribe to shared market polling events
    let mounted = true;

    // If the shared client store already has a snapshot (poller mounted earlier), apply it immediately
    try{
      const snap = (window as any).__atlas_quotesById;
      if (snap && typeof snap === 'object' && Object.keys(snap).length > 0){
        const detail = { quotes: Object.keys(snap).map(k=>snap[k]), fetchedAt: new Date().toISOString(), usingProvider: true };
        // call the handler directly to populate UI immediately
        (function immediate(d:any){
          const fetched: any[] = Array.isArray(d.quotes) ? d.quotes : [];
          const map = new Map<string, any>();
          for (const f of fetched){ if (f && f.symbol) map.set(String(f.symbol).toUpperCase(), f); }
          setHasLive(true);
          setQuotes(prevQs => {
            const out: UIQuote[] = TARGET_SYMBOLS.map(sym => {
              const s = map.get(sym.toUpperCase());
              const prev = prevQs.find(p => p.symbol === sym);
              const prevPrice = prev ? prev.price : null;
              if (!s) { return { symbol: sym, name: null, price: null, prevPrice: prevPrice, volume: 0, updatedAt: null, dataStatus: 'UNAVAILABLE' }; }
              const newPrice = typeof s.price === 'number' ? s.price : (s.price ? Number(s.price) : null);
              return {
                symbol: s.symbol || sym,
                name: s.name || null,
                price: newPrice,
                prevPrice: prevPrice,
                volume: s.volume ?? 0,
                updatedAt: s.marketTimestamp || s.fetchedAt || s.timestamp || null,
                dataStatus: s.dataStatus || s.status || null,
                currency: s.currency || null,
                change: s.change ?? null,
                changePercent: s.changePercent ?? s.change_percent ?? null,
                previousClose: s.previousClose ?? s.previous_close ?? null,
                provider: s.provider || null,
                marketTimestamp: s.marketTimestamp || null,
              };
            });
            return out;
          });
          setUsingProvider(true);
          setLastFetchedAt(d.fetchedAt || new Date().toISOString());
          // seed forex history from snapshot
          try{
            for(const s of d.quotes){
              if (s && s.symbol && (s.symbol==='USD/SEK' || s.symbol==='EUR/SEK')){
                const hist = forexHistoryRef.current[s.symbol] || [];
                const p = typeof s.price==='number' ? s.price : (s.price ? Number(s.price) : null);
                if (p !== null && hist.length===0) hist.push(p);
                forexHistoryRef.current[s.symbol]=hist.slice(-20);
              }
            }
          }catch(e){}
        })(detail);
      }
    }catch(e){}

    function onQuotes(e: any){
      if (!mounted) return;
      const d = e.detail || {};
      const fetched: any[] = Array.isArray(d.quotes) ? d.quotes : [];
      if (!fetched.length && d.error){
        // If we don't have live data yet, show mock/fallback; otherwise ignore transient provider errors
        if (!hasLive){
          if (process.env.NODE_ENV !== 'production'){
            setUsingProvider(false);
            const mock = getMockMarketData();
            setQuotes(TARGET_SYMBOLS.map(s => {
              const m = mock.find(mm => mm.symbol === s);
              return m ? { symbol: m.symbol, name: m.name, price: m.price, prevPrice: m.prevPrice, volume: m.volume, updatedAt: m.updatedAt, dataStatus: 'MOCK' } : { symbol: s, name: null, price: null, prevPrice: null, volume: 0, updatedAt: null, dataStatus: 'UNAVAILABLE' };
            }));
            setLastFetchedAt(new Date().toISOString());
            return;
          }
          setUsingProvider(false);
          setQuotes(TARGET_SYMBOLS.map(s => ({ symbol: s, name: null, price: null, prevPrice: null, volume: 0, updatedAt: null, dataStatus: 'UNAVAILABLE' })));
          setLastFetchedAt(new Date().toISOString());
          return;
        }
        return;
      }

      // map fetched quotes to UIQuote[] and compute transient flashes for changed prices
      const map = new Map<string, any>();
      for (const f of fetched){ if (f && f.symbol) map.set(String(f.symbol).toUpperCase(), f); }

      setHasLive(true);
      setQuotes(prevQs => {
        const out: UIQuote[] = TARGET_SYMBOLS.map(sym => {
          const s = map.get(sym.toUpperCase());
          const prev = prevQs.find(p => p.symbol === sym);
          const prevPrice = prev ? prev.price : null;
          if (!s) { return { symbol: sym, name: null, price: null, prevPrice: prevPrice, volume: 0, updatedAt: null, dataStatus: 'UNAVAILABLE' }; }
          const newPrice = typeof s.price === 'number' ? s.price : (s.price ? Number(s.price) : null);
          if (prevPrice !== null && newPrice !== null && prevPrice !== newPrice){
            setFlashMap(fm => ({ ...fm, [sym]: newPrice > prevPrice ? 'up' : 'down' }));
            setTimeout(()=> setFlashMap(fm => ({ ...fm, [sym]: undefined })), 900);
          }
          // update forex history when price changes
          try{
            if ((s.symbol === 'USD/SEK' || s.symbol === 'EUR/SEK') && typeof newPrice === 'number'){
              const key = s.symbol;
              const hist = forexHistoryRef.current[key] || [];
              const last = hist.length ? hist[hist.length-1] : null;
              if (last === null || last !== newPrice){
                hist.push(newPrice);
                if (hist.length > 20) hist.splice(0, hist.length - 20);
              }
              forexHistoryRef.current[key] = hist;
            }
          }catch(e){}
            return {
            symbol: s.symbol || sym,
            name: s.name || null,
            price: newPrice,
            prevPrice: prevPrice,
              previousClose: s.previousClose ?? s.previous_close ?? null,
            volume: s.volume ?? 0,
            updatedAt: s.marketTimestamp || s.fetchedAt || s.timestamp || null,
            dataStatus: s.dataStatus || s.status || null,
            currency: s.currency || null,
            change: s.change ?? null,
            changePercent: s.changePercent ?? s.change_percent ?? null,
            provider: s.provider || null,
            marketTimestamp: s.marketTimestamp || null,
          };
        });
        return out;
      });
      setUsingProvider(Boolean(d.usingProvider));
      // determine if we are showing mock data
      const isMock = Boolean(d.isMock) || ((!d.quotes || d.quotes.length === 0) && process.env.NODE_ENV !== 'production');
      setUsingMock(Boolean(isMock));
      setLastFetchedAt(d.fetchedAt || new Date().toISOString());
    }

    // Internal fetch helper to request quotes from API and update UI.
    const fetchInProgressRef = { current: false } as { current: boolean };
    async function fetchAndUpdate(){
      if (fetchInProgressRef.current) return;
      fetchInProgressRef.current = true;
      try{
        const resp = await fetch('/api/market-data/quotes');
        if (!resp.ok) throw new Error('fetch failed');
        const data = await resp.json();
        const quotesArr = data.quotes || [];
        const isMock = Boolean(data.isMock) || (data.source === 'mock') || (Array.isArray(quotesArr) && quotesArr.length === 0 && process.env.NODE_ENV !== 'production');
        const usingProviderVal = (data.source && data.source !== 'mock') || (Array.isArray(quotesArr) && quotesArr.length > 0);
        const detail: any = { quotes: quotesArr, fetchedAt: data.fetchedAt || new Date().toISOString(), usingProvider: Boolean(usingProviderVal), isMock: Boolean(isMock), source: data.source || (isMock ? 'mock' : 'twelve-data') };
        // Dispatch same event shape as the shared poller would
        window.dispatchEvent(new CustomEvent('atlas:market-quotes', { detail }));
      }catch(e){
        // fallback to mock only in dev
        const detail:any = { quotes: [], fetchedAt: new Date().toISOString(), usingProvider: false, isMock: process.env.NODE_ENV !== 'production', source: 'mock' };
        window.dispatchEvent(new CustomEvent('atlas:market-quotes', { detail }));
      }finally{
        fetchInProgressRef.current = false;
      }
    }

    function onTick(e:any){ if (!mounted) return; const rem = e?.detail?.secondsLeft; if (typeof rem === 'number') setSecondsLeft(rem); }

    // internal per-second countdown and auto-fetch when reaching 0
    let internalTimer: any = null;
    const externalTickSeenRef = { current: false } as { current: boolean };
    function startInternalTimer(){
      // initialize
      setSecondsLeft(POLL_SECONDS);
      internalTimer = setInterval(() => {
        setSecondsLeft(prev => {
          const next = prev - 1;
          if (next <= 0){
            // trigger fetch and reset (fetch is internally locked)
            void fetchAndUpdate();
            return POLL_SECONDS;
          }
          return next;
        });
      }, 1000);
    }

    // Listen for shared poller ticks; if we see a tick quickly after mount
    // we will prefer the shared poller and avoid starting our own interval.
    function _tempTickListener(ev: any){ externalTickSeenRef.current = true; }
    window.addEventListener('atlas:market-quotes', onQuotes as EventListener);
    window.addEventListener('atlas:market-quotes-tick', onTick as EventListener);
    window.addEventListener('atlas:market-quotes-tick', _tempTickListener as EventListener);
    // start internal timer only if no external tick observed shortly after mount
    setTimeout(() => {
      window.removeEventListener('atlas:market-quotes-tick', _tempTickListener as EventListener);
      if (!externalTickSeenRef.current) startInternalTimer();
    }, 200);

    return ()=>{ mounted = false; window.removeEventListener('atlas:market-quotes', onQuotes as EventListener); window.removeEventListener('atlas:market-quotes-tick', onTick as EventListener); if (internalTimer) clearInterval(internalTimer); };
  }, []);

  // Determine market status for the top card
  const hasRealQuote = quotes.some(q => q.dataStatus === 'LIVE' || (usingProvider && q.price !== null));
  const marketCardStatus = hasRealQuote ? 'LIVE' : 'DEGRADED';

  function badgeForStatus(s?: string) {
    const st = (s || 'UNAVAILABLE').toUpperCase();
    if (st === 'LIVE') return 'bg-green-100 text-green-800 border border-green-200';
    if (st === 'DELAYED' || st === 'STALE' || st === 'MARKNAD STÄNGD') return 'bg-amber-100 text-amber-800 border border-amber-200';
    if (st === 'MOCK') return 'bg-sky-50 text-sky-800 border border-sky-100';
    if (st === 'UNAVAILABLE') return 'bg-rose-50 text-rose-800 border border-rose-100';
    return 'bg-gray-50 text-gray-800 border border-gray-100';
  }

  function formatTimeOrDash(ts: string | null | undefined){
    if (!ts) return '—';
    try{
      const d = new Date(ts);
      if (!isFinite(d.getTime())) return '—';
      return d.toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }catch(e){ return '—'; }
  }

  return (
    <>
      <LeftSidebar />
      <div style={{ marginLeft: 240 }} className="py-8 px-4 bg-[#F9F6F1] min-h-[200px]">
        <div className="max-w-5xl mx-auto">
        <div className="mb-4">
          {/* Market hours and Forex status */}
          <div style={{ display:'flex', gap:24, alignItems:'center', marginBottom:8 }}>
            <div>
              <div className="text-xs text-gray-500">USA</div>
              <div className="text-sm font-semibold">{computeUSMarketStatus()}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">FOREX</div>
              <div className="text-sm font-semibold">Öppen</div>
            </div>
          </div>
          <h1 className="text-2xl font-semibold">MARKNADSÖVERVAKNING</h1>
          <p className="text-sm text-gray-600">Kurser uppdateras automatiskt från Atlas marknadsflöde.</p>
          <div className="mt-2 text-xs text-gray-500">Riktig marknadsdata där providerdata finns. Fördröjd eller otillgänglig data markeras tydligt.</div>
          <div className="mt-2">
            <div style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              <div style={{ width:10, height:10, borderRadius:9999, background: usingMock ? '#0EA5E9' : (usingProvider ? '#10B981' : '#9CA3AF') }} />
              <div style={{ fontSize:12, fontWeight:600 }}>{usingMock ? 'Mock' : (usingProvider ? 'Live' : 'Senast')}</div>
              <div style={{ color:'#6B7280' }}>{lastFetchedAt ? new Date(lastFetchedAt).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour12:false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</div>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-start gap-4 mb-6">
          <div className="grid grid-cols-4 gap-3 flex-1">
            <div className="bg-white rounded-md p-2.5 flex flex-col gap-0.5 border border-gray-100 h-16 flex justify-center">
              <div className="text-xs text-gray-500">Marknadsstatus</div>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{marketCardStatus}</div>
                <div className={`text-[10px] px-1.5 py-0.5 rounded ${marketCardStatus === 'LIVE' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>{marketCardStatus}</div>
              </div>
            </div>
            <div className="bg-white rounded-md p-2.5 flex flex-col gap-0.5 border border-gray-100 h-16 flex justify-center">
              <div className="text-xs text-gray-500">Bevakade instrument</div>
              <div className="text-sm font-semibold">{quotes.length}</div>
            </div>
            <div className="bg-white rounded-md p-2.5 flex flex-col gap-0.5 border border-gray-100 h-16 flex justify-center">
              <div className="text-xs text-gray-500">Senaste uppdatering</div>
              <div className="text-sm font-semibold">{lastFetchedAt ? new Date(lastFetchedAt).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour12:false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</div>
            </div>
            <div className="bg-white rounded-md p-2.5 flex flex-col gap-0.5 border border-gray-100 h-16 flex justify-center">
              <div className="text-xs text-gray-500">Nästa uppdatering</div>
              <div className="text-sm font-semibold">{secondsLeft}s</div>
            </div>
          </div>

          <div className="md:w-72 w-full bg-white rounded-md p-3 border border-gray-100 flex flex-col justify-center">
            <div className="text-xs text-gray-500">VICTOR</div>
            <div className="text-sm font-semibold">Marknaden bevakas just nu.</div>
            <div className="text-xs text-gray-500 mt-1">
              {hasRealQuote ? `${quotes.filter(q=>q.dataStatus==='LIVE' || (usingProvider && q.price!==null)).length} instrument analyseras inför nästa uppdatering.` : 'Väntar på tillgänglig marknadsdata.'}
            </div>
            <div className="text-xs text-gray-400 mt-2">Senaste AI-analys: —</div>
          </div>
        </div>

        <div className="space-y-2">
          {quotes.map((q) => {
            const status = (q.dataStatus || 'UNAVAILABLE').toUpperCase();
            const pricePresent = q.price !== null && q.price !== undefined;
            const positive = typeof q.change === 'number' && q.change > 0;
            const negative = typeof q.change === 'number' && q.change < 0;
            const flash = flashMap[q.symbol];
            // Determine display status: for US symbols with a delayed quote that represents
            // a latest valid close (timestamp not today) show MARKNAD STÄNGD instead of DELAYED
            let displayStatus = status;
            try{
              const sym = (q.symbol || '').toUpperCase();
              const isUS = !!(sym.match(/^[A-Z]{1,5}$/));
              if (isUS && status === 'DELAYED' && pricePresent && q.marketTimestamp){
                const mq = new Date(q.marketTimestamp);
                const now = new Date();
                if (isFinite(mq.getTime()) && mq.toDateString() !== now.toDateString()){
                  displayStatus = 'MARKNAD STÄNGD';
                }
              }
            }catch(e){}

            return (
              <div key={q.symbol} className="bg-white rounded-md py-3 px-3 border border-transparent hover:border-blue-50 transition-colors duration-150">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0">
                      <CompanyLogo symbol={q.symbol} name={q.name || undefined} size={48} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold truncate">{q.name || q.symbol}</div>
                        <div className="text-xs text-gray-400">{flagForSymbol(q.symbol)}</div>
                      </div>
                      <div className="text-xs text-gray-500 truncate">{q.symbol}</div>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center justify-center gap-4">
                    <div className="text-xl font-semibold leading-5" style={{ background: flash === 'up' ? 'rgba(16,185,129,0.12)' : flash === 'down' ? 'rgba(239,68,68,0.08)' : 'transparent', transition: 'background-color 700ms ease', padding: flash ? '0 4px' : undefined, borderRadius: flash ? 4 : undefined }}>
                      {pricePresent ? Number(q.price).toFixed(2) : '—'}
                      <div className="text-xs text-gray-500">{q.currency || '—'}</div>
                      {/* Forex movement: prefer provider day-percent (changePercent), else compute from previousClose */}
                      { (q.symbol === 'USD/SEK' || q.symbol === 'EUR/SEK') ? (
                        (() => {
                          const computePct = (): number | null => {
                            if (q.changePercent !== null && q.changePercent !== undefined && Number.isFinite(Number(q.changePercent))) return Number(q.changePercent);
                            if (q.previousClose !== null && q.previousClose !== undefined && q.price !== null && Number(q.previousClose) !== 0){ const prev = Number(q.previousClose); return ((Number(q.price) - prev) / Math.abs(prev)) * 100; }
                            return null;
                          };
                          const pct = computePct();
                          const color = pct === null ? '#6B7280' : (pct > 0 ? '#16A34A' : (pct < 0 ? '#DC2626' : '#6B7280'));
                          return (
                            <div className="text-xs mt-1" style={{ color }}>
                              {pct === null ? '—' : (() => { const abs = Math.abs(pct).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); if (pct > 0) return `+${abs} %`; if (pct < 0) return `−${abs} %`; return `0,00 %`; })()}
                            </div>
                          );
                        })()
                      ) : null }
                    </div>
                    <div className="text-right">
                      <div className={`${positive ? 'text-green-600' : negative ? 'text-rose-600' : 'text-gray-600'} font-medium text-sm`}>{q.change !== null && q.change !== undefined ? (q.change as number).toFixed(2) : '—'}</div>
                      <div className={`${positive ? 'text-green-600' : negative ? 'text-rose-600' : 'text-gray-600'} text-xs`}>{q.changePercent !== null && q.changePercent !== undefined ? `${q.changePercent.toFixed(2)}%` : '—'}</div>
                    </div>

                    <div className="w-36 flex items-center justify-center">
                      <div className="h-0.5 w-full bg-gray-300 rounded" />
                    </div>
                  </div>

                  <div className="w-44 text-right flex flex-col items-end">
                    <div className={`inline-block text-[11px] px-1.5 py-0.5 rounded ${badgeForStatus(displayStatus)}`}>{displayStatus}</div>
                    <div className="text-xs text-gray-400 mt-1">{q.updatedAt ? 'Uppdaterad ' + formatTimeOrDash(q.updatedAt) : (lastFetchedAt ? 'Uppdaterad ' + formatTimeOrDash(lastFetchedAt) : '—')}</div>
                  </div>
                </div>
                {(!pricePresent || status === 'UNAVAILABLE') && (
                  <div className="mt-2 text-xs text-gray-500">Ingen kursdata från aktuell provider</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 max-w-5xl mx-auto">
          <h2 className="text-sm font-semibold mb-3">MARKNADSÖVERSIKT</h2>
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-md p-3 border border-gray-100 flex items-center gap-3">
              <div className="text-lg">🇺🇸</div>
              <div>
                <div className="text-sm font-semibold">USA</div>
                <div className="text-xs text-gray-500">Nasdaq — BEVAKAS</div>
              </div>
            </div>
            <div className="bg-white rounded-md p-3 border border-gray-100 flex items-center gap-3">
              <div className="text-lg">🇸🇪</div>
              <div>
                <div className="text-sm font-semibold">Sverige</div>
                <div className="text-xs text-gray-500">OMXS30 — BEVAKAS</div>
              </div>
            </div>
            <div className="bg-white rounded-md p-3 border border-gray-100 flex items-center gap-3">
              <div className="text-lg">🇩🇰</div>
              <div>
                <div className="text-sm font-semibold">Danmark</div>
                <div className="text-xs text-gray-500">C25 — BEVAKAS</div>
              </div>
            </div>
            <div className="text-xs text-gray-400 ml-4">Indexdata kopplas in senare.</div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
