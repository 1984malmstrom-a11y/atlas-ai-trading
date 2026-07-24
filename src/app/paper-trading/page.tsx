"use client";
import React, { useState, useEffect } from 'react';
import LeftSidebar from '../../components/dashboard-v1/LeftSidebar';
import CompanyLogo from '../../components/CompanyLogo';

type Holding = any;

export default function Page(){
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<any>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const runInFlightRef = React.useRef(false);

  const bgInFlightRef = React.useRef(false);
  async function fetchState(silent = false){
    try{
      if (!silent) setLoading(true);
      const res = await fetch('/api/paper-trader');
      if (!res.ok){ if (!silent) setLoading(false); return; }
      const j = await res.json();
      setState(j);
    }catch(e){ console.error(e); }finally{ if (!silent) setLoading(false); }
  }

  useEffect(()=>{ fetchState(); }, []);

  // Background polling: fetch state every 30s when page is visible. No overlapping requests.
  useEffect(()=>{
    const POLL_MS = 30_000;
    let interval: any = null;

    const tryFetch = async () => {
      try{
        if (document.visibilityState !== 'visible') return;
        if (bgInFlightRef.current) return;
        bgInFlightRef.current = true;
        await fetchState(true);
      }catch(e){}
      finally{ bgInFlightRef.current = false; }
    };

    // immediate fetch when becoming visible
    const onVisibility = () => { if (document.visibilityState === 'visible') void tryFetch(); };
    document.addEventListener('visibilitychange', onVisibility);

    // start interval when mounted
    interval = setInterval(()=>{ void tryFetch(); }, POLL_MS);

    return ()=>{ document.removeEventListener('visibilitychange', onVisibility); if (interval) clearInterval(interval); };
  }, []);

  // Close panel on Escape and lock background scroll while open
  useEffect(()=>{
    function onKey(e: KeyboardEvent){ if (e.key === 'Escape') setSelectedAudit(null); }
    if (selectedAudit){ document.body.style.overflow = 'hidden'; window.addEventListener('keydown', onKey); }
    else { document.body.style.overflow = ''; }
    return ()=>{ window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [selectedAudit]);

  async function runCycle(){
    if (loading || runInFlightRef.current) return;
    runInFlightRef.current = true;
    setRunError(null);
    setLoading(true);
    try{
      const res = await fetch('/api/paper-trader', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ action: 'RUN_CYCLE' }) });
      if (!res.ok){
        // keep existing state, show discreet error
        setRunError('Körningen misslyckades. Försök igen.');
        return;
      }
      // refresh state from server
      await fetchState();
    }catch(e){
      console.error(e);
      setRunError('Nätverksfel vid körning. Försök igen.');
    }finally{
      runInFlightRef.current = false;
      setLoading(false);
    }
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
    // Simple, resilient track record builder: prefer explicit stored points if present
    function buildTrackRecord(){
      try{
        // Try to use any explicit track data on state
        if (state && state.track && Array.isArray(state.track.points)){
          const t = state.track;
          return {
            points: t.points || [],
            best: t.best ?? null,
            worst: t.worst ?? null,
            longestWin: t.longestWin ?? 0,
            longestLoss: t.longestLoss ?? 0,
            avgWin: t.avgWin ?? null,
            avgLoss: t.avgLoss ?? null,
          };
        }
        // Fallback: derive nothing (empty chart, no stats)
        return { points: [], best: null, worst: null, longestWin: 0, longestLoss: 0, avgWin: null, avgLoss: null };
      }catch(e){ return { points: [], best: null, worst: null, longestWin: 0, longestLoss: 0, avgWin: null, avgLoss: null }; }
    }
    const track = buildTrackRecord();

  const normalizedAudit = normalizeAuditEntries(auditEntries || []);

  // Time formatter for Swedish locale (Stockholm)
  function formatDateTimeLocal(ts:any, withSeconds = false){
    try{
      const d = (typeof ts === 'number') ? new Date(ts) : new Date(ts);
      const opts: any = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
      if (withSeconds) opts.second = '2-digit';
      return new Intl.DateTimeFormat('sv-SE', { ...opts, timeZone: 'Europe/Stockholm' }).format(d);
    }catch(e){ return String(ts); }
  }

  // Determine if an audit entry represents a decision-worthy event
  function isDecisionEvent(e:any){
    if (!e) return false;
    if (e.kind === 'EXECUTION') return true;
    const action = (e.decision && e.decision.action) || (e.request && e.request.side) || (e.proposal && e.proposal.action) || null;
    if (action && typeof action === 'string'){ const up = action.toUpperCase(); if (['BUY','SELL','HOLD'].includes(up)) return true; }
    if (e.kind === 'REJECT') return true;
    return false;
  }

  // Find the chronologically latest decision-like event
  function findLatestDecision(entries:any[]){
    if (!Array.isArray(entries) || entries.length===0) return null;
    const mapped = entries.map((e:any)=> ({ e, ts: e && e.timestamp ? (typeof e.timestamp==='number'? e.timestamp : Date.parse(e.timestamp)) : Date.now() }));
    mapped.sort((a:any,b:any)=> b.ts - a.ts);
    for (const m of mapped){ if (isDecisionEvent(m.e)) return m.e; }
    return null;
  }

  const latestDecisionEvent = findLatestDecision(normalizedAudit || []);

  // Small display helpers
  const portfolioValueFormatted = formatCurrency(portfolioValueNum);
  const totalReturnSekCalc = Number(totalReturnSek) || 0;
  const totalReturnSekFormatted = formatCurrency(totalReturnSekCalc);

  function kindBadge(action:any){
    if (!action) return (<span className="inline-flex items-center px-2 py-1 rounded text-xs bg-gray-100">—</span>);
    const a = String(action).toUpperCase();
    const cls = a === 'BUY' ? 'bg-green-100 text-green-700' : a === 'SELL' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-700';
    return (<span className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${cls}`}>{a}</span>);
  }

  function formatPrice(value:any, currency?:string){
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    try{
      if (currency && typeof currency === 'string'){
        return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currency }).format(n);
      }
    }catch(e){ /* fallthrough */ }
    return n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // --- Formatting helpers ------------------------------------------------
  function formatCurrency(v:any){
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
  }
  function formatCurrencyCompact(v:any){
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kr';
  }
  function formatQty(v:any){
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n).toLocaleString('sv-SE');
    return n.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  // Group audit entries by kind+symbol+minute to collapse repetitive messages
  function groupAuditEntries(entries:any[]){
    if (!Array.isArray(entries)) return [];
    const m = new Map<string, any>();
    for (const a of entries){
      const sym = (a.execution && a.execution.symbol) || (a.decision && a.decision.symbol) || (a.proposal && a.proposal.symbol) || '';
      const ts = a.timestamp ? (typeof a.timestamp === 'number' ? a.timestamp : Date.parse(a.timestamp)) : (a.decision && a.decision.generatedAt ? Date.parse(a.decision.generatedAt) : Date.now());
      // For EXECUTION entries avoid minute-level grouping so individual trades stay separate
      const timeKey = (a.kind === 'EXECUTION') ? String(ts) : String(Math.round(ts / 60000));
      // For rejection events include the reason message in key so different causes are not grouped together
      const reasonKey = a.reason && a.reason.message ? `|${a.reason.message}` : (a.summary && a.summary.executionStatus ? `|${a.summary.executionStatus}` : '');
      const key = `${a.kind || 'UNKNOWN'}|${sym}|${timeKey}${reasonKey}`;
      if (!m.has(key)) m.set(key, { kind: a.kind, symbol: sym, count: 0, first: ts, last: ts, sample: a });
      const val = m.get(key);
      val.count += 1;
      val.last = Math.max(val.last, ts);
    }
    const arr = Array.from(m.values()).sort((x:any,y:any)=> y.last - x.last);
    return arr;
  }

  // Normalize audit entries emitted in different shapes (file-backed store uses {summary, raw},
  // while some raw entries include `executed` arrays). Return a flat list of event-like objects
  // with `kind`, `timestamp`, `execution` or `decision` where applicable.
  function normalizeAuditEntries(entries:any[]){
    if (!Array.isArray(entries)) return [];
    const out: any[] = [];
    for (const e of entries){
      const raw = e && e.raw ? e.raw : e;
      const ts = e && e.timestamp ? e.timestamp : raw && raw.timestamp ? raw.timestamp : (raw && raw.createdAt ? raw.createdAt : new Date().toISOString());

      // If this entry contains an `executed` array (historical format), expand each execution
      if (raw && Array.isArray(raw.executed) && raw.executed.length>0){
        for (const ex of raw.executed){
          const proposal = ex && ex.proposal ? ex.proposal : (ex && ex.request ? ex.request : null);
          const result = ex && ex.result ? ex.result : null;
          out.push({
            kind: 'EXECUTION',
            timestamp: ts,
            execution: {
              symbol: proposal && proposal.symbol ? proposal.symbol : (result && result.symbol ? result.symbol : null),
              side: proposal && proposal.side ? proposal.side : (result && result.side ? result.side : null),
              executedPrice: result && result.executedPrice ? result.executedPrice : (result && result.price ? result.price : null),
              quantity: result && typeof result.quantity === 'number' ? result.quantity : (proposal && typeof proposal.quantity === 'number' ? proposal.quantity : null),
              fee: result && typeof result.fee === 'number' ? result.fee : null,
              orderId: result && result.orderId ? result.orderId : null,
              status: result && result.status ? result.status : null,
            },
            raw: raw,
          });
        }
        continue;
      }

      // If raw has an `execution` property already, keep it as EXECUTION
      if (raw && raw.execution && (raw.execution.executedPrice || raw.execution.quantity || raw.execution.status)){
        out.push({ kind: raw.kind || 'EXECUTION', timestamp: ts, execution: raw.execution, decision: raw.decision || raw.request || null, raw });
        continue;
      }

      // Otherwise include the raw entry as-is
      out.push(raw);
    }
    return out;
  }

  return (
    <>
      <LeftSidebar />
      <div style={{ marginLeft: 240 }} className="min-h-[80vh] bg-[#F9F6F1] p-8">
      {/* HERO */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-stretch justify-between gap-6">
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
            {/* Victor + Risk: moved here (compact row) */}
            <div className="mt-3 grid grid-cols-[1.2fr_0.8fr] gap-3 items-stretch max-w-2xl">
              <div className="bg-white rounded-xl p-3 shadow-sm border flex flex-col justify-between">
                <div>
                  <div className="text-xs text-gray-500">VICTOR</div>
                  <div className="mt-2 text-sm font-semibold">{loading ? 'Analyserar marknaden' : (latestDecision ? (latestDecision.type || 'Beslut fattat') : (enabled ? 'Bevakar marknaden' : 'Inaktiv'))}</div>
                  <div className="mt-1 text-xs text-gray-500">{latestDecision && latestDecision.generatedAt ? `Senaste beslut: ${new Date(latestDecision.generatedAt).toLocaleString()}` : (normalizedAudit && normalizedAudit.length>0 ? `Senaste aktivitet: ${normalizedAudit[0].kind || ''}` : 'Ingen senaste aktivitet')}</div>
                  <div className="mt-2 text-xs text-gray-600">{state.activeRecommendation ? state.activeRecommendation : 'Ingen aktiv rekommendation'}</div>
                </div>
              </div>

              <div className="bg-white rounded-xl p-3 shadow-sm border flex flex-col justify-center">
                <div className="text-xs text-gray-500">RISKKONTROLL</div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-sm">
                  {state.maxPosition !== undefined ? <div className="flex items-center justify-between"><div className="text-xs text-gray-500">Max position</div><div className="font-medium">{state.maxPosition}</div></div> : null}
                  {state.dailyLossLimit !== undefined ? <div className="flex items-center justify-between"><div className="text-xs text-gray-500">Daglig förlustgräns</div><div className="font-medium">{Number.isFinite(Number(state.dailyLossLimit)) ? Number(state.dailyLossLimit).toLocaleString() + ' kr' : state.dailyLossLimit}</div></div> : null}
                  {typeof state.tradesToday === 'number' ? <div className="flex items-center justify-between"><div className="text-xs text-gray-500">Affärer idag</div><div className="font-medium">{state.tradesToday}</div></div> : null}
                  { (state.maxPosition===undefined && state.dailyLossLimit===undefined && typeof state.tradesToday !== 'number') ? <div className="text-xs text-gray-500">Ingen riskdata tillgänglig</div> : null }
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-stretch">
            <div style={{ width: '100%' }} className="space-y-3 h-full">
              {/* Portfolio overview card */}
              <div className="bg-white rounded-xl p-5 shadow-sm border h-full flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-gray-500 uppercase">Portfölj</div>
                    <div className="mt-2">
                      <div className="text-3xl md:text-4xl font-extrabold text-blue-900">{portfolioValueFormatted}</div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="text-xs text-gray-500">Tillgängligt kapital</div>
                      <div className="text-right font-medium">{Number.isFinite(Number(availableCash)) ? Number(availableCash).toLocaleString() + ' kr' : '—'}</div>
                      <div className="text-xs text-gray-500">Investerat kapital</div>
                      <div className="text-right font-medium">{(() => { const invested = (Number(totalValue) && Number(availableCash) >= 0) ? Number(totalValue) - Number(availableCash) : NaN; return Number.isFinite(invested) ? Math.round(invested).toLocaleString() + ' kr' : '—'; })()}</div>
                      {state.todayPnL !== undefined ? (<><div className="text-xs text-gray-500">Dagens resultat</div><div className={`text-right font-medium ${state.todayPnL>0?'text-green-600':state.todayPnL<0?'text-rose-600':'text-gray-800'}`}>{Number.isFinite(Number(state.todayPnL))? (Number(state.todayPnL)>0?'+':'')+Number(state.todayPnL).toLocaleString() + ' kr' : '—'}</div></>) : null}
                      <div className="text-xs text-gray-500">Totalt resultat</div>
                      <div className={`text-right font-medium ${totalReturnSekCalc>0?'text-green-600':totalReturnSekCalc<0?'text-rose-600':'text-gray-800'}`}>{totalReturnSekFormatted}</div>
                    </div>
                  </div>
                  <div className="ml-4 text-right" style={{ minWidth: 120 }}>
                    <div className="text-xs text-gray-500">Systemstatus</div>
                    <div className="mt-2">
                      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border ${loading ? 'border-amber-100 bg-amber-50 text-amber-700' : enabled ? 'border-green-100 bg-green-50 text-green-700' : 'border-gray-100 bg-gray-50 text-gray-700'}`}>
                        <div className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-400' : enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                        <div className="text-sm font-medium">{loading ? 'Analyserar' : enabled ? 'Aktiv' : 'Pausad'}</div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-gray-500">Simulerade pengar</div>
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
                    {runError ? (<div className="mt-2 text-sm text-rose-600">{runError}</div>) : null}
                </div>
              </div>

              {/* (Victor + Risk moved to left column) */}
            </div>
          </div>
        </div>

        {/* VICTOR PERFORMANCE - premium single card */}
        <div className="mt-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border transition-shadow hover:shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">VICTOR PERFORMANCE</h2>
                <p className="text-sm text-gray-600">Så här presterar Victor sedan simuleringen startade.</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-5 gap-2">
              <div className="p-2">
                <div className="text-xs text-gray-500">AFFÄRER</div>
                <div className="mt-1 text-lg font-semibold">{(normalizedAudit && normalizedAudit.filter((a:any)=> a.kind === 'EXECUTION').length) || 0}</div>
              </div>

              <div className="p-2">
                <div className="text-xs text-gray-500">VINSTPROCENT</div>
                <div className="mt-1 text-lg font-semibold">
                  {(() => {
                    try{
                      if (!auditEntries || auditEntries.length === 0) return '—';
                      const sells = (normalizedAudit || []).filter((a:any)=> a.kind === 'EXECUTION' && a.execution && a.execution.side === 'SELL');
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

              <div className="p-2">
                <div className="text-xs text-gray-500">AKTIVT KAPITAL</div>
                <div className="mt-1 text-lg font-semibold">{(() => {
                  const invested = (Number(totalValue) && Number(availableCash) >= 0) ? Number(totalValue) - Number(availableCash) : NaN;
                  return Number.isFinite(invested) ? formatCurrency(invested) : '—';
                })()}</div>
                <div className="mt-1 w-full bg-gray-100 rounded-full h-2">
                  {(() => {
                    const invested = (Number(totalValue) && Number(availableCash) >= 0) ? Number(totalValue) - Number(availableCash) : NaN;
                    const pct = Number.isFinite(invested) && Number(totalValue) > 0 ? Math.min(100, Math.round((invested / Number(totalValue)) * 100)) : 0;
                    return <div className="h-2 rounded-full bg-blue-600" style={{ width: pct + '%' }} />;
                  })()}
                </div>
              </div>
              <div className="p-2">
                <div className="text-xs text-gray-500">GENOMSNITTLIG POSITION</div>
                <div className="mt-1 text-lg font-semibold">{(() => {
                  if (!Array.isArray(holdings) || holdings.length===0) return '—';
                  const sum = holdings.reduce((s:any,h:any)=> s + (Number(h.marketValue)||0), 0);
                  const avg = sum / holdings.length;
                  return Number.isFinite(avg) ? formatCurrencyCompact(avg) : '—';
                })()}</div>
              </div>

              <div className="p-2">
                <div className="text-xs text-gray-500">STÖRSTA POSITION</div>
                <div className="mt-1 text-lg font-semibold">{(() => {
                  if (!Array.isArray(holdings) || holdings.length===0) return '—';
                  const vals = holdings.map((h:any)=> ({ v: Number(h.marketValue)||0, s: h.symbol }));
                  const mx = vals.reduce((m:any,c:any)=> c.v> (m.v||0) ? c : m, {v:0,s:null});
                  if (!mx || mx.v === 0) return '—';
                  return `${mx.s || '—'} • ${formatCurrencyCompact(mx.v)}`;
                })()}</div>
              </div>
            </div>
          </div>
        </div>

        {/* VICTORS TRACK RECORD - placed under Victor Performance */}
        <div className="mt-6 bg-white rounded-xl p-5 shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">VICTORS SENASTE BESLUT</h3>
              <div className="text-sm text-gray-600">Senaste analysen och varför Victor valde att agera eller avstå.</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-12 gap-4 items-start">
            {/* Left: equity curve ~65% */}
            <div className="col-span-8">
              <div className="bg-white rounded-lg p-4 border shadow-sm">
                {(!track.best) ? (
                  <div className="py-4 text-sm text-gray-700">
                    <div className="font-semibold">Ingen avslutad affär ännu</div>
                    <div className="mt-1 text-xs text-gray-500">Resultatstatistik visas när Victor har genomfört en fullständig köp- och säljcykel.</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-gray-500">BÄSTA AFFÄR</div>
                      <div className="mt-1 font-semibold text-sm">{track.best && track.best.symbol ? track.best.symbol : '—'}</div>
                      <div className="text-sm text-gray-700">{track.best && Number.isFinite(Number(track.best.pnl)) ? Number(track.best.pnl).toLocaleString() + ' kr' : '—' } <span className="text-xs text-gray-500">{track.best && Number.isFinite(Number(track.best.pct)) ? ' • ' + Number(track.best.pct).toFixed(2) + '%' : ''}</span></div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500">SÄMSTA AFFÄR</div>
                      <div className="mt-1 font-semibold text-sm">{track.worst && track.worst.symbol ? track.worst.symbol : '—'}</div>
                      <div className="text-sm text-gray-700">{track.worst && Number.isFinite(Number(track.worst.pnl)) ? Number(track.worst.pnl).toLocaleString() + ' kr' : '—'} <span className="text-xs text-gray-500">{track.worst && Number.isFinite(Number(track.worst.pct)) ? ' • ' + Number(track.worst.pct).toFixed(2) + '%' : ''}</span></div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-gray-500">Längsta vinstsvit</div>
                        <div className="mt-1 font-semibold">{track.longestWin ? `${track.longestWin} affärer` : '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Längsta förlustsvit</div>
                        <div className="mt-1 font-semibold">{track.longestLoss ? `${track.longestLoss} affärer` : '—'}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-gray-500">Genomsnittlig vinst</div>
                        <div className="mt-1 font-semibold">{track.avgWin !== null ? Number(track.avgWin).toLocaleString() + ' kr' : '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Genomsnittlig förlust</div>
                        <div className="mt-1 font-semibold">{track.avgLoss !== null ? Number(track.avgLoss).toLocaleString() + ' kr' : '—'}</div>
                      </div>
                    </div>
                  </div>
                )}
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
        <div className="mt-8 grid grid-cols-12 gap-6 items-start lg:items-stretch">
          <div className="col-span-7">
            {/* Holdings table */}
            <div className="mt-0 bg-white rounded-xl p-6 shadow-sm border h-full flex flex-col">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">INNEHAV</div>
                <div className="text-xs text-gray-400">{holdings?.length || 0} innehav</div>
              </div>
              {(!holdings || holdings.length===0) ? (
                  <div className="mt-4 text-sm text-gray-500">Victor har ännu inte genomfört någon simulerad affär.</div>
                ) : (
                  <div className="mt-4 overflow-x-auto lg:overflow-x-visible flex-1">
                    <div className="flex-1 overflow-y-auto">
                      <table className="min-w-full text-sm table-fixed">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 sticky top-0 bg-white z-10">
                            <th className="px-2 py-2 w-[44px]">Logo</th>
                            <th className="px-2 py-2">Bolag</th>
                            <th className="px-2 py-2 w-[72px]">Ticker</th>
                            <th className="px-2 py-2 w-[64px] text-center">Antal</th>
                            <th className="px-2 py-2 w-[110px] text-right">Snittpris</th>
                            <th className="px-2 py-2 w-[110px] text-right">Nuvarande värde</th>
                            <th className="px-2 py-2 w-[110px] text-right">Resultat</th>
                          </tr>
                        </thead>
                        <tbody>
                          {holdings.map((h:any, idx:number)=> {
                            const result = (Number(h.marketValue) - (Number(h.averagePrice||0) * Number(h.quantity||0)));
                            return (
                            <tr key={h.symbol||idx} className="border-t hover:bg-gray-50">
                              <td className="py-2 px-2 align-top w-[44px]">{h.symbol ? <CompanyLogo symbol={h.symbol} name={h.name} size={36} innerPadding={6} /> : null}</td>
                              <td className="py-2 px-2 align-top max-w-[340px] overflow-hidden">
                                <div className="font-medium truncate">{h.name}</div>
                                <div className="text-xs text-gray-500">{h.symbol}</div>
                              </td>
                              <td className="py-2 px-2 align-top w-[72px]">{h.symbol}</td>
                              <td className="py-2 px-2 text-center align-top w-[64px]">{formatQty(h.quantity)}</td>
                              <td className="py-2 px-2 text-right align-top w-[110px]">{formatCurrencyCompact(h.averagePrice)}</td>
                              <td className="py-2 px-2 text-right align-top w-[110px]">{formatCurrencyCompact(h.marketValue)}</td>
                              <td className="py-2 px-2 text-right align-top w-[110px] whitespace-nowrap">{result >= 0 ? <span className="text-green-600">+{formatCurrencyCompact(result)}</span> : <span className="text-rose-600">{formatCurrencyCompact(result)}</span>}</td>
                            </tr>
                          )})}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
            </div>
          </div>

          <div className="col-span-5 flex flex-col gap-6">
            <div className="bg-white rounded-xl p-5 shadow-sm border h-full flex flex-col">
              <div className="text-sm font-medium">SENASTE AKTIVITET</div>
              <div className="mt-4 space-y-3 flex-1 overflow-y-auto">
                {normalizedAudit && normalizedAudit.length>0 ? (()=>{
                  const allGroups = groupAuditEntries(normalizedAudit);
                  const execGroups = allGroups.filter((x:any)=> x.kind === 'EXECUTION');
                  const otherGroups = allGroups.filter((x:any)=> x.kind !== 'EXECUTION');
                  const grouped = [...execGroups, ...otherGroups].slice(0,5);
                  return grouped.map((g:any, i:number)=>{
                    const a = g.sample;
                    const isExec = a && a.kind === 'EXECUTION' && a.execution;
                    const Wrapper: any = isExec ? 'button' : 'div';
                    const wrapperProps: any = isExec ? { onClick: ()=>setSelectedAudit(a), onKeyDown: (e:any)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setSelectedAudit(a); } }, 'aria-label': `Visa beslut för ${(a.execution&&a.execution.symbol)||(a.decision&&a.decision.symbol)||''}`, className: 'text-left w-full focus:outline-none focus:ring-2 focus:ring-blue-300 rounded' } : {};
                    const displayKind = a && (a.kind === 'EXECUTION' ? 'Köp genomfört' : a.kind === 'HOLD' ? 'HOLD' : 'Nekades av riskregel');
                    return (
                      <Wrapper key={g.symbol + '|' + g.first + '|' + i} {...wrapperProps}>
                        <div className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                          <div className={`w-3 h-3 rounded-full mt-1 ${a && a.kind==='EXECUTION' ? 'bg-green-500' : a && a.kind==='HOLD' ? 'bg-amber-400' : 'bg-rose-500'}`} />
                          <div>
                            <div className="flex items-center gap-2">
                              {g.symbol ? <CompanyLogo symbol={g.symbol} size={20} /> : null}
                              <div className="text-sm font-medium">{displayKind} {g.count>1 ? `×${g.count}` : ''}</div>
                            </div>
                            <div className="text-xs text-gray-500">{g.symbol || ''} • {g.last ? new Date(g.last).toLocaleString() : ''}</div>
                          </div>
                        </div>
                      </Wrapper>
                    );
                  });
                })() : <div className="text-sm text-gray-500">Ingen aktivitet ännu.</div>}
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
