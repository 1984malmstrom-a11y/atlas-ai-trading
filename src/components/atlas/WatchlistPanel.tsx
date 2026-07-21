"use client";
import React, { useState, useEffect } from 'react';
import mockAnalysis from '../../data/mock-analysis-data';
import { getMockPortfolio } from '../../data/mock-portfolio';
import dailyDecisionEngine from '../../domain/analysis/daily-decision-engine';
import ls from '../../lib/local-storage';

export default function WatchlistPanel(){
  const [items, setItems] = useState<any[]>([]);

  useEffect(()=>{
    // derive a simple watchlist from mock technicals
    const list = (mockAnalysis.mockTechnical || []).map(t => {
      const fund: any = (mockAnalysis.mockFundamental||[]).find(f=>f.symbol===t.symbol) || {};
      const price = Math.max(10, Math.round((t.momentumScore || 50) * 2 + (fund.valuationScore || 50)) );
      const change = (Math.round((t.momentumScore - 50) * 10) / 10);
      const score = Math.min(100, Math.max(0, Math.round(((t.momentumScore||50) + (fund.qualityScore||50)) / 2)));
      const trend = t.trend === 'BULLISH' ? '↑' : t.trend === 'BEARISH' ? '↓' : '→';
      return { symbol: t.symbol, name: t.symbol, price, change, score, trend, reason: t.summary || (fund && fund.summary) || '' };
    });
    setTimeout(()=> setItems(list), 0);
  }, []);

  function handleMoveToAnalysis(sym: string){
    try{
      const technical = (mockAnalysis.mockTechnical||[]).find(t=>t.symbol===sym);
      const fundamental = (mockAnalysis.mockFundamental||[]).find(f=>f.symbol===sym);
      const news = (mockAnalysis.mockNews||[]).find(n=>n.symbol===sym);
      const risk = (mockAnalysis.mockRisk||[]).find(r=>r.symbol===sym);
      const portfolio = ls.loadPortfolio() || getMockPortfolio();
      if (!technical || !fundamental || !news || !risk) return;
      const decision = dailyDecisionEngine({ portfolio, technical, fundamental, news, risk });

      // persist into lastRun in localStorage
      const lastRun = ls.loadLastRun() || { runAt: new Date().toISOString(), decisions: [], executedTrades: [] };
      lastRun.decisions = lastRun.decisions || [];
      lastRun.decisions.push(decision);
      ls.saveLastRun && ls.saveLastRun(lastRun);

      // if BUY, mark pending
      try{
        const statuses = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {};
        if (decision.action === 'BUY') statuses[decision.id] = 'PENDING_APPROVAL';
        ls.saveDecisionStatuses && ls.saveDecisionStatuses(statuses);
      }catch(e){}

      // simple user feedback via replacing items state
      setItems(prev => prev.map(it => it.symbol === sym ? { ...it, moved: true } : it));
    }catch(e){
      // ignore
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-semibold">Bevakningslista</h3>
      <div className="mt-3 space-y-2">
        {items.map(it => (
          <div key={it.symbol} className="p-3 border rounded flex items-center justify-between">
            <div>
              <div className="font-medium">{it.name} <span className="text-sm text-gray-500">({it.symbol})</span></div>
              <div className="text-sm text-gray-600">{it.reason}</div>
            </div>
            <div className="text-right">
              <div className="text-sm">{it.price} kr <span className="text-xs {it.change>=0? 'text-green-600':'text-red-600'}">{it.change}%</span></div>
              <div className="text-sm">Score: {it.score} · Trend: {it.trend}</div>
              <div className="mt-2">
                <button className="btn bg-blue-600 text-white px-3 py-1 rounded text-sm" onClick={() => handleMoveToAnalysis(it.symbol)} disabled={it.moved}>{it.moved ? 'Flyttad' : 'Flytta till analys'}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
