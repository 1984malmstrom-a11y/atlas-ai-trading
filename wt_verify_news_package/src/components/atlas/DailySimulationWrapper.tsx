import React from 'react';
import DailySimulationPanel from './DailySimulationPanel';

export default function DailySimulationWrapper(){
  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Atlas dagliga analys</h2>
          <div className="text-xs text-gray-400">Lokal simulering · Demodata</div>
        </div>
      </div>
      <div className="mt-4">
        <div className="text-sm text-gray-500">Ingen körning utförd ännu.</div>
        {/* Client component handles interaction and rendering of results */}
        <div className="mt-4"><DailySimulationPanel /></div>
      </div>
    </section>
  );
}
