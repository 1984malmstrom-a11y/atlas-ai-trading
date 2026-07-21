import React from 'react';

export default function HowVictorThinksPanel({ reasoning, investorExperience }: { reasoning: any; investorExperience?: string }){
  if (!reasoning) return null;
  const explanation = (investorExperience === 'Nybörjare') ? reasoning.explainLikeBeginner : reasoning.explainLikeExperienced;
  return (
    <section className="panel p-4 mt-4">
      <h4 className="font-semibold">Hur tänkte Victor?</h4>
      <div className="mt-2 text-sm">
        <div className="font-medium">✓ Viktigaste faktorerna</div>
        <ul className="list-disc ml-5 mt-1">
          {reasoning.keyFactors.map((k:string,i:number)=>(<li key={i}>{k}</li>))}
        </ul>

        <div className="font-medium mt-2">✓ Vad talar emot?</div>
        <ul className="list-disc ml-5 mt-1">
          {reasoning.conflictingEvidence.map((c:string,i:number)=>(<li key={i}>{c}</li>))}
        </ul>

        <div className="font-medium mt-2">✓ Antaganden</div>
        <ul className="list-disc ml-5 mt-1">
          {reasoning.assumptions.map((a:string,i:number)=>(<li key={i}>{a}</li>))}
        </ul>

        <div className="font-medium mt-2">✓ Osäkerheter</div>
        <ul className="list-disc ml-5 mt-1">
          {reasoning.unansweredQuestions.map((q:string,i:number)=>(<li key={i}>{q}</li>))}
        </ul>

        <div className="font-medium mt-2">✓ Varför blev slutsatsen denna?</div>
        <p className="mt-1 text-sm text-gray-600">{explanation}</p>
      </div>
    </section>
  );
}
