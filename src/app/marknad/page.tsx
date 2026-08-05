"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import LeftSidebar from '../../components/dashboard-v1/LeftSidebar';
import { getMockMarketData } from "../../lib/mock-market-monitor";
import { computeUSMarketStatus } from "../../lib/us-market";
import CompanyLogo from "../../components/CompanyLogo";
import { buildMarketOverviewViewModel, MarketOverviewViewModel } from '../../lib/market-data/market-overview-view-model';
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
  const POLL_MS = 30 * 1000;
  const [viewModel, setViewModel] = useState<MarketOverviewViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(POLL_MS/1000));
  const inProgressRef = React.useRef(false);
  const [activeTab, setActiveTab] = useState<'overview'|'stocks'|'etf'|'forex'|'analyzing'>('overview');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'symbol'|'change'|'updated'|'confidence'|'signals'>('symbol');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');

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

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const fetchSnapshot = useCallback(async ()=>{
    if (!mountedRef.current) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    // show loading overlay only if we have no data yet
    if (!viewModel) setLoading(true);
    setError(null);
    try{
      const resp = await fetch('/api/paper-trader?snapshot=market', { cache: 'no-store' });
      if (!resp.ok) throw new Error('snapshot fetch failed');
      const body = await resp.json();
      if (!body || !body.ok || !body.snapshot) throw new Error('invalid snapshot');
      const vm = buildMarketOverviewViewModel(body.snapshot);
      if (!mountedRef.current) return;
      setViewModel(vm);
      setLoading(false);
      setSecondsLeft(Math.floor(POLL_MS/1000));
    }catch(err:any){ if (!mountedRef.current) return; setError(String(err)); setLoading(false); }
    finally{ inFlightRef.current = false; }
  }, [viewModel]);

  useEffect(()=>{
    mountedRef.current = true;
    void fetchSnapshot();
    const interval = setInterval(()=>{ void fetchSnapshot(); setSecondsLeft(Math.floor(POLL_MS/1000)); }, POLL_MS);
    const tick = setInterval(()=> setSecondsLeft(prev => prev > 0 ? prev-1 : Math.floor(POLL_MS/1000)), 1000);
    return ()=>{ mountedRef.current = false; clearInterval(interval); clearInterval(tick); };
  }, [fetchSnapshot]);

  // derive metrics
  const rows = viewModel ? viewModel.rows : [];
  const total = rows.length;
  const byType = { STOCK: 0, ETF: 0, FOREX: 0 } as Record<string, number>;
  const statusCounts: Record<string, number> = { LIVE:0, DELAYED:0, STALE:0, UNAVAILABLE:0 };
  let analyzedCount = 0; let diCount = 0;
  for(const r of rows){
    const t = (r.assetType||'').toUpperCase();
    if (t.includes('FOREX')) byType.FOREX++;
    else if (t.includes('ETF')) byType.ETF++;
    else byType.STOCK++;
    const s = (r.dataStatus||'UNAVAILABLE').toUpperCase(); if (!statusCounts[s]) statusCounts[s]=0; statusCounts[s]++;
    if (r.analyzedInLatestCycle) analyzedCount++;
    if (r.hasDecisionIntelligence) diCount++;
  }

  // filtering/search
  let filtered = rows.filter(r => {
    if (activeTab === 'stocks' && !( (r.assetType||'').toUpperCase().includes('STOCK') )) return false;
    if (activeTab === 'etf' && !( (r.assetType||'').toUpperCase().includes('ETF') )) return false;
    if (activeTab === 'forex' && !( (r.assetType||'').toUpperCase().includes('FOREX') )) return false;
    if (activeTab === 'analyzing' && !r.analyzedInLatestCycle) return false;
    if (statusFilter && (r.dataStatus||'').toUpperCase() !== statusFilter) return false;
    if (search){ const s = search.toLowerCase(); if (!r.symbol.toLowerCase().includes(s) && !(r.name||'').toLowerCase().includes(s)) return false; }
    return true;
  });

  // apply sorting
  filtered = filtered.slice().sort((a,b)=>{
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
    if (sortKey === 'change') return ((a.changePercent||0) - (b.changePercent||0)) * dir;
    if (sortKey === 'updated') return ((a.fetchedAt ? Date.parse(a.fetchedAt) : 0) - (b.fetchedAt ? Date.parse(b.fetchedAt) : 0)) * dir;
    if (sortKey === 'confidence') return ((a.confidence||0) - (b.confidence||0)) * dir;
    if (sortKey === 'signals') return (a.usableSignalCount - b.usableSignalCount) * dir;
    return 0;
  });

  return (
    <>
      <LeftSidebar />
      <div style={{ marginLeft: 240 }} className="py-8 px-4 bg-[#F9F6F1] min-h-[200px]">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold">MARKNADSÖVERVAKNING</h1>
              <div className="text-sm text-gray-500">Snapshot: {viewModel ? viewModel.generatedAt : '—'}</div>
            </div>
            <div className="flex items-center gap-3">
                <div className="text-xs text-gray-500">Uppdatering om {secondsLeft}s</div>
                <button onClick={() => { void fetchSnapshot(); }} className="bg-white px-3 py-1 rounded border">Uppdatera</button>
            </div>
          </div>

          <div className="grid grid-cols-6 gap-4 mb-6">
            <div className="col-span-2 bg-white rounded-md p-4 border">
              <div className="text-xs text-gray-500">Victor Health</div>
              <div className="text-sm font-semibold">Scheduler: {viewModel && viewModel.health.scheduler && viewModel.health.scheduler.running ? 'Aktiv' : 'Stoppad'}</div>
              <div className="text-xs text-gray-500">Cykel: {viewModel && viewModel.health.scheduler && viewModel.health.scheduler.cycleInProgress ? 'Pågår' : 'Väntar'}</div>
              <div className="text-xs text-gray-500">Nästa körning: {viewModel && viewModel.health.scheduler && viewModel.health.scheduler.nextRunAt ? new Date(viewModel.health.scheduler.nextRunAt).toLocaleString() : '—'}</div>
              <div className="text-xs text-gray-500">Senaste körning: {viewModel && viewModel.health.scheduler && viewModel.health.scheduler.lastRunAt ? new Date(viewModel.health.scheduler.lastRunAt).toLocaleString() : '—'}</div>
              <div className="text-xs text-gray-500">Senaste status: {viewModel && viewModel.health.scheduler && viewModel.health.scheduler.lastStatus ? String(viewModel.health.scheduler.lastStatus) : '—'}</div>
            </div>
            <div className="col-span-2 bg-white rounded-md p-4 border">
              <div className="text-xs text-gray-500">Launch Control</div>
              <div className="text-sm font-semibold">{viewModel && viewModel.health.forexLaunchControl && (viewModel.health.forexLaunchControl.armed ? 'ARMED' : 'BLOCKED')}</div>
              <div className="text-xs text-gray-500">Blocker: {viewModel && viewModel.rows && viewModel.rows.length ? (viewModel.health.forexLaunchControl && viewModel.health.forexLaunchControl.blockingReason ? String(viewModel.health.forexLaunchControl.blockingReason) : '—') : '—'}</div>
            </div>
            <div className="col-span-2 bg-white rounded-md p-4 border">
              <div className="text-xs text-gray-500">Quotes</div>
              <div className="text-sm font-semibold">Senaste fel: {viewModel && viewModel.health.latestAutomaticQuotesError ? String(viewModel.health.latestAutomaticQuotesError) : '—'}</div>
              <div className="text-xs text-gray-500">Analyserade senast: {analyzedCount}</div>
            </div>
          </div>

          {error ? (
            <div className="mb-3 text-sm text-red-700">Fel: {error} {viewModel ? <span className="text-gray-600">(Visar senaste snapshot, kan vara inaktuell)</span> : null}</div>
          ) : null}

          <div className="flex items-center gap-3 mb-3">
            <button className={`px-3 py-1 rounded ${activeTab==='overview'?'bg-slate-200':''}`} onClick={()=>setActiveTab('overview')}>Översikt</button>
            <button className={`px-3 py-1 rounded ${activeTab==='stocks'?'bg-slate-200':''}`} onClick={()=>setActiveTab('stocks')}>Aktier</button>
            <button className={`px-3 py-1 rounded ${activeTab==='etf'?'bg-slate-200':''}`} onClick={()=>setActiveTab('etf')}>ETF:er</button>
            <button className={`px-3 py-1 rounded ${activeTab==='forex'?'bg-slate-200':''}`} onClick={()=>setActiveTab('forex')}>Valutapar</button>
            <button className={`px-3 py-1 rounded ${activeTab==='analyzing'?'bg-slate-200':''}`} onClick={()=>setActiveTab('analyzing')}>Analyseras nu</button>
            <input placeholder="Sök symbol eller namn" value={search} onChange={e=>setSearch(e.target.value)} className="ml-auto px-2 py-1 border rounded" />
            <select value={statusFilter||''} onChange={e=>setStatusFilter(e.target.value||null)} className="px-2 py-1 border rounded ml-2">
              <option value="">All</option>
              <option value="LIVE">LIVE</option>
              <option value="DELAYED">DELAYED</option>
              <option value="STALE">STALE</option>
              <option value="UNAVAILABLE">UNAVAILABLE</option>
            </select>
            <select value={sortKey} onChange={e=>setSortKey(e.target.value as any)} className="px-2 py-1 border rounded ml-2">
              <option value="symbol">Symbol</option>
              <option value="change">Förändring</option>
              <option value="updated">Senast uppdaterad</option>
              <option value="confidence">Confidence</option>
              <option value="signals">Signaler</option>
            </select>
            <button onClick={()=>setSortDir(s=>s==='asc'?'desc':'asc')} className="px-2 py-1 border rounded">{sortDir==='asc'?'▲':'▼'}</button>
          </div>
          {loading && !viewModel ? (
            <div className="bg-white rounded-md p-8 border text-center">Laddar marknadsdata…</div>
          ) : (
            <div className="bg-white rounded-md p-4 border">
              <div className="text-xs text-gray-500 mb-2">Nyckeltal: Totalt {total} · Aktier {byType.STOCK} · ETF {byType.ETF} · Valutapar {byType.FOREX} · LIVE {statusCounts.LIVE||0} · DELAYED {statusCounts.DELAYED||0} · STALE {statusCounts.STALE||0} · UNAVAILABLE {statusCounts.UNAVAILABLE||0} · DI {diCount}</div>

              {total === 0 ? (
                <div className="p-6 text-center text-gray-600">Inga instrument i registret</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-gray-600">Inga instrument matchar dina filter</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th>Symbol</th><th>Namn</th><th>Typ</th><th>Valuta</th><th>Kurs</th><th>Förändring</th><th>Datastatus</th><th>Victor</th><th>Confidence</th><th>Signaler</th><th>Senast analyserad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => (
                      <tr key={r.instrumentId} className="border-t">
                        <td className="py-2">{r.symbol}</td>
                        <td>{r.name||'—'}</td>
                        <td>{r.assetType||'—'}</td>
                        <td>{r.currency||'—'}</td>
                        <td>{r.price !== null ? r.price.toFixed(2) : '—'}</td>
                        <td>{r.changePercent !== null ? `${r.changePercent.toFixed(2)}%` : '—'}</td>
                        <td>{r.dataStatus}</td>
                        <td>{r.victorAction|| (r.analyzedInLatestCycle ? 'Analyseras' : '—')}</td>
                        <td>{r.confidence !== null ? r.confidence : '—'}</td>
                        <td>{r.usableSignalCount}</td>
                        <td>{r.latestAnalysisAt ? new Date(r.latestAnalysisAt).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
