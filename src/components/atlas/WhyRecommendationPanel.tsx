import React from 'react';

export default function WhyRecommendationPanel({ decision }: { decision: any }){
  if (!decision) return null;
  return (
    <section className="panel p-4 mt-4">
      <h4 className="font-semibold">Varför rekommenderar jag detta?</h4>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="font-medium">✓ Positives</div>
          <ul className="list-disc ml-5 text-sm mt-1 text-green-700">
            {decision.positives.map((p:string,i:number)=> <li key={i}>{p}</li>)}
          </ul>
        </div>
        <div>
          <div className="font-medium">⚠ Risks</div>
          <ul className="list-disc ml-5 text-sm mt-1 text-yellow-700">
            {decision.risks.map((r:string,i:number)=> <li key={i}>{r}</li>)}
          </ul>
        </div>
        <div>
          <div className="font-medium">📈 Catalysts</div>
          <ul className="list-disc ml-5 text-sm mt-1 text-blue-700">
            {decision.catalysts.map((c:string,i:number)=> <li key={i}>{c}</li>)}
          </ul>
        </div>
        <div>
          <div className="font-medium">📉 Negatives</div>
          <ul className="list-disc ml-5 text-sm mt-1 text-red-700">
            {decision.negatives.map((n:string,i:number)=> <li key={i}>{n}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}
