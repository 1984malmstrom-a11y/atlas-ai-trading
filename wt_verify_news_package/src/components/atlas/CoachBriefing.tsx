"use client";
import React from 'react';
import ls from '../../lib/local-storage';
import { readMemoryContext } from '../../domain/memory/victor-memory-engine';
import VictorsInvestmentReportPanel from './VictorsInvestmentReportPanel';

async function generateBriefing(lastRun: any): Promise<{ text: string; decision: any; intelligence?: any; recommendation?: any; reasoning?: any; investmentReport?: any }> {
  const profile = ls.loadInvestorProfile ? ls.loadInvestorProfile() : null;
  const portfolio = ls.loadPortfolio ? ls.loadPortfolio() : null;
  const decisions = lastRun?.decisions || [];
  const main = decisions.slice().sort((a:any,b:any)=> b.confidence - a.confidence)[0];
  const symbol = main?.symbol || '';

  // prepare memory context from local storage
  const localMemory = ls.loadVictorMemory ? ls.loadVictorMemory() : null;
  const memoryContext = localMemory ? readMemoryContext(localMemory, String(symbol || '')) : null;
  const payload = { symbol: String(symbol || '').trim(), memoryContext };
  const resp = await fetch('/api/victor/analyze', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } });
  if (!resp.ok) throw new Error('Analysis failed');
  const json = await resp.json();
  const investmentReport = json.investmentReport;
  const decision = investmentReport?.recommendation || null;
  const text = investmentReport?.summary || 'Analys klar.';
  // persist memory update if provided
  try{
    if (json.memoryUpdate && ls.saveVictorMemory) ls.saveVictorMemory(json.memoryUpdate);
  }catch(e){}
  return { text, decision, investmentReport };
}

export default function CoachBriefing({ lastRun }: { lastRun?: any }){
  const [loading, setLoading] = React.useState(true);
  const [out, setOut] = React.useState<any>(null);

  React.useEffect(()=>{
    let mounted = true;
    (async ()=>{
      setLoading(true);
      try{ const res = await generateBriefing(lastRun); if (mounted) setOut(res); }catch(e){ if (mounted) setOut({ text: 'Fel vid generering av briefing.' }); }
      if (mounted) setLoading(false);
    })();
    return ()=>{ mounted = false; };
  }, [lastRun]);

  if (loading) return (<section className="panel p-4"><h3 className="font-semibold">Victor Recommendation</h3><div className="text-sm text-gray-500">Victor hämtar information...</div></section>);

  const text: string = out?.text || '';
  const investmentReport = out?.investmentReport || null;
  return (
    <section className="panel p-4">
      <h3 className="font-semibold">Victor Recommendation</h3>
      <pre className="text-sm text-gray-400 mt-2 whitespace-pre-wrap">{text}</pre>
      <VictorsInvestmentReportPanel report={investmentReport} />
    </section>
  );
}
