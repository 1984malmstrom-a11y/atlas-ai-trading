import React from 'react';
import { getPortfolio } from '../../domain/portfolio/portfolio-service';

export default function RiskOverview(){
  const p = getPortfolio();
  return (
    <section className="panel p-4">
      <h3 className="font-semibold">Risköversikt</h3>
      <div className="text-sm text-gray-400 mt-2">Portföljrisk: <span className="text-white font-semibold">{p.estimatedRisk || 'Låg'}</span></div>
      <div className="text-xs text-gray-500 mt-2">Notera: Riskmotorn är en demonstrationsmodell.</div>
    </section>
  );
}
