import React from 'react';

export default function WhyFitsPanel({ recommendation }: { recommendation: any }){
  if (!recommendation) return null;
  return (
    <section className="panel p-4 mt-4">
      <h4 className="font-semibold">Varför passar detta DIG?</h4>
      <ul className="mt-2 text-sm list-disc ml-5">
        <li>✓ Matchar din riskprofil: {recommendation.riskFit}%</li>
        <li>✓ Påverkar diversifieringen: {recommendation.diversificationImpact}</li>
        <li>✓ Passar din investeringshorisont: {recommendation.nextReviewDate ? 'Ja' : 'Nej'}</li>
        <li>✓ Bygger vidare på din tidigare strategi: {recommendation.reasoning?.[0]?.slice(0,80) || ''}...</li>
      </ul>

      <div className="mt-3">
        <div className="font-medium">Alternativa idéer</div>
        <ul className="list-disc ml-5 text-sm mt-1">
          {recommendation.alternatives.map((a:string,i:number)=>(<li key={i}>{a}</li>))}
        </ul>
      </div>
    </section>
  );
}
