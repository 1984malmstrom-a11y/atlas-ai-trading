"use client";
import React, { useState } from 'react';

export default function VictorTradingControl(){
  const [mode, setMode] = useState<'ADVISORY'|'PAPER_MANUAL'|'PAPER_AUTO'>('ADVISORY');
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runNow(){
    setRunning(true); setMessage(null);
    try{
      const res = await fetch('/api/victor/trading/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Error');
      setMessage('Körning klar — se loggar för detaljer.');
    }catch(e:any){ setMessage('Körningen misslyckades: ' + (e?.message || String(e))); }
    finally{ setRunning(false); }
  }

  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:10 }}>
      <select value={mode} onChange={(e)=> setMode(e.target.value as any)} style={{ padding:8, borderRadius:8, border:'1px solid rgba(16,42,67,0.08)' }}>
        <option value="ADVISORY">Rådgivare</option>
        <option value="PAPER_MANUAL">Paper — godkänn först</option>
        <option value="PAPER_AUTO">Paper — automatisk</option>
      </select>
      <button
        onClick={runNow}
        disabled={running}
        className={`px-4 py-2 rounded-md font-semibold transition-colors duration-150 ease-in-out ${running ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
        style={{ background: '#D4AF37', color: '#ffffff', border: 'none' }}
      >
        {running ? 'Kör...' : 'Kör Victor nu'}
      </button>
      {mode === 'PAPER_AUTO' && <div style={{ fontSize:13, color:'#102A43' }}>Victor får köpa och sälja automatiskt med låtsaspengar inom ditt mandat.</div>}
      {message && <div style={{ marginLeft:8, fontSize:13 }}>{message}</div>}
    </div>
  );
}
