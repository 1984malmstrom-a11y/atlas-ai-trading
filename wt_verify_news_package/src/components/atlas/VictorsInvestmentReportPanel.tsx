import React from 'react';

export default function VictorsInvestmentReportPanel({ report }: { report: any }){
  if (!report) return null;
  return (
    <section className="panel p-4 mt-4">
      <h4 className="font-semibold">Victors Investeringsrapport</h4>
      <div className="mt-2 text-sm">
          <div><strong>Total rekommendation:</strong> {report.overallRating}</div>
          <div><strong>Overall Score:</strong> {report.overallScore ?? 'N/A'}</div>
          <div><strong>Confidence:</strong> {report.confidence}%</div>
          <div><strong>Portfolio Fit:</strong> {report.portfolioFit}%</div>
          <div><strong>Investor Fit:</strong> {report.investorFit}%</div>
          <div><strong>Tidshorisont:</strong> {report.timeHorizon}</div>
          <div><strong>Nästa uppföljning:</strong> {new Date(report.nextReviewDate).toLocaleDateString()}</div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="font-medium">Möjligheter</div>
          <ul className="list-disc ml-5 text-sm mt-1">
            {(report.opportunities ?? []).map((o:string,i:number)=>(<li key={i}>{o}</li>))}
          </ul>
        </div>
        <div>
          <div className="font-medium">Risker</div>
          <ul className="list-disc ml-5 text-sm mt-1">
            {(report.risks ?? []).map((r:string,i:number)=>(<li key={i}>{r}</li>))}
          </ul>
        </div>
      </div>

      <div className="mt-3">
        <div className="font-medium">Analysmoduler som användes</div>
        <ul className="list-disc ml-5 text-sm mt-1">
          {(report.modulesUsed ?? []).map((m:string,i:number)=>(<li key={i}>{m}</li>))}
        </ul>
      <div className="mt-3">
        <div className="font-medium">Scoring (sammanfattning)</div>
        <div className="text-sm mt-1">{report.overallScore ? `Overall: ${report.overallScore}` : 'Ingen score tillgänglig'}</div>
      </div>

      <div className="mt-3">
        <div className="font-medium">Datakällor</div>
        <div className="text-sm mt-1">Källor: {(report.modulesUsed ?? []).length}</div>
        <div className="text-sm">Senast uppdaterad: {report.collectedAt ? new Date(report.collectedAt).toLocaleString() : 'N/A'}</div>
        <div className="text-sm">Antal gamla datapunkter: {report.staleEvidenceCount ?? 0}</div>
        {report.providerErrors && (report.providerErrors ?? []).length > 0 && (
          <div className="text-sm text-red-600">Provider errors: {(report.providerErrors ?? []).map((p:any)=> p.providerId).join(', ')}</div>
        )}
      </div>
      <div className="mt-3">
        <div className="font-medium">Informationskvalitet</div>
        <div className="text-sm mt-1">Validation Score: {report.validationScore ?? 'N/A'}</div>
        <div className="text-sm">Bekräftade uppgifter: {(report.corroboratedFacts ?? []).length}</div>
        <div className="text-sm">Obekräftade uppgifter: {report.unconfirmedEvidenceCount ?? 0}</div>
        <div className="text-sm">Motsägelser: {(report.contradictions ?? []).length}</div>
        <div className="text-sm">Bortsorterade datapunkter: {report.rejectedEvidenceCount ?? 0}</div>
        <div className="text-sm">Genomsnittlig källtillförlitlighet: {report.averageReliability ?? 'N/A'}</div>
      </div>
      
      <div className="mt-3">
        <div className="font-medium">Victors minne</div>
        {(() => {
          const ms = report.memorySummary;
          if (!ms || (ms.previousAnalysisCount === 0 || ms.previousAnalysisCount === undefined) && !ms.previousRecommendation && (ms.previousOverallScore === null || ms.previousOverallScore === undefined)){
            return <div className="text-sm mt-1">Detta är Victors första analys av den här aktien.</div>;
          }

          const previousCount = typeof ms.previousAnalysisCount === 'number' ? ms.previousAnalysisCount : 0;
          const prevRec = ms.previousRecommendation || '—';
          const prevScore = typeof ms.previousOverallScore === 'number' ? ms.previousOverallScore : null;
          const currScore = typeof ms.currentOverallScore === 'number' ? ms.currentOverallScore : null;
          const scoreChange = (prevScore !== null && currScore !== null) ? (Math.round((currScore - prevScore) * 100) / 100) : null;
          const scoreChangeText = scoreChange !== null ? `${scoreChange > 0 ? '+' : ''}${scoreChange}` : null;
          const scoreClass = scoreChange !== null ? (scoreChange > 0 ? 'text-green-700 bg-green-50' : scoreChange < 0 ? 'text-red-700 bg-red-50' : 'text-gray-700 bg-gray-50') : 'text-gray-700 bg-gray-50';
          const recommendationChanged = ms.recommendationChanged ? 'Ja' : 'Nej';

          return (
            <div className="mt-1 text-sm space-y-1">
              <div>Tidigare analyser: {previousCount}</div>
              <div>Föregående rekommendation: {prevRec}</div>
              <div>
                Tidigare poäng{prevScore !== null ? `: ${prevScore}` : ''}{currScore !== null ? ` → ${currScore}` : ''}
              </div>
              {scoreChangeText !== null && (
                <div className={`inline-block px-2 py-0.5 rounded text-sm ${scoreClass}`}>
                  Poängförändring: {scoreChangeText}
                </div>
              )}
              <div>Rekommendationen ändrad: {recommendationChanged}</div>
              {typeof ms.historicalAccuracy === 'number' && (
                <div>Historisk träffsäkerhet: {ms.historicalAccuracy}%</div>
              )}
              {ms.knownUserPatterns && ms.knownUserPatterns.length > 0 && (
                <div>Kända investeringsmönster: {ms.knownUserPatterns.join(', ')}</div>
              )}
            </div>
          );
        })()}
      </div>
      </div>
    </section>
  );
}
