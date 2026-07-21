"use client";
import React, { useEffect, useState } from 'react';
import ls from '../../lib/local-storage';
import { getMockPortfolio } from '../../data/mock-portfolio';

function mapRiskLevel(level: string){
  const l = (level||'').toLowerCase();
  if (l.includes('hög') || l.includes('high')) return 'Hög';
  if (l.includes('med') || l.includes('medium')) return 'Medel';
  return 'Låg';
}

export default function PortfolioAnalysis(){
  const [summary, setSummary] = useState<string>('');
  const [metrics, setMetrics] = useState<any>(null);
  const [lastAnalyzed, setLastAnalyzed] = useState<Date | null>(null);

  function compute(){
    try{
      const p = ls.loadPortfolio ? ls.loadPortfolio() : getMockPortfolio();
      const portfolio = p || getMockPortfolio();
      const holdings = portfolio.holdings || [];

      const totalValue = portfolio.totalValue || 0;
      const invested = holdings.reduce((s:any,h:any)=> s + ((h.averagePrice||0) * (h.quantity||0)), 0);
      const unrealized = holdings.reduce((s:any,h:any)=> s + (h.unrealizedPnl || 0), 0);
      const count = holdings.length;
      const largest = holdings.slice().sort((a:any,b:any)=> b.marketValue - a.marketValue)[0] || null;
      const largestPercent = largest ? Math.round((largest.marketValue / Math.max(1,totalValue)) * 100) : 0;

      const diversificationScore = Math.max(0, Math.min(100, Math.round((1 - (largest ? (largest.marketValue / Math.max(1,totalValue)) : 0)) * 100)));

      const riskMap: Record<string,number> = { 'låg': 1, 'medel': 2, 'hög': 3 };
      const avgRisk = holdings.length ? (holdings.reduce((s:any,h:any)=> s + (riskMap[(h.riskLevel||'medel').toLowerCase()]||2), 0) / holdings.length) : 2;
      const riskScore = avgRisk <= 1.4 ? 'Låg' : avgRisk <= 2.4 ? 'Medel' : 'Hög';

      const metricsObj = { totalValue, invested, unrealized, count, largest: largest ? { symbol: largest.symbol, name: largest.name, marketValue: largest.marketValue, percent: largestPercent } : null, diversificationScore, riskScore };
      setMetrics(metricsObj);

      const parts: string[] = [];
      parts.push(`Portföljvärde ${Math.round(totalValue)} kr med ${count} innehav.`);
      if (metricsObj.largest) {
        parts.push(`${metricsObj.largest.name} utgör ${metricsObj.largest.percent}% av portföljen vilket påverkar koncentrationsrisken.`);
      }
      if (diversificationScore >= 70) {
        parts.push('Portföljen är väl diversifierad över flera innehav.');
      } else if (diversificationScore >= 40) {
        parts.push('Portföljen har måttlig diversifiering; överväg att sprida nya köp.');
      } else {
        parts.push('Portföljen är koncentrerad och löper högre risk; överväg omallokering.');
      }
      if (riskScore === 'Hög') parts.push('Den genomsnittliga risknivån är hög och kan ge större volatilitet.');
      else if (riskScore === 'Medel') parts.push('Risknivån är medel — övervaka större innehav.');
      else parts.push('Risknivån är låg enligt holdingsens metadata.');

      parts.push('Jag rekommenderar att framtida köp riktas mot sektorer som minskar koncentrationen.');

      const text = parts.slice(0,5).join(' ');
      setSummary(text);
      setLastAnalyzed(new Date());
    }catch(e){
      // ignore
    }
  }

  useEffect(()=>{
    setTimeout(()=> compute(), 0);
    const onUpdate = (e: any) => { compute(); };
    if (typeof window !== 'undefined') window.addEventListener('atlas:portfolio-updated', onUpdate);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('atlas:portfolio-updated', onUpdate); };
  }, []);

  if (!metrics) return <div className="panel p-4">Laddar portföljanalys...</div>;

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Portföljanalys</h3>
        <div className="text-xs text-gray-500">Senast analyserad: {lastAnalyzed ? lastAnalyzed.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '—'}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <div className="text-sm text-gray-500">Totalt portföljvärde</div>
          <div className="text-xl font-medium">{Math.round(metrics.totalValue)} kr</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Investerat kapital</div>
          <div className="text-xl font-medium">{Math.round(metrics.invested)} kr</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Orealiserad vinst/förlust</div>
          <div className="text-xl font-medium">{Math.round(metrics.unrealized)} kr</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Antal innehav</div>
          <div className="text-xl font-medium">{metrics.count}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Största innehav</div>
          <div className="text-lg font-medium">{metrics.largest ? `${metrics.largest.name} (${metrics.largest.symbol}) ${metrics.largest.percent}%` : '—'}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Diversifieringsscore</div>
          <div className="text-xl font-medium">{metrics.diversificationScore}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Riskscore</div>
          <div className="text-xl font-medium">{metrics.riskScore}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-sm text-gray-500">Sammanfattning</div>
        <div className="mt-2 text-sm">{summary}</div>
      </div>

      <div className="mt-4">
        <button className="btn bg-blue-600 text-white px-3 py-2 rounded" onClick={compute}>Analysera portföljen igen</button>
      </div>
    </section>
  );
}
