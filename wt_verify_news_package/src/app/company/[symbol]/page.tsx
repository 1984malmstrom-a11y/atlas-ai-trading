"use client";
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { mockMarket } from '../../../domain/market/mock-market-data';
import mockAnalysis from '../../../data/mock-analysis-data';
import { getMockPortfolio } from '../../../data/mock-portfolio';
import dailyDecisionEngine from '../../../domain/analysis/daily-decision-engine';
import ls from '../../../lib/local-storage';

export default function CompanyPage(){
  const params = useParams();
  const symbol = (params as any)?.symbol?.toString() || '';
  const [company, setCompany] = useState<any>(null);
  const [isWatched, setIsWatched] = useState(false);

  useEffect(()=>{
    try{
      const market = (mockMarket || []).find((m:any)=> m.symbol === symbol) || null;
      const tech = (mockAnalysis.mockTechnical||[]).find(t=>t.symbol===symbol) || null;
      const fund = (mockAnalysis.mockFundamental||[]).find(f=>f.symbol===symbol) || null;
      const holdings = getMockPortfolio().holdings || [];
      const holding = holdings.find((h:any)=> h.symbol === symbol) || null;
      const lastRun = ls.loadLastRun();
      const lastDecision = lastRun?.decisions?.slice().reverse().find((d:any)=> d.symbol === symbol) || null;
      const lastNews = (mockAnalysis.mockNews||[]).find(n=>n.symbol===symbol) || null;
      const mockPrice = market ? market.price : holding ? holding.currentPrice : Math.max(10, (tech?.momentumScore||50)*2);
      const change = market ? market.changePercent : tech ? Math.round((tech.momentumScore-50)*10)/10 : 0;
      const score = lastDecision ? lastDecision.confidence : Math.min(100, Math.round(((tech?.momentumScore||50)+(fund?.qualityScore||50))/2));
      const risk = (mockAnalysis.mockRisk||[]).find(r=>r.symbol===symbol)?.riskLevel || holding?.riskLevel || 'Okänd';
      const trend = tech ? (tech.trend === 'BULLISH' ? '↑' : tech.trend === 'BEARISH' ? '↓' : '→') : '→';
      const lastExecuted = (ls.loadExecutedTrades()||[]).slice().reverse().find((t:any)=> t.orderId && t.orderId.includes(symbol));

      setTimeout(()=>{
        setCompany({ symbol, name: market?.name || holding?.name || symbol, price: mockPrice, change, score, risk, trend, lastDecision, lastNews, holding, lastExecuted });
        const watch = JSON.parse(localStorage.getItem('atlas:watchlist') || '[]');
        setIsWatched(Array.isArray(watch) && watch.includes(symbol));
      }, 0);
    }catch(e){ }
  }, [symbol]);

  function handleAnalyzeAgain(){
    try{
      const technical = (mockAnalysis.mockTechnical||[]).find(t=>t.symbol===symbol);
      const fundamental = (mockAnalysis.mockFundamental||[]).find(f=>f.symbol===symbol);
      const news = (mockAnalysis.mockNews||[]).find(n=>n.symbol===symbol);
      const risk = (mockAnalysis.mockRisk||[]).find(r=>r.symbol===symbol);
      const portfolio = ls.loadPortfolio() || getMockPortfolio();
      if (!technical || !fundamental || !news || !risk) return;
      const decision = dailyDecisionEngine({ portfolio, technical, fundamental, news, risk });
      const lastRun = ls.loadLastRun() || { runAt: new Date().toISOString(), decisions: [], executedTrades: [] };
      lastRun.decisions = lastRun.decisions || [];
      lastRun.decisions.push(decision);
      ls.saveLastRun && ls.saveLastRun(lastRun);
      if (decision.action === 'BUY'){
        const statuses = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {};
        statuses[decision.id] = 'PENDING_APPROVAL';
        ls.saveDecisionStatuses && ls.saveDecisionStatuses(statuses);
      }
      // refresh local state
      setCompany((c:any)=> ({ ...c, lastDecision: decision }));
    }catch(e){}
  }

  function handleAddWatch(){
    try{
      const w = JSON.parse(localStorage.getItem('atlas:watchlist') || '[]');
      if (!Array.isArray(w)) return;
      if (!w.includes(symbol)) w.push(symbol);
      localStorage.setItem('atlas:watchlist', JSON.stringify(w));
      setIsWatched(true);
    }catch(e){}
  }

  function handleRemoveWatch(){
    try{
      const w = JSON.parse(localStorage.getItem('atlas:watchlist') || '[]');
      if (!Array.isArray(w)) return;
      const nw = w.filter((s:any)=> s !== symbol);
      localStorage.setItem('atlas:watchlist', JSON.stringify(nw));
      setIsWatched(false);
    }catch(e){}
  }

  if (!company) return <div className="p-6">Laddar...</div>;

  const h = company.holding;

  return (
    <div className="p-6 panel">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          <div className="text-sm text-gray-500">{company.symbol}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-medium">{Math.round(company.price*100)/100} kr</div>
          <div className="text-sm text-gray-600">{company.change}%</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="panel p-3">
          <div className="text-sm text-gray-500">Atlas Score</div>
          <div className="text-lg font-medium">{company.score}</div>
        </div>
        <div className="panel p-3">
          <div className="text-sm text-gray-500">Risknivå</div>
          <div className="text-lg font-medium">{company.risk}</div>
        </div>
        <div className="panel p-3">
          <div className="text-sm text-gray-500">Trend</div>
          <div className="text-lg font-medium">{company.trend}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="panel p-3">
          <div className="text-sm text-gray-500">Senaste analys</div>
          <div className="mt-1 text-sm">{company.lastDecision ? company.lastDecision.simpleSummary : 'Ingen analys ännu'}</div>
        </div>
        <div className="panel p-3">
          <div className="text-sm text-gray-500">Senaste nyhet (mock)</div>
          <div className="mt-1 text-sm">{company.lastNews ? company.lastNews.summary : 'Ingen nyhet'}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="panel p-3">
          <div className="text-sm text-gray-500">Senaste beslut</div>
          <div className="mt-1 text-sm">{company.lastDecision ? `${company.lastDecision.action} · Confidence ${company.lastDecision.confidence}%` : '—'}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="panel p-3">
          <div className="text-sm text-gray-500">Atlas äger aktien</div>
          <div className="mt-1 text-sm">{h ? 'Ja' : 'Nej'}</div>
          {h && <>
            <div className="text-sm mt-2">Innehavets värde: {Math.round(h.marketValue)} kr</div>
            <div className="text-sm">Orealiserad P/L: {Math.round(h.unrealizedPnl)} kr ({Math.round((h.unrealizedPnlPercent||0)*100)/100}%)</div>
          </>}
        </div>
        <div className="panel p-3">
          <div className="text-sm text-gray-500">Senaste genomförda affär</div>
          <div className="mt-1 text-sm">{company.lastExecuted ? `${company.lastExecuted.quantity} @ ${Math.round(company.lastExecuted.executedPrice*100)/100} kr` : 'Ingen'}</div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button className="btn bg-blue-600 text-white px-4 py-2 rounded" onClick={handleAnalyzeAgain}>Analysera igen</button>
        {!isWatched ? (
          <button className="btn bg-gray-200 px-4 py-2 rounded" onClick={handleAddWatch}>Lägg till i bevakning</button>
        ) : (
          <button className="btn bg-red-200 px-4 py-2 rounded" onClick={handleRemoveWatch}>Ta bort från bevakning</button>
        )}
      </div>
    </div>
  );
}
