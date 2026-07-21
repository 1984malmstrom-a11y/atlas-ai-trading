"use client";
import React, { useState, useEffect } from 'react';
import runDailySimulation from '../../domain/simulation/daily-simulation-service';
import DecisionCard from './DecisionCard';
import CoachBriefing from './CoachBriefing';
import ls from '../../lib/local-storage';
import mockAnalysis from '../../data/mock-analysis-data';
import { getMockPortfolio } from '../../data/mock-portfolio';
import { PaperTradingEngine, Order } from '../../domain/trading/paper-trading-engine';

export default function DailySimulationPanel(){
  const [lastRun, setLastRun] = useState<any>(null);
  const [prevRun, setPrevRun] = useState<any>(null);
  const [decisionStatuses, setDecisionStatuses] = useState<Record<string,string>>(()=> ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {});
  const [running, setRunning] = useState(false);

  function handleRun(){
    setRunning(true);
    try{
      const res = runDailySimulation();
      // before overwriting saved lastRun, move it to prev
      try{
        const saved = ls.loadLastRun();
        if (saved) { ls.savePrevLastRun(saved); setPrevRun(saved); }
      }catch(e){}
      setLastRun(res);
      // persist to localStorage
      try{
        if (res.updatedPortfolio) ls.savePortfolio(res.updatedPortfolio);
        if (res.executedTrades) ls.saveExecutedTrades(res.executedTrades);
        ls.saveLastRun(res);
      }catch(e){}
      // set BUY decisions to pending approval
      try{
        const statuses = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {};
        for(const d of res.decisions){ if (d.action === 'BUY') statuses[d.id] = 'PENDING_APPROVAL'; }
        ls.saveDecisionStatuses && ls.saveDecisionStatuses(statuses);
        setDecisionStatuses(statuses);
        // update victor memory: recommendation count and last analysis date
        try{
          const vm = (ls.loadVictorMemory ? ls.loadVictorMemory() : null) || {};
          vm.firstLoginDate = vm.firstLoginDate || new Date().toISOString();
          vm.numRecommendations = (vm.numRecommendations || 0) + (res.decisions?.length || 0);
          vm.lastAnalysisDate = res.runAt || new Date().toISOString();
          ls.saveVictorMemory && ls.saveVictorMemory(vm);
        }catch(e){}
      }catch(e){}
      // Notify other client components (holdings table) about updated portfolio
      try{
        if (typeof window !== 'undefined' && res && res.updatedPortfolio) {
          window.dispatchEvent(new CustomEvent('atlas:portfolio-updated', { detail: res.updatedPortfolio }));
        }
      }catch(e){
        // ignore
      }
    }finally{
      setRunning(false);
    }
  }

  useEffect(()=>{
    try{
      const saved = ls.loadLastRun();
      const prev = ls.loadPrevLastRun();
      if (saved) setTimeout(()=> setLastRun(saved), 0);
      if (prev) setTimeout(()=> setPrevRun(prev), 0);
      // load existing decision statuses
      try{ const s = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {}; setTimeout(()=> setDecisionStatuses(s), 0); }catch(e){}
      const p = ls.loadPortfolio() || getMockPortfolio();
      if (p) window.dispatchEvent(new CustomEvent('atlas:portfolio-updated', { detail: p }));
      // ensure victor memory has firstLoginDate
      try{
        const vm = ls.loadVictorMemory ? ls.loadVictorMemory() : null;
        if (!vm){ const nv = { userName: null, firstLoginDate: new Date().toISOString(), numRecommendations: 0, numApprovedBuys: 0, numDeclinedBuys: 0, favoriteCompany: null, favoriteSector: null, lastAnalysisDate: null }; ls.saveVictorMemory && ls.saveVictorMemory(nv); }
      }catch(e){}
    }catch(e){
      // ignore
    }
  }, []);

  function handleReset(){
    try{ ls.clearAll(); }catch(e){}
    const p = getMockPortfolio();
    window.dispatchEvent(new CustomEvent('atlas:portfolio-updated', { detail: p }));
    setLastRun(null);
    setPrevRun(null);
  }

  function summarySinceLast(current: any, previous: any){
    if (!previous) return null;
    if (!current) return null;
    try{
      const currDec = (current.decisions||[]).slice().sort((a:any,b:any)=> b.confidence - a.confidence)[0];
      const prevDec = (previous.decisions||[]).slice().sort((a:any,b:any)=> b.confidence - a.confidence)[0];
      const parts: string[] = [];

      if (currDec && prevDec && currDec.symbol !== prevDec.symbol){
        parts.push(`Nytt viktigaste beslut: ${currDec.action} ${currDec.symbol}.`);
      }

      if (currDec && prevDec && currDec.symbol === prevDec.symbol){
        if (Math.abs(currDec.confidence - prevDec.confidence) >= 1){
          parts.push(`Confidence ändrad: ${prevDec.confidence}% → ${currDec.confidence}%.`);
        }
        if (currDec.riskLevel !== prevDec.riskLevel){
          parts.push(`Risknivå ändrad: ${prevDec.riskLevel} → ${currDec.riskLevel}.`);
        }
      }

      // holdings changes
      const currHold = (current.updatedPortfolio?.holdings || []).map((h:any)=> h.symbol);
      const prevHold = (previous.updatedPortfolio?.holdings || []).map((h:any)=> h.symbol);
      const added = currHold.filter((s:any)=> !prevHold.includes(s));
      const removed = prevHold.filter((s:any)=> !currHold.includes(s));
      if (added.length) parts.push(`Nytt innehav: ${added.slice(0,3).join(', ')}.`);
      if (removed.length) parts.push(`Borttaget innehav: ${removed.slice(0,3).join(', ')}.`);

      if (!parts.length) return 'Ingen relevant förändring sedan förra analysen.';
      return parts.slice(0,4).join(' ');
    }catch(e){ return null; }
  }

  // Approve a buy: simulate execution and persist
  function handleApprove(decision: any){
    try{
      const statuses = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {};
      statuses[decision.id] = 'APPROVING';
      ls.saveDecisionStatuses && ls.saveDecisionStatuses(statuses);
      setDecisionStatuses({...statuses});
    }catch(e){}

    try{
      const portfolio = ls.loadPortfolio() || getMockPortfolio();
      let portfolioAfter = JSON.parse(JSON.stringify(portfolio));
      const engine = new PaperTradingEngine(portfolioAfter);
      const price = decision.suggestedQuantity > 0 ? Math.max(1, Math.round((portfolioAfter.totalValue * decision.suggestedPositionPercent) / Math.max(1,decision.suggestedQuantity))) : 100;
      const order: Order = { id: decision.id, symbol: decision.symbol, side: 'Köp', quantity: Math.max(1, decision.suggestedQuantity), price };
      const result = engine.simulateExecution(order);
      if (result.success){
        // update persisted portfolio and trades
        ls.savePortfolio(result.portfolio);
        const existing = ls.loadExecutedTrades() || [];
        existing.push(result.transaction);
        ls.saveExecutedTrades(existing);
        // update lastRun in memory and storage
        const newLast = {...lastRun};
        newLast.executedTrades = (newLast.executedTrades || []).concat(result.transaction);
        newLast.updatedPortfolio = result.portfolio;
        setLastRun(newLast);
        ls.saveLastRun(newLast);
        // mark executed
        const statuses = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {};
        statuses[decision.id] = 'EXECUTED';
        ls.saveDecisionStatuses && ls.saveDecisionStatuses(statuses);
        setDecisionStatuses({...statuses});
        // notify holdings
        window.dispatchEvent(new CustomEvent('atlas:portfolio-updated', { detail: result.portfolio }));
        // update victor memory: approved buys and favorite company/sector
        try{
          const vm = (ls.loadVictorMemory ? ls.loadVictorMemory() : null) || {};
          vm.numApprovedBuys = (vm.numApprovedBuys || 0) + 1;
          vm.favoriteCompany = decision.symbol || vm.favoriteCompany;
          // try to infer sector from mock analysis risk data
          try{
            const r = mockAnalysis.mockRisk.find((x:any)=> x.symbol === decision.symbol);
            if (r && r.sectorExposure) vm.favoriteSector = r.sectorExposure;
          }catch(e){}
          ls.saveVictorMemory && ls.saveVictorMemory(vm);
        }catch(e){}
      } else {
        const statuses = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {};
        statuses[decision.id] = 'DECLINED';
        ls.saveDecisionStatuses && ls.saveDecisionStatuses(statuses);
        setDecisionStatuses({...statuses});
      }
    }catch(e){
      const statuses = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {};
      statuses[decision.id] = 'DECLINED';
      ls.saveDecisionStatuses && ls.saveDecisionStatuses(statuses);
      setDecisionStatuses({...statuses});
    }
  }

  function handleDecline(decision: any){
    try{
      const statuses = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {};
      statuses[decision.id] = 'DECLINED';
      ls.saveDecisionStatuses && ls.saveDecisionStatuses(statuses);
      setDecisionStatuses({...statuses});
      // update victor memory: declined buys
      try{
        const vm = (ls.loadVictorMemory ? ls.loadVictorMemory() : null) || {};
        vm.numDeclinedBuys = (vm.numDeclinedBuys || 0) + 1;
        ls.saveVictorMemory && ls.saveVictorMemory(vm);
      }catch(e){}
    }catch(e){}
  }

  // Pending BUY decisions awaiting user approval
  const pendingDecisions = lastRun ? (lastRun.decisions || []).filter((d: any) => d.action === 'BUY' && (decisionStatuses && decisionStatuses[d.id] === 'PENDING_APPROVAL')) : [];

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Atlas dagliga analys</h2>
          <div className="text-xs text-gray-400">Lokal simulering · Demodata</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn bg-blue-600 text-white px-4 py-2 rounded" onClick={handleRun} disabled={running}>{running ? 'Kör...' : 'Kör dagens analys'}</button>
          <button className="btn bg-blue-600 text-white px-3 py-2 rounded text-sm" onClick={handleReset}>Återställ demodata</button>
        </div>
      </div>

      <div className="mt-4">
        {/* Pending approvals section */}
        {pendingDecisions && pendingDecisions.length > 0 && (
          <div className="mb-4 p-4 bg-white border rounded">
            <h3 className="text-sm font-semibold">Väntar på ditt beslut</h3>
            <div className="mt-2 space-y-3">
              {pendingDecisions.map((d: any) => {
                const recommendedAmount = Math.max(1, Math.round(((lastRun?.updatedPortfolio?.totalValue || 100000) * (d.suggestedPositionPercent || 0)) / 100));
                return (
                  <div key={d.id} className="p-3 border rounded bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{d.symbol}</div>
                        <div className="text-xs text-gray-500">{d.reason || d.summary || ''}</div>
                      </div>
                      <div className="text-right text-xs text-gray-600">
                        <div>Confidence: {d.confidence}%</div>
                        <div>Risk: {d.riskLevel}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <div>
                        <div>Rekommenderat belopp: {recommendedAmount} kr</div>
                        <div>Kvantitet: {d.suggestedQuantity}</div>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn bg-green-600 text-white px-3 py-1 rounded text-sm" onClick={() => handleApprove(d)}>Godkänn köp</button>
                        <button className="btn bg-gray-200 px-3 py-1 rounded text-sm" onClick={() => handleDecline(d)}>Avstå</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {lastRun ? (
          <div>
            <div className="text-sm text-gray-500">Senaste körning: {new Date(lastRun.runAt).toLocaleString()}</div>
            <div className="mt-2 text-sm">Analyserade: {lastRun.decisions.length}</div>
            <div className="mt-4">
              <CoachBriefing lastRun={lastRun} />
            </div>
            <div className="mt-2 text-sm text-gray-500">
              <strong>Sedan förra analysen:</strong>
              <div className="mt-1">{summarySinceLast(lastRun, prevRun)}</div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3">
              {lastRun.decisions.map((d: any)=> {
                const exec = lastRun.executedTrades?.find((t: any) => t.orderId === d.id);
                const status = decisionStatuses && decisionStatuses[d.id];
                return (
                  <DecisionCard key={d.id} decision={d} executed={exec ? { quantity: exec.quantity, executedPrice: exec.executedPrice } : undefined} status={status}
                    onApprove={() => handleApprove(d)} onDecline={() => handleDecline(d)} onShow={() => { /* noop for now */ }} />
                );
              })}
            </div>
            <div className="mt-4 text-sm font-medium">Rapport: {lastRun.summarySwe}</div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">Ingen körning utförd ännu.</div>
        )}
      </div>
    </section>
  );
}
