"use client";
import React, { useEffect, useState } from 'react';
import ls from '../../lib/local-storage';
import { Portfolio } from '../../domain/portfolio/types';
import { formatCurrency, formatPercent } from '../../lib/formatters';

export default function HoldingsTable({ initialPortfolio }: { initialPortfolio: Portfolio }){
  const [portfolio, setPortfolio] = useState(() => {
    try{
      const p = ls.loadPortfolio();
      return p || initialPortfolio;
    }catch(e){ return initialPortfolio; }
  });

  useEffect(() => {
    function handler(e: any){
      if (e?.detail) setPortfolio(e.detail);
    }
    window.addEventListener('atlas:portfolio-updated', handler as EventListener);
    return () => window.removeEventListener('atlas:portfolio-updated', handler as EventListener);
  }, []);

  return (
    <section className="panel p-4">
      <h2 className="text-lg font-semibold mb-3">Innehav</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400">
            <th>Namn</th><th>Ticker</th><th>Typ</th><th>Antal</th><th>Snittpris</th><th>Aktuell</th><th>Marknadsvärde</th><th>Resultat</th><th>Andel</th><th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {portfolio.holdings.map((h: any) => (
            <tr key={h.id} className="border-t border-gray-800">
              <td className="py-2">{h.name}</td>
              <td>{h.symbol}</td>
              <td>{h.assetType}</td>
              <td>{h.quantity}</td>
              <td>{formatCurrency(h.averagePrice, portfolio.baseCurrency)}</td>
              <td>{formatCurrency(h.currentPrice, portfolio.baseCurrency)}</td>
              <td>{formatCurrency(h.marketValue, portfolio.baseCurrency)}</td>
              <td className="text-right">{formatCurrency(h.unrealizedPnl, portfolio.baseCurrency)} ({formatPercent(h.unrealizedPnlPercent)})</td>
              <td>{formatPercent(h.portfolioWeight)}</td>
              <td>{h.riskLevel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
