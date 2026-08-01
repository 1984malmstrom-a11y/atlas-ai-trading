"use client";

import React, { useState } from 'react';

export default function VictorMarketNewsCard({ activity, latestDecision, nextRunCountdown }: { activity: { title: string; message: string } | undefined | null, latestDecision?: any | null, nextRunCountdown?: string | null }){
  const [showReasoning, setShowReasoning] = useState(false);
  if (!activity) return null;
  return (
    <section className="mt-3 bg-white border rounded p-3">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        <div>Victor analyserade marknaden</div>
      </div>
      <div className="mt-2 text-xs text-gray-500">MARKNADSNYHETER</div>
      <div className="mt-1">
        <div className="text-sm font-semibold text-gray-800">{activity.title}</div>
        <div className="mt-1 text-sm text-gray-600">{activity.message}</div>
      </div>

      <div className="mt-3">
        <div className="text-xs text-gray-500">Senaste beslut</div>
        <div className="mt-1 text-sm font-semibold text-gray-800">{(latestDecision && latestDecision.action) ? String(latestDecision.action) : '—'}</div>
      </div>

      <div className="mt-2">
        <div className="text-xs text-gray-500">Confidence</div>
        <div className="mt-1 text-sm font-semibold text-gray-800">{(latestDecision && typeof latestDecision.confidence === 'number') ? String(latestDecision.confidence) + ' %' : '—'}</div>
      </div>

      <div className="mt-2">
        <div className="text-xs text-gray-500">Nästa analys</div>
        <div className="mt-1 text-sm font-semibold text-gray-800">{nextRunCountdown ?? '—'}</div>
      </div>

      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          aria-expanded={showReasoning}
          onClick={() => setShowReasoning(v => !v)}
          className="text-sm text-blue-600 hover:underline focus:outline-none"
        >
          {showReasoning ? 'Dölj resonemang' : 'Visa resonemang'}
        </button>
      </div>

      {showReasoning && (
        <div className="mt-3 border-t pt-3 text-sm text-gray-700">
          <div className="font-semibold">Datakällor</div>
          <div className="mt-1">────────────</div>
          <ul className="list-disc list-inside mt-2">
            {/** Show each data source but mark active only when corresponding data exists */}
            <li className={(latestDecision && (typeof latestDecision.referencePrice === 'number')) ? 'text-gray-800' : 'text-gray-500'}>Market data{(latestDecision && (typeof latestDecision.referencePrice === 'number')) ? ' · verklig' : ''}</li>
            <li className={activity ? 'text-gray-800' : 'text-gray-500'}>News analysis{activity ? ' · verklig' : ''}</li>
            <li className={(latestDecision && latestDecision.risk) ? 'text-gray-800' : 'text-gray-500'}>Risk engine{(latestDecision && latestDecision.risk) ? ' · verklig' : ''}</li>
          </ul>

          <div className="mt-3 font-semibold">Beslutsunderlag</div>
          <div className="mt-1">────────────</div>

          {latestDecision ? (
            <div className="mt-2 text-gray-600">
              <div><strong>Beslut:</strong> {latestDecision.action ? String(latestDecision.action).toUpperCase() : '—'}</div>
              <div className="mt-1"><strong>Confidence:</strong> {(typeof latestDecision.confidence === 'number') ? String(latestDecision.confidence) + ' %' : '—'}</div>
              <div className="mt-2"><strong>Motivering / sammanfattning:</strong></div>
              {Array.isArray(latestDecision.reasoning) && latestDecision.reasoning.length > 0 ? (
                <div className="mt-1 text-gray-700">{String(latestDecision.reasoning[0])}</div>
              ) : (
                <div className="mt-1 text-gray-600">Underlag saknas för detta beslut.</div>
              )}

              {Array.isArray(latestDecision.signals) && latestDecision.signals.length > 0 ? (
                <div className="mt-2"><strong>Signaler / faktorer:</strong>
                  <ul className="list-disc list-inside mt-1 text-gray-700">
                    {latestDecision.signals.map((s: any, i: number) => (<li key={i}>{String(s)}</li>))}
                  </ul>
                </div>
              ) : null}

              {latestDecision.risk ? (
                <div className="mt-2"><strong>Riskbedömning:</strong>
                  <div className="mt-1 text-gray-700">{latestDecision.risk.level ? String(latestDecision.risk.level) : JSON.stringify(latestDecision.risk)}</div>
                  {Array.isArray(latestDecision.risk.reasons) && latestDecision.risk.reasons.length > 0 ? (
                    <ul className="list-disc list-inside mt-1 text-gray-700">
                      {latestDecision.risk.reasons.map((r: any, i: number) => (<li key={i}>{String(r)}</li>))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 text-gray-600">Underlag saknas för detta beslut.</div>
          )}
        </div>
      )}
    </section>
  );
}
