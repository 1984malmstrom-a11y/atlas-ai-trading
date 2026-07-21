import React from 'react';

export default function VictorPortfolioIntelligencePanel({ report }: { report: any }){
  if (!report) return null;
  if (!report.holdingsCount || report.holdingsCount === 0) return (
    <section className="panel p-4 mt-4">
      <h4 className="font-semibold">Victor Portfolio Intelligence</h4>
      <div className="text-sm mt-2">Din portfölj är tom. Lägg till ett innehav för att Victor ska kunna analysera den.</div>
    </section>
  );

  return (
    <section className="panel p-4 mt-4">
      <h4 className="font-semibold">Victor Portfolio Intelligence</h4>
      <div className="mt-2 text-sm grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>Totalvärde: {report.totalValue ?? 'N/A'}</div>
        <div>Antal innehav: {report.holdingsCount}</div>
        <div>Största innehav: {report.largestHolding?.symbol ?? 'N/A'} ({report.largestHoldingWeight ?? 0}%)</div>
        <div>Diversifieringspoäng: {report.diversificationScore ?? 'N/A'}</div>
        <div>Koncentrationspoäng: {report.concentrationScore ?? 'N/A'}</div>
        <div>Portföljrisk: {report.portfolioRiskScore ?? 'N/A'}</div>
        <div>Profilmatchning: {report.profileAlignmentScore ?? 'N/A'}</div>
      </div>

      <div className="mt-3 text-sm">
        <div className="font-medium">Sektorsfördelning</div>
        <ul className="list-disc ml-5 mt-1">
          {(report.sectorExposure ?? []).slice(0,6).map((s:any,i:number)=>(<li key={i}>{s.name}: {s.percentage}%</li>))}
        </ul>
      </div>

      <div className="mt-3 text-sm">
        <div className="font-medium">Viktigaste riskerna</div>
        <ul className="list-disc ml-5 mt-1">
          {(report.risks ?? []).slice(0,5).map((r:string,i:number)=>(<li key={i}>{r}</li>))}
        </ul>
      </div>

      <div className="mt-3 text-sm">
        <div className="font-medium">Rekommendationer</div>
        <ul className="list-disc ml-5 mt-1">
          {(report.recommendations ?? []).slice(0,5).map((r:string,i:number)=>(<li key={i}>{r}</li>))}
        </ul>
      </div>
    </section>
  );
}
