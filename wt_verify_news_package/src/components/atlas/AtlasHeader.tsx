import React from 'react';

export default function AtlasHeader(){
  return (
    <header className="flex items-start justify-between">
      <div>
        <h1 className="text-3xl font-bold">ATLAS</h1>
        <p className="text-sm text-gray-400 mt-1">AI-coach för analys och simulerad handel</p>
        <div className="mt-2 text-xs text-gray-400">Status: <span className="text-green-400">Paper trading aktiv</span> • <span className="text-gray-500">Inga riktiga pengar</span></div>
      </div>
      <div className="text-sm text-gray-400">Demodata</div>
    </header>
  );
}
