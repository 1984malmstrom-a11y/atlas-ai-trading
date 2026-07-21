import React from 'react';
import { getPortfolio } from '../../domain/portfolio/portfolio-service';
import { formatCurrency, formatPercent } from '../../lib/formatters';

export default function PortfolioSummary(){
  const portfolio = getPortfolio();
  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-400">Totalt portföljvärde</div>
          <div className="text-2xl font-bold">{formatCurrency(portfolio.totalValue, portfolio.baseCurrency)}</div>
        </div>

        <div className="text-right">
          <div className="text-sm text-gray-400">Tillgängligt</div>
          <div className="font-semibold">{formatCurrency(portfolio.availableCash, portfolio.baseCurrency)}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-gray-400">Total avkastning</div>
          <div className="font-semibold">{formatPercent(portfolio.totalReturnPercent)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Benchmark</div>
          <div className="font-semibold">{formatPercent(portfolio.benchmarkReturnPercent)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Största risk</div>
          <div className="font-semibold">{portfolio.largestRisk || '—'}</div>
        </div>
      </div>
    </section>
  );
}
