import React from 'react';

export default function VictorsAnalysisPanel({ intelligence }: { intelligence: any }){
  if (!intelligence) return null;
  return (
    <section className="panel p-4 mt-4">
      <h4 className="font-semibold">Victors analys</h4>
      <div className="mt-2 text-sm">
        <div><strong>Overall Sentiment:</strong> {intelligence.overallSentiment}</div>
        <div><strong>Overall Score:</strong> {intelligence.overallScore}</div>
        <div><strong>Confidence:</strong> {intelligence.marketConfidence}</div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="font-medium">Möjligheter</div>
          <ul className="list-disc ml-5 text-sm mt-1">
            {intelligence.opportunities.map((o:string,i:number)=><li key={i}>{o}</li>)}
          </ul>
        </div>
        <div>
          <div className="font-medium">Risker</div>
          <ul className="list-disc ml-5 text-sm mt-1">
            {intelligence.threats.map((t:string,i:number)=><li key={i}>{t}</li>)}
          </ul>
        </div>
        <div>
          <div className="font-medium">Motsägelser</div>
          <ul className="list-disc ml-5 text-sm mt-1">
            {intelligence.contradictions.map((c:string,i:number)=><li key={i}>{c}</li>)}
          </ul>
        </div>
        <div>
          <div className="font-medium">Saknad information</div>
          <ul className="list-disc ml-5 text-sm mt-1">
            {intelligence.missingInformation.map((m:string,i:number)=><li key={i}>{m}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}
