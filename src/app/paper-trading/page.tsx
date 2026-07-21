"use client";
import React, { useState, useEffect } from 'react';
import LeftSidebar from '../../components/dashboard-v1/LeftSidebar';
import CompanyLogo from '../../components/CompanyLogo';

type Holding = any;

export default function Page(){
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<any>(null);

  async function fetchState(){
    try{
      const res = await fetch('/api/paper-trader');
      if (!res.ok) return;
      const j = await res.json();
      setState(j);
    }catch(e){ console.error(e); }
  }

  useEffect(()=>{ fetchState(); }, []);

  // Close panel on Escape and lock background scroll while open
  useEffect(()=>{
    function onKey(e: KeyboardEvent){ if (e.key === 'Escape') setSelectedAudit(null); }
    if (selectedAudit){ document.body.style.overflow = 'hidden'; window.addEventListener('keydown', onKey); }
    else { document.body.style.overflow = ''; }
    return ()=>{ window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [selectedAudit]);

  async function runCycle(){
    if (loading) return;
    setLoading(true);
    try{
      await fetch('/api/paper-trader', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ action: 'RUN_CYCLE' }) });
      await fetchState();
    }catch(e){ console.error(e); }
    setLoading(false);
  }

  async function toggleEnabled(){
    if (!state || loading) return;
    const action = state.enabled ? 'DISABLE' : 'ENABLE';
    setLoading(true);
    try{
      await fetch('/api/paper-trader', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ action }) });
      await fetchState();
    }catch(e){ console.error(e); }
    setLoading(false);
  }

  if (!state) return (<div className="p-8">Laddar Paper Trading…</div>);

  const { startCapital = 0, availableCash = 0, totalValue = 0, totalReturnSek = 0, totalReturnPercent = 0, enabled = false, latestDecision = null, auditEntries = [], holdings = [] } = state;

  // portfolioValue: prefer `state.portfolioValue` if present, otherwise `totalValue`
  const portfolioValueNum = ((): number => {
    const cand = state.portfolioValue ?? totalValue ?? 0;
    const n = Number(cand);
    return Number.isFinite(n) ? n : 0;
  })();

  const safeStart = Number.isFinite(Number(startCapital)) ? Number(startCapital) : 0;
  const totalReturnSekCalc = Number.isFinite(portfolioValueNum) && Number.isFinite(safeStart) ? (portfolioValueNum - safeStart) : 0;
  const totalReturnPercentCalc = safeStart > 0 && Number.isFinite(totalReturnSekCalc) ? (totalReturnSekCalc / safeStart) * 100 : 0;

  const portfolioValueFormatted = Number.isFinite(portfolioValueNum) ? portfolioValueNum.toLocaleString() + ' kr' : '—';
  const totalReturnSekFormatted = Number.isFinite(totalReturnSekCalc) ? (totalReturnSekCalc > 0 ? '+' : totalReturnSekCalc < 0 ? '' : '') + Math.round(totalReturnSekCalc).toLocaleString() + ' kr' : '—';
  const totalReturnPercentFormatted = Number.isFinite(totalReturnPercentCalc) ? (totalReturnPercentCalc > 0 ? '+' : totalReturnPercentCalc < 0 ? '' : '') + totalReturnPercentCalc.toFixed(2) + '%' : '—';

  const resultPositive = (totalReturnSek || 0) > 0;

  function kindBadge(action:any){
    if (!action) return <span className="px-2 py-1 text-xs rounded bg-gray-100">—</span>;
    const map:any = { 'BUY': ['KÖP','bg-green-50 text-green-700'], 'SELL': ['SÄLJ','bg-red-50 text-red-700'], 'HOLD': ['BEHÅLL','bg-amber-50 text-amber-700'] };
    const v = map[action] || [action, 'bg-gray-50 text-gray-700'];
    return <span className={`inline-block px-3 py-1 text-sm font-semibold rounded-full ${v[1]}`}>{v[0]}</span>;
  }

  function KPIIcon({name}:{name:string}){
    const cls = 'w-4 h-4 text-gray-400 flex-shrink-0';
    switch(name){
      case 'trades':
        return (<svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 12h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 5l5 7-5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>);
      case 'percent':
        return (<svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 5L5 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="6.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="17.5" cy="17.5" r="1.5" stroke="currentColor" strokeWidth="1.5"/></svg>);
      case 'capital':
        return (<svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="7" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M16 7V5a2 2 0 0 0-2-2H10a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>);
      case 'avg':
        return (<svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 13l4-4 4 8 4-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>);
      case 'largest':
        return (<svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l2.6 6.6L21 9l-5 3.6L17.2 21 12 17.8 6.8 21 8 12.6 3 9l6.4-0.4L12 2z" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" fill="currentColor"/></svg>);
      case 'recent':
      default:
        return (<svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/><path d="M12 7v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>);
    }
  }

  // --- Track record helpers (local, small & safe) -----------------------
  function safeNumber(v:any){ return Number.isFinite(Number(v)) ? Number(v) : null; }

  function buildTrackRecord(){
    try{
      const chronological = Array.isArray(auditEntries) ? auditEntries.slice().reverse() : [];
      const points: { t: string; value: number }[] = [];
      if (Number.isFinite(Number(startCapital))) points.push({ t: 'start', value: Number(startCapital) });

      for (const a of chronological){
        const v = a && a.portfolioAfter && safeNumber(a.portfolioAfter.totalValue);
        const ts = a && a.timestamp ? a.timestamp : (a && a.decision && a.decision.generatedAt) || new Date().toISOString();
        if (v !== null && v !== undefined) points.push({ t: ts, value: v });
      }

      const cur = safeNumber(totalValue);
      if (cur !== null){ const last = points.length>0 ? points[points.length-1] : null; if (!last || last.value !== cur) points.push({ t: 'now', value: cur }); }
      if (points.length === 0 && Number.isFinite(Number(startCapital))) points.push({ t: 'start', value: Number(startCapital) });

      const execs = (Array.isArray(auditEntries) ? auditEntries : []).filter((x:any)=> x.kind === 'EXECUTION').slice().reverse();
      const trades: { symbol?:string; pnl:number; pct?:number }[] = [];
      for (const e of execs){
        const before = e.portfolioBefore && safeNumber(e.portfolioBefore.totalValue);
        const after = e.portfolioAfter && safeNumber(e.portfolioAfter.totalValue);
        if (before !== null && after !== null){
          const pnl = Number((after - before));
          const pct = (before && before !== 0) ? (pnl / before * 100) : undefined;
          trades.push({ symbol: e.execution?.symbol || e.decision?.symbol, pnl, pct });
        }
      }

      let best:any = null; let worst:any = null;
      for (const t of trades){ if (t && typeof t.pnl === 'number'){ if (!best || t.pnl > best.pnl) best = t; if (!worst || t.pnl < worst.pnl) worst = t; } }

      let winStreak = 0, lossStreak = 0, maxWin = 0, maxLoss = 0;
      for (const t of trades){ if (t.pnl > 0){ winStreak++; maxWin = Math.max(maxWin, winStreak); lossStreak = 0; } else if (t.pnl < 0){ lossStreak++; maxLoss = Math.max(maxLoss, lossStreak); winStreak = 0; } else { winStreak = 0; lossStreak = 0; } }

      const wins = trades.filter((t)=> t.pnl>0).map((t)=> t.pnl||0);
      const losses = trades.filter((t)=> t.pnl<0).map((t)=> Math.abs(t.pnl||0));
      const avgWin = wins.length ? (wins.reduce((s:any,v:any)=> s+v,0)/wins.length) : null;
      const avgLoss = losses.length ? (losses.reduce((s:any,v:any)=> s+v,0)/losses.length) : null;

      return {
        points,
        best: best || null,
        worst: worst || null,
        longestWin: maxWin || 0,
        longestLoss: maxLoss || 0,
        avgWin: avgWin !== null ? Math.round(avgWin*100)/100 : null,
        avgLoss: avgLoss !== null ? Math.round(avgLoss*100)/100 : null,
      };
    }catch(e){ return { points: [], best:null, worst:null, longestWin:0, longestLoss:0, avgWin:null, avgLoss:null }; }
  }
  const track = buildTrackRecord();

  return (
    <>
      <LeftSidebar />
      <div style={{ marginLeft: 240 }} className="min-h-[80vh] bg-[#F9F6F1] p-8">
      {/* HERO */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold">PAPER TRADING</h1>
            <p className="mt-1 text-sm text-gray-700 max-w-2xl">Victor investerar ett simulerat kapital med samma riskmotor som kommer användas vid framtida autonom handel.</p>

            {/* Info card under title to fill empty hero space */}
            <div className="mt-4 max-w-2xl">
              <div className="bg-white rounded-xl p-4 shadow-sm border flex items-center gap-4">
                <div className="w-2 h-12 rounded bg-gradient-to-b from-[#D4AF37] to-[#B5882E]" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-800">Victor analyserar marknaden</div>
                  <div className="text-xs text-gray-500 mt-1">0 affärer genomförda idag</div>
                  <div className="text-xs text-gray-400 mt-2">Paper Trading använder samma riskmotor som framtida livehandel.</div>
                </div>
                <div className="text-sm text-gray-500">Demo</div>
              </div>
            </div>
          </div>
          <div className="flex items-start">
            <div className="bg-white rounded-xl p-6 shadow-sm border w-full md:w-[440px]">
              <div className="text-xs text-gray-500 uppercase">PORTFÖLJVÄRDE</div>
              <div className="mt-2">
                <div className="text-3xl md:text-5xl font-extrabold text-blue-900">{portfolioValueFormatted}</div>
              </div>

              <div className="mt-3 text-xs text-gray-500">TOTAL AVKASTNING</div>
              <div className="mt-1">
                <div className={`text-2xl font-semibold ${totalReturnSekCalc > 0 ? 'text-green-600' : totalReturnSekCalc < 0 ? 'text-rose-600' : 'text-gray-800'}`}>{totalReturnSekFormatted}</div>
                <div className={`mt-1 text-sm ${totalReturnPercentCalc > 0 ? 'text-green-600' : totalReturnPercentCalc < 0 ? 'text-rose-600' : 'text-gray-600'}`}>{totalReturnPercentFormatted}</div>
              </div>

              <div className="mt-4 border-t pt-3 border-gray-100">
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-400' : enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <div className={`${loading ? 'text-gray-700' : enabled ? 'text-green-600' : 'text-gray-600'} font-medium`}>{loading ? 'Victor analyserar' : enabled ? 'Aktiv' : 'Paper Trading pausad'}</div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Simulerade pengar</div>
                </div>
              </div>

              <div className="mt-4 border-t pt-3 border-gray-100">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button onClick={runCycle} disabled={loading || !enabled} className={`w-full sm:w-auto px-6 min-h-[42px] bg-blue-600 text-white font-semibold rounded-[12px] shadow-sm transition-colors transition-shadow duration-150 ease-in-out hover:bg-blue-700 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300 disabled:bg-blue-300 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${loading ? 'opacity-60' : ''}`}>
                    <svg aria-hidden className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3v18l15-9L5 3z" fill="currentColor"/></svg>
                    <span>{loading ? 'Kör...' : 'Kör Victor nu'}</span>
                  </button>
                  <button
                    onClick={toggleEnabled}
                    disabled={loading}
                    className={`w-full sm:w-auto px-6 min-h-[42px] bg-white text-gray-800 font-semibold rounded-[12px] shadow-sm border border-gray-200 transition-colors duration-150 ease-in-out hover:bg-gray-50 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-100 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
                  >
                    {enabled ? 'Pausa' : 'Aktivera'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* VICTOR PERFORMANCE - premium single card */}
        <div className="mt-4">
          <div className="bg-white rounded-xl p-6 shadow-sm border transition-shadow hover:shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">VICTOR PERFORMANCE</h2>
                <p className="text-sm text-gray-600">Så här presterar Victor sedan simuleringen startade.</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <KPIIcon name="trades" />
                  <div className="text-xs text-gray-500">AFFÄRER</div>
                </div>
                <div className="mt-2 text-2xl font-semibold">{(auditEntries && auditEntries.filter((a:any)=> a.kind === 'EXECUTION').length) || 0}</div>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2">
                  <KPIIcon name="percent" />
                  <div className="text-xs text-gray-500">VINSTPROCENT</div>
                </div>
                <div className="mt-2 text-2xl font-semibold">
                  {(() => {
                    try{
                      if (!auditEntries || auditEntries.length === 0) return '—';
                      const sells = auditEntries.filter((a:any)=> a.kind === 'EXECUTION' && a.execution && a.execution.side === 'SELL');
                      if (sells.length === 0) return '—';
                      const withBasis = sells.map((s:any)=>{
                        const before = s.portfolioBefore;
                        const h = before && Array.isArray(before.holdings) ? before.holdings.find((x:any)=> x.symbol === s.execution.symbol) : null;
                        if (!h) return null;
                        const cost = (h.averagePrice || h.averagePrice === 0) ? (h.averagePrice * (s.execution.quantity||0)) : null;
                        const proceeds = (s.execution.executedPrice || 0) * (s.execution.quantity||0);
                        if (cost === null) return null;
                        return proceeds - cost;
                      }).filter((x:any)=> x !== null);
                      if (withBasis.length === 0) return '—';
                      const wins = withBasis.filter((p:any)=> p > 0).length;
                      return Math.round((wins / withBasis.length) * 100) + ' %';
                    }catch(e){ return '—'; }
                  })()}
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2">
                  <KPIIcon name="capital" />
                  <div className="text-xs text-gray-500">AKTIVT KAPITAL</div>
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {(() => {
                    const invested = (Number(totalValue) && Number(availableCash) >= 0) ? Number(totalValue) - Number(availableCash) : NaN;
                    return Number.isFinite(invested) ? invested.toLocaleString() + ' kr' : '—';
                  })()}
                </div>
                <div className="mt-3 w-full bg-gray-100 rounded-full h-2">
                  {(() => {
                    const invested = (Number(totalValue) && Number(availableCash) >= 0) ? Number(totalValue) - Number(availableCash) : NaN;
                    const pct = Number.isFinite(invested) && Number(totalValue) > 0 ? Math.min(100, Math.round((invested / Number(totalValue)) * 100)) : 0;
                    return <div className="h-2 rounded-full bg-blue-600" style={{ width: pct + '%' }} />;
                  })()}
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2">
                  <KPIIcon name="avg" />
                  <div className="text-xs text-gray-500">GENOMSNITTLIG POSITION</div>
                </div>
                <div className="mt-2 text-2xl font-semibold">
                  {(() => {
                    if (!holdings || holdings.length === 0) return '—';
                    const sum = holdings.reduce((s:any,h:any)=> s + (Number(h.marketValue)||0), 0);
                    const avg = sum / holdings.length;
                    return Number.isFinite(avg) ? Math.round(avg).toLocaleString() + ' kr' : '—';
                  })()}
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2">
                  <KPIIcon name="largest" />
                  <div className="text-xs text-gray-500">STÖRSTA POSITION</div>
                </div>
                <div className="mt-2 text-lg font-semibold flex items-center gap-3">
                  {(() => {
                    if (!holdings || holdings.length === 0) return '—';
                    const max = holdings.reduce((best:any,h:any)=> ( (h.marketValue||0) > (best.marketValue||0) ? h : best ), holdings[0]);
                    if (!max) return '—';
                    return (
                      <div className="flex items-center gap-3">
                        {max.symbol ? <CompanyLogo symbol={max.symbol} name={max.name} size={28} className="rounded" /> : null}
                        <div>{max.symbol || max.name || '—'} • {Number.isFinite(Number(max.marketValue)) ? Number(max.marketValue).toLocaleString() + ' kr' : '—'}</div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2">
                  <KPIIcon name="recent" />
                  <div className="text-xs text-gray-500">SENASTE AKTIVITET</div>
                </div>
                <div className="mt-2 text-sm font-medium">
                  {(() => {
                    if (!auditEntries || auditEntries.length === 0) return '—';
                    const latest = auditEntries[0];
                    if (!latest) return '—';
                      if (latest.kind === 'EXECUTION'){
                        const side = latest.execution?.side === 'BUY' ? 'Köp' : (latest.execution?.side === 'SELL' ? 'Sälj' : 'Genomförd');
                        return (
                          <button onClick={()=>setSelectedAudit(latest)} onKeyDown={(e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setSelectedAudit(latest); } }} aria-label={`Visa beslut för ${latest.execution?.symbol || latest.decision?.symbol || ''}`} className="text-left text-sm font-medium text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-300">
                            {`${side} ${latest.execution?.symbol || latest.decision?.symbol || ''}`.trim()}
                          </button>
                        );
                      }
                    if (latest.kind === 'HOLD') return 'BEHÅLL';
                    if (latest.kind === 'REJECT') return 'Riskregel stoppade order';
                    return '—';
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* VICTORS TRACK RECORD - placed under Victor Performance */}
        <div className="mt-6 bg-white rounded-xl p-5 shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">VICTORS TRACK RECORD</h3>
              <div className="text-sm text-gray-600">Hur väl har Victor presterat sedan simuleringen startade?</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-12 gap-4 items-start">
            {/* Left: equity curve ~65% */}
            <div className="col-span-8">
              <div className="bg-white rounded-lg p-4 border shadow-sm">
                {(() => {
                  // Determine whether there is verifiable history.
                  // Consider an execution (BUY/SELL) as definitive history.
                  const execs = (Array.isArray(auditEntries) ? auditEntries.filter((x:any)=> x.kind === 'EXECUTION' && (x.execution?.side === 'BUY' || x.execution?.side === 'SELL')) : []);
                  const pts = Array.isArray(track.points) ? track.points : [];
                  // meaningfulPoints: points with finite numeric values
                  const meaningfulPts = pts.filter((p:any)=> Number.isFinite(Number(p?.value)));
                  // If more than one distinct value exists among points, treat as real portfolio history
                  const distinctValues = Array.from(new Set(meaningfulPts.map((p:any)=> Number(p.value))));
                  const hasPortfolioHistory = distinctValues.length > 1;
                  const hasHistory = execs.length > 0 || hasPortfolioHistory;

                  // Show empty state ONLY when there are no executed BUY/SELL trades
                  // and there is no real portfolio history yet.
                  if (!hasHistory){
                    return (
                      <div className="py-6 text-left text-gray-700">
                        <div className="text-lg font-semibold">VICTOR BYGGER SIN HISTORIK</div>
                        <div className="mt-2 text-sm text-gray-700">Victor bygger nu upp sin verifierbara historik. Starta den första simuleringen med knappen högst upp för att börja följa hur han presterar över tid.</div>
                        <ul className="mt-3 text-sm text-gray-600 space-y-2">
                          <li className="flex items-start gap-2"><KPIIcon name="trades" /><span>Portföljutveckling</span></li>
                          <li className="flex items-start gap-2"><KPIIcon name="largest" /><span>Bästa och sämsta affär</span></li>
                          <li className="flex items-start gap-2"><KPIIcon name="avg" /><span>Vinst- och förlustsviter</span></li>
                          <li className="flex items-start gap-2"><KPIIcon name="percent" /><span>Genomsnittlig vinst och förlust</span></li>
                        </ul>
                        <div className="mt-2 text-xs text-gray-500">Simulerade pengar. Ingen riktig order skickas till marknaden.</div>
                      </div>
                    );
                  }
                  // render normal track record when history exists
                  const pts2 = track.points || [];
                  const vals = pts2.map(p=>p.value).filter(v=> Number.isFinite(Number(v)));
                  if (vals.length === 0) return <div className="py-12 text-center text-gray-500">—</div>;
                  const min = Math.min(...vals);
                  const max = Math.max(...vals);
                  const n = pts2.length;
                  const coords = pts2.map((p,i)=>{
                    const x = n===1 ? 50 : (i/(n-1))*100;
                    const y = (max === min) ? 50 : (1 - ( (p.value - min) / (max - min) )) * 80 + 10;
                    return `${x},${y}`;
                  }).join(' ');
                  const area = `0,100 ${coords} 100,100`;
                  const line = coords;
                  const firstLabel = pts2[0] && Number.isFinite(Number(pts2[0].value)) ? Number(pts2[0].value).toLocaleString() + ' kr' : '—';
                  const lastLabel = pts2[pts2.length-1] && Number.isFinite(Number(pts2[pts2.length-1].value)) ? Number(pts2[pts2.length-1].value).toLocaleString() + ' kr' : '—';
                  return (
                    <div>
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-48">
                        <defs>
                          <linearGradient id="tg" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="#dcfce7" stopOpacity="0.8" />
                            <stop offset="100%" stopColor="#ecfeff" stopOpacity="0.2" />
                          </linearGradient>
                        </defs>
                        <polygon points={area} fill="url(#tg)" />
                        <polyline points={line} fill="none" stroke="#047857" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                      </svg>
                      <div className="mt-2 flex justify-between text-xs text-gray-500">
                        <div>Start • {firstLabel}</div>
                        <div>Nu • {lastLabel}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Right: stats ~35% */}
            <div className="col-span-4">
              <div className="bg-white rounded-lg p-4 border shadow-sm space-y-3">
                <div>
                  <div className="text-xs text-gray-500">BÄSTA AFFÄR</div>
                  <div className="mt-1 font-semibold text-sm">
                    {track.best && track.best.symbol ? track.best.symbol : '—'}
                  </div>
                  <div className="text-sm text-gray-700">{track.best && Number.isFinite(Number(track.best.pnl)) ? Number(track.best.pnl).toLocaleString() + ' kr' : '—' } <span className="text-xs text-gray-500">{track.best && Number.isFinite(Number(track.best.pct)) ? ' • ' + Number(track.best.pct).toFixed(2) + '%' : ''}</span></div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">SÄMSTA AFFÄR</div>
                  <div className="mt-1 font-semibold text-sm">{track.worst && track.worst.symbol ? track.worst.symbol : '—'}</div>
                  <div className="text-sm text-gray-700">{track.worst && Number.isFinite(Number(track.worst.pnl)) ? Number(track.worst.pnl).toLocaleString() + ' kr' : '—'} <span className="text-xs text-gray-500">{track.worst && Number.isFinite(Number(track.worst.pct)) ? ' • ' + Number(track.worst.pct).toFixed(2) + '%' : ''}</span></div>
                </div>

                <div className="pt-2">
                  <div className="text-xs text-gray-500">LÄNGSTA VINSTSVIT</div>
                  <div className="mt-1 font-semibold">{track.longestWin ? `${track.longestWin} affärer` : '—'}</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">LÄNGSTA FÖRLUSTSVIT</div>
                  <div className="mt-1 font-semibold">{track.longestLoss ? `${track.longestLoss} affärer` : '—'}</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">GENOMSNITTLIG VINST</div>
                  <div className="mt-1 font-semibold">{track.avgWin !== null ? Number(track.avgWin).toLocaleString() + ' kr' : '—'}</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">GENOMSNITTLIG FÖRLUST</div>
                  <div className="mt-1 font-semibold">{track.avgLoss !== null ? Number(track.avgLoss).toLocaleString() + ' kr' : '—'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Removed duplicate KPI row - values are shown in Victor Performance and Portföljstatus */}

        {/* VICTOR'S LATEST DECISION - promoted to main focus */}
        <div className="mt-6 bg-white rounded-xl p-5 shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500">DAGENS ANALYS</div>
              {latestDecision ? (
                <div className="text-xs text-gray-400">Victor har analyserat marknaden</div>
              ) : (
                <div className="text-xs text-gray-400">Victor har ännu inte analyserat marknaden idag.</div>
              )}
              <div className="mt-2 flex items-center gap-4">
                  {latestDecision?.symbol ? (
                    <CompanyLogo symbol={latestDecision.symbol} name={latestDecision.companyName || undefined} size={44} className="rounded" />
                  ) : null}
                  <div className="flex flex-col sm:flex-row sm:items-baseline gap-2">
                    <div className="text-3xl font-bold">{latestDecision?.symbol || '—'}</div>
                    <div className="flex items-center gap-3">
                      <div>{kindBadge(latestDecision?.action)}</div>
                      <div className="text-sm text-gray-600">Confidence: {latestDecision?.confidence ?? '—'}%</div>
                    </div>
                  </div>
              </div>
            </div>
            <div className="text-sm text-gray-500">Senaste körning: {latestDecision?.generatedAt ? new Date(latestDecision.generatedAt).toLocaleString() : '—'}</div>
          </div>

          {/* Motivering removed — explanations are rendered in the analysis section below */}

          <div className="mt-6 pt-4 border-t border-gray-100">
            <div className="text-sm text-gray-500">VICTORS ANALYS</div>
            <div className="mt-1 text-xs text-gray-600">Därför rekommenderar Victor detta beslut.</div>

            <div className="mt-4">
              {(() => {
                const reasoning = Array.isArray(latestDecision?.reasoning) ? latestDecision.reasoning : [];

                // system keywords: these sentences are simulation/system info and must be shown separately
                const sysKeywords = ['simulerad','verifiering','paper trader','ingen riktig order','skickas till marknaden','demo','test','runtime','api','ingen riktig order skickades','ingen riktig order skickas','simulerad victor','simulerad victor-cykel'];

                const systemParts: string[] = [];
                const financialParts: string[] = [];
                for (const r of reasoning){
                  const text = (''+r).toLowerCase();
                  if (sysKeywords.some(k => text.includes(k))){ systemParts.push(r); }
                  else { financialParts.push(r); }
                }

                const categories: { key: string; title: string; keywords: string[] }[] = [
                  { key: 'risk', title: 'Riskbedömning', keywords: ['risk','position','cooldown','kapital','limit','exposure'] },
                  { key: 'fund', title: 'Fundamental analys', keywords: ['värdering','vinst','omsättning','pe','cashflow','intäkt','vinstmarginal'] },
                  { key: 'tech', title: 'Teknisk analys', keywords: ['trend','momentum','pris','stochastic','rsi','glidande'] },
                  { key: 'macro', title: 'Makroekonomi', keywords: ['ränta','inflation','marknad','konjunktur','riksbank'] },
                  { key: 'news', title: 'Nyhetspåverkan', keywords: ['nyhet','rapport','pressmeddelande','utdelning','analytiker'] },
                  { key: 'alternative', title: 'Alternativ Victor valde bort', keywords: ['hold','reject','nekades','avslagen'] },
                ];

                const classified: Record<string,string[]> = {};
                for (const c of categories) classified[c.key] = [];
                const leftover: string[] = [];

                for (const r of financialParts){
                  const text = (''+r).toLowerCase();
                  let matched = false;
                  for (const c of categories){
                    for (const kw of c.keywords){ if (text.includes(kw)) { classified[c.key].push(r); matched = true; break; } }
                    if (matched) break;
                  }
                  if (!matched) leftover.push(r);
                }

                // build analysisSections: overall leftover first (if present), then only non-empty validated categories
                const analysisSections: { key: string; title: string; items: string[] }[] = [];
                if (leftover.length > 0) analysisSections.push({ key: 'overall', title: 'ÖVERGRIPANDE BEDÖMNING', items: leftover });
                for (const c of categories){
                  const items = classified[c.key] || [];
                  if (items.length > 0) analysisSections.push({ key: c.key, title: c.title, items });
                }

                // If still no sections, show compact message and simulation info only
                if (analysisSections.length === 0){
                  return (
                    <div>
                      <div className="text-sm text-gray-700">Det finns ännu inget tillräckligt finansiellt analysunderlag bakom detta simulerade beslut.</div>
                      {systemParts.length>0 && (
                        <div className="mt-3 bg-gray-50 rounded p-2 text-xs text-gray-500 border">
                          <div className="text-xs">SIMULERINGSINFORMATION</div>
                          <div className="mt-2">{systemParts.map((t)=> (<p key={'sys-'+String(t).slice(0,60)} className="leading-5 text-xs">{t}</p>))}</div>
                        </div>
                      )}
                    </div>
                  );
                }

                // Render validated analysis sections and optional simulation info below
                return (
                  <div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {analysisSections.map(s=> (
                        <div key={s.key} className="bg-gray-50 rounded p-3 border">
                          <div className="text-xs text-gray-500">{s.title}</div>
                          <div className="mt-2 text-sm text-gray-700">{s.items.map(t=>(<p key={s.key+'|'+String(t).slice(0,60)} className="leading-5">{t}</p>))}</div>
                        </div>
                      ))}
                    </div>
                    {systemParts.length>0 && (
                      <div className="mt-4 bg-gray-50 rounded p-2 text-xs text-gray-500 border">
                        <div className="text-xs">SIMULERINGSINFORMATION</div>
                        <div className="mt-2">{systemParts.map((t)=> (<p key={'sys2-'+String(t).slice(0,60)} className="leading-5 text-xs">{t}</p>))}</div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          
        </div>

        {/* removed duplicate standalone analysis section (now handled inside main AI card) */}

        {/* Two columns */}
        <div className="mt-8 grid grid-cols-12 gap-6">
          <div className="col-span-8">
            {/* Holdings table */}
            <div className="mt-0 bg-white rounded-xl p-6 shadow-sm border">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">INNEHAV</div>
                <div className="text-xs text-gray-400">{holdings?.length || 0} innehav</div>
              </div>
              {(!holdings || holdings.length===0) ? (
                <div className="mt-4 text-sm text-gray-500">Victor har ännu inte genomfört någon simulerad affär.</div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="w-1/12">Logo</th>
                        <th className="w-3/12">Bolag</th>
                        <th className="w-2/12">Ticker</th>
                        <th className="w-2/12">Antal</th>
                        <th className="w-2/12">Snittpris</th>
                        <th className="w-2/12">Nuvarande värde</th>
                        <th className="w-2/12">Resultat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.map((h:any, idx:number)=> (
                        <tr key={h.symbol||idx} className="border-t">
                          <td className="py-3">{h.symbol ? <CompanyLogo symbol={h.symbol} name={h.name} size={36} innerPadding={6} /> : null}</td>
                          <td className="py-3">
                            <div className="font-medium">{h.name}</div>
                            <div className="text-xs text-gray-500">{h.symbol}</div>
                          </td>
                          <td className="py-3">{h.symbol}</td>
                          <td className="py-3">{h.quantity}</td>
                          <td className="py-3">{h.averagePrice}</td>
                          <td className="py-3">{h.marketValue}</td>
                          <td className="py-3">{/* result */}{h.marketValue - (h.averagePrice*h.quantity) >= 0 ? <span className="text-green-600">+{Math.round((h.marketValue - (h.averagePrice*h.quantity))*100)/100}</span> : <span className="text-rose-600">{Math.round((h.marketValue - (h.averagePrice*h.quantity))*100)/100}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="col-span-4 flex flex-col gap-6">
            <div className="bg-white rounded-xl p-5 shadow-sm border">
              <div className="text-sm text-gray-500">PORTFÖLJSTATUS</div>
              <div className="mt-3 text-2xl font-semibold">{Number(totalValue).toLocaleString()} kr</div>
              <div className="mt-2 text-sm text-gray-600">Likvida medel: {Number(availableCash).toLocaleString()} kr</div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-sm text-gray-500">Antal innehav</div>
                <div className="text-sm font-medium">{holdings.length}</div>
              </div>
              <div className="mt-3 text-sm text-gray-500">Senaste körning: {state.latestCycle ? `${state.latestCycle.processed} beslut` : '—'}</div>
              <div className="mt-4">
                <div className="text-sm text-gray-500">Investerat kapital</div>
                <div className="mt-2 text-xl font-semibold">{Math.round(( (totalValue - availableCash) / (totalValue || 1) * 100)) || 0}%</div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 shadow-sm border">
              <div className="text-sm font-medium">SENASTE AKTIVITET</div>
              <div className="mt-4 space-y-3">
                {auditEntries && auditEntries.length>0 ? auditEntries.slice(0,10).map((a:any, i:number)=> {
                  const isExec = a.kind === 'EXECUTION' && a.execution;
                  const Wrapper: any = isExec ? 'button' : 'div';
                  const wrapperProps: any = isExec ? { onClick: ()=>setSelectedAudit(a), onKeyDown: (e:any)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setSelectedAudit(a); } }, 'aria-label': `Visa beslut för ${(a.execution&&a.execution.symbol)||(a.decision&&a.decision.symbol)||''}`, className: 'text-left w-full focus:outline-none focus:ring-2 focus:ring-blue-300 rounded' } : {};
                  return (
                    <Wrapper key={a.id||i} {...wrapperProps}>
                      <div className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                        <div className={`w-3 h-3 rounded-full mt-1 ${a.kind==='EXECUTION' ? 'bg-green-500' : a.kind==='HOLD' ? 'bg-amber-400' : 'bg-rose-500'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            {((a.execution && a.execution.symbol) || (a.decision && a.decision.symbol)) ? (
                              <CompanyLogo symbol={(a.execution && a.execution.symbol) || (a.decision && a.decision.symbol)} size={20} />
                            ) : null}
                            <div className="text-sm font-medium">{a.kind === 'EXECUTION' ? 'Köp genomfört' : a.kind === 'HOLD' ? 'HOLD' : 'Nekades av riskregel'}</div>
                          </div>
                          <div className="text-xs text-gray-500">{a.decision?.symbol || a.execution?.symbol || ''} • {new Date(a.timestamp).toLocaleString()}</div>
                          {a.reason && <div className="text-xs text-gray-600 mt-1">{a.reason.message}</div>}
                          {a.execution && <div className="text-xs text-gray-600 mt-1">{a.execution.side} {a.execution.quantity} @ {a.execution.executedPrice} kr</div>}
                        </div>
                      </div>
                    </Wrapper>
                  );
                }) : <div className="text-sm text-gray-500">Ingen aktivitet ännu.</div>}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-gray-500">Paper Trading använder endast simulerade pengar och utgör inte finansiell rådgivning.</div>
        {/* Decision side panel / modal */}
        {selectedAudit && (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={()=>setSelectedAudit(null)} />
            <div role="dialog" aria-modal="true" aria-label="Victors beslut" className="relative w-full md:max-w-2xl bg-white rounded-t-xl md:rounded-xl shadow-lg m-4 md:m-0 p-4 overflow-auto max-h-[90vh]" onClick={(e)=>e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {selectedAudit.execution?.symbol ? <CompanyLogo symbol={selectedAudit.execution.symbol} size={40} /> : null}
                  <div>
                    <div className="text-lg font-semibold">{selectedAudit.execution?.symbol || selectedAudit.decision?.symbol || '—'}</div>
                    <div className="text-sm text-gray-500">{selectedAudit.execution?.side || selectedAudit.decision?.action}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-600">Confidence: {selectedAudit.decision?.confidence ?? '—'}%</div>
                  <button onClick={()=>setSelectedAudit(null)} aria-label="Stäng panel" className="ml-2 text-gray-500 hover:text-gray-700">Stäng</button>
                </div>
              </div>
              {!selectedAudit.decision || !selectedAudit.execution ? (
                <div className="mt-3 text-sm text-gray-500">Fullständigt beslutsunderlag sparades inte för denna äldre affär.</div>
              ) : null}

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500">DATUM OCH TID</div>
                  <div className="font-medium">{selectedAudit.timestamp ? new Date(selectedAudit.timestamp).toLocaleString() : (selectedAudit.decision?.generatedAt ? new Date(selectedAudit.decision.generatedAt).toLocaleString() : '—')}</div>

                  <div className="mt-3 text-xs text-gray-500">REFERENSPRIS</div>
                  <div className="font-medium">{selectedAudit.decision?.referencePrice !== undefined ? (Number(selectedAudit.decision.referencePrice).toLocaleString() + ' kr') : '—'}</div>

                  <div className="mt-3 text-xs text-gray-500">GENOMFÖRT PRIS</div>
                  <div className="font-medium">{selectedAudit.execution?.executedPrice !== undefined ? (Number(selectedAudit.execution.executedPrice).toLocaleString() + ' kr') : '—'}</div>

                  <div className="mt-3 text-xs text-gray-500">ANTAL</div>
                  <div className="font-medium">{selectedAudit.execution?.quantity ?? '—'}</div>

                  <div className="mt-3 text-xs text-gray-500">AFFÄRSVÄRDE</div>
                  <div className="font-medium">{selectedAudit.execution?.notional !== undefined ? (Number(selectedAudit.execution.notional).toLocaleString() + ' kr') : '—'}</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">BESLUTSUNDERLAG</div>
                  <div className="mt-2 text-sm text-gray-700">
                    {(() => {
                      const reasoning = Array.isArray(selectedAudit.decision?.reasoning) ? selectedAudit.decision.reasoning : (selectedAudit.decision?.reasoning ? [selectedAudit.decision.reasoning] : []);
                      const sysKeywords = ['simulerad','verifiering','paper trader','ingen riktig order','skickas till marknaden','demo','test','runtime','api','ingen riktig order skickades','ingen riktig order skickas','simulerad victor','simulerad victor-cykel'];
                      const systemParts: string[] = [];
                      const financialParts: string[] = [];
                      for (const r of reasoning){ const text = (''+r).toLowerCase(); if (sysKeywords.some(k=>text.includes(k))) systemParts.push(r); else financialParts.push(r); }
                      const categories = [
                        { key: 'risk', title: 'Riskbedömning', keywords: ['risk','position','cooldown','kapital','limit','exposure'] },
                        { key: 'fund', title: 'Fundamental analys', keywords: ['värdering','vinst','omsättning','pe','cashflow','intäkt','vinstmarginal'] },
                        { key: 'tech', title: 'Teknisk analys', keywords: ['trend','momentum','pris','stochastic','rsi','glidande'] },
                        { key: 'macro', title: 'Makroekonomi', keywords: ['ränta','inflation','marknad','konjunktur','riksbank'] },
                        { key: 'news', title: 'Nyhetspåverkan', keywords: ['nyhet','rapport','pressmeddelande','utdelning','analytiker'] },
                        { key: 'alternative', title: 'Alternativ Victor valde bort', keywords: ['hold','reject','nekades','avslagen'] },
                      ];
                      const classified: Record<string,string[]> = {} as any; for (const c of categories) classified[c.key]=[];
                      const leftover: string[] = [];
                      for (const r of financialParts){ const text = (''+r).toLowerCase(); let matched=false; for (const c of categories){ for (const kw of c.keywords){ if (text.includes(kw)){ classified[c.key].push(r); matched=true; break; } } if (matched) break; } if (!matched) leftover.push(r); }
                      const sections: { key:string; title:string; items:string[] }[] = [];
                      if (leftover.length>0) sections.push({ key: 'overall', title: 'ÖVERGRIPANDE BEDÖMNING', items: leftover });
                      for (const c of categories){ const items = classified[c.key]||[]; if (items.length>0) sections.push({ key: c.key, title: c.title, items }); }
                      if (sections.length===0){ if (systemParts.length===0) return <div className="text-sm text-gray-700">Ingen sparad beslutsmotivering.</div>; return (<div><div className="text-sm text-gray-700">Ingen sparad finansiell analys.</div><div className="mt-2 text-xs text-gray-500">SIMULERINGSINFORMATION</div><div className="mt-1 text-xs text-gray-700">{systemParts.map((t:any,i:number)=>(<p key={i}>{t}</p>))}</div></div>); }
                      return (<div>{sections.map(s=> (<div key={s.key} className="mb-3"><div className="text-xs text-gray-500">{s.title}</div><div className="mt-1 text-sm text-gray-700">{s.items.map((t:any,i:number)=>(<p key={s.key+'-'+i} className="leading-5">{t}</p>))}</div></div>))}{systemParts.length>0 && (<div className="mt-2 text-xs text-gray-500">SIMULERINGSINFORMATION<div className="mt-1 text-xs text-gray-700">{systemParts.map((t:any,i:number)=>(<p key={'sys-'+i}>{t}</p>))}</div></div>)}</div>);
                    })()}
                  </div>

                  <div className="mt-4 text-xs text-gray-500">RISK OCH GENOMFÖRANDE</div>
                  <div className="mt-1 text-sm text-gray-700">
                    <div>{selectedAudit.reason ? `${selectedAudit.reason.code || ''} ${selectedAudit.reason.message || ''}` : '—'}</div>
                    <div className="mt-2">Portfölj före: {selectedAudit.portfolioBefore ? (Number(selectedAudit.portfolioBefore.totalValue||0).toLocaleString() + ' kr') : '—'}</div>
                    <div>Portfölj efter: {selectedAudit.portfolioAfter ? (Number(selectedAudit.portfolioAfter.totalValue||0).toLocaleString() + ' kr') : '—'}</div>
                    <div>Cash före: {selectedAudit.portfolioBefore ? (Number(selectedAudit.portfolioBefore.availableCash||0).toLocaleString() + ' kr') : '—'}</div>
                    <div>Cash efter: {selectedAudit.portfolioAfter ? (Number(selectedAudit.portfolioAfter.availableCash||0).toLocaleString() + ' kr') : '—'}</div>
                    {(() => {
                      const ref = selectedAudit.decision?.referencePrice; const execp = selectedAudit.execution?.executedPrice;
                      if (ref !== undefined && execp !== undefined && Number.isFinite(Number(ref)) && Number.isFinite(Number(execp)) && Number(ref) !== 0){
                        const sl = ((Number(execp) - Number(ref)) / Number(ref)) * 100;
                        const slFormatted = Number.isFinite(sl) ? sl.toFixed(2) + '%' : '—';
                        return (<div className="mt-2">Slippage: {slFormatted}</div>);
                      }
                      return null;
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </>
  );
}
