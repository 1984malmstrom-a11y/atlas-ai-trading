import React from 'react';
import { getMockTrades } from '../../data/mock-trades';
import { formatCurrency } from '../../lib/formatters';

export default function RecentTrades(){
  const trades = getMockTrades();
  return (
    <section className="panel p-4">
      <h2 className="text-lg font-semibold mb-3">Senaste affärer</h2>
      <ul className="text-sm">
        {trades.map((t) => (
          <li key={t.id} className="py-2 border-t border-gray-800">
            <div className="flex justify-between">
              <div>{new Date(t.executedAt).toLocaleString('sv-SE')} • {t.side} {t.symbol}</div>
              <div>{formatCurrency(t.filledPrice || t.requestedPrice, t.currency)}</div>
            </div>
            <div className="text-gray-400 text-xs">{t.quantity} • {t.status} • {t.simpleReason}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
