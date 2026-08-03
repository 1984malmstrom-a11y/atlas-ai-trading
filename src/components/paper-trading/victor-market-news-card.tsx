"use client";

import React, { useState } from 'react';
import { buildVictorAnalysisNarrative, VictorDecisionViewInput } from '../../lib/paper-trader/victor-analysis-narrative';

// Map internal data quality + numeric confidence to presentation label
export function formatConfidenceLabel(dataQualityLevel: string | null | undefined, confidence: number | null | undefined){
  try{
    const lvl = dataQualityLevel ? String(dataQualityLevel).toUpperCase() : null;
    if (lvl === 'INSUFFICIENT') return 'Otillräckligt underlag';
    if (lvl === 'LIMITED') return 'Begränsad';
    if (lvl === 'COMPLETE' || lvl === 'HIGH'){
      return (typeof confidence === 'number') ? String(confidence) + ' %' : '—';
    }
    // Fallback: if no explicit quality but numeric confidence, show percent
    if (typeof confidence === 'number') return String(confidence) + ' %';
    return '—';
  }catch(_){ return '—'; }
}

type MarketRegimeView = {
  primaryRegime: string | null;
  volatilityRegime: string | null;
  riskRegime: string | null;
  confidencePercent: number | null;
  strength: string | null;
  quality: string | null;
  warnings: readonly string[];
};

type HistoricalContextView = {
  shortTrend: string | null;
  mediumTrend: string | null;
  longTrend: string | null;
  trendAgreement: number | null;
  volatilityState: string | null;
  momentumPersistence: string | null;
  currentDrawdownPercent: number | null;
  rangePositionPercent: number | null;
  volumeTrend: string | null;
  warnings: readonly string[];
};

type VictorMarketNewsCardProps = { activity: { title: string; message: string } | undefined | null; latestDecision?: VictorDecisionViewInput | null; nextRunCountdown?: string | null; initiallyExpanded?: boolean };

function mapPrimaryRegimeToSwedish(r: string | null | undefined){
  if (!r) return 'Okänt';
  const up = String(r).toUpperCase();
  if (up === 'BULL_TREND') return 'Bulltrend';
  if (up === 'BEAR_TREND') return 'Beartrend';
  if (up === 'SIDEWAYS') return 'Sidledes marknad';
  if (up === 'BREAKOUT') return 'Utbrottsläge';
  if (up === 'MEAN_REVERSION') return 'Återgång mot medelvärdet';
  return 'Okänt';
}

function mapRiskRegimeToSwedish(r: string | null | undefined){
  if (!r) return 'Neutralt riskläge';
  const up = String(r).toUpperCase();
  if (up === 'RISK_ON') return 'Riskvilja';
  if (up === 'RISK_OFF') return 'Riskaversion';
  return 'Neutralt riskläge';
}

export default function VictorMarketNewsCard({ activity, latestDecision, nextRunCountdown, initiallyExpanded }: VictorMarketNewsCardProps){
  const [showReasoning, setShowReasoning] = useState(Boolean(initiallyExpanded));
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
        <div className="mt-1 text-sm font-semibold text-gray-800">{(latestDecision && (latestDecision as any).__presentationOnly) ? 'Avstår' : ((latestDecision && latestDecision.action) ? (function(a:any){ const up = String(a).toUpperCase(); if (up==='HOLD') return 'Behåll'; if (up==='BUY') return 'Köp'; if (up==='SELL') return 'Sälj'; if (up==='REJECT' || up==='REJECTED') return 'Avvisad'; return up; })(latestDecision.action) : '—')}</div>
      </div>

      <div className="mt-2">
        <div className="text-xs text-gray-500">Confidence</div>
        <div className="mt-1 text-sm font-semibold text-gray-800">{formatConfidenceLabel(latestDecision && (latestDecision as any).dataQualityLevel ? (latestDecision as any).dataQualityLevel : null, latestDecision && typeof latestDecision.confidence === 'number' ? latestDecision.confidence : null)}</div>
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
              <div><strong>Beslut:</strong> {(latestDecision as any).__presentationOnly ? 'Avstår' : (latestDecision.action ? (function(a:any){ const up = String(a).toUpperCase(); if (up==='HOLD') return 'Behåll'; if (up==='BUY') return 'Köp'; if (up==='SELL') return 'Sälj'; if (up==='REJECT' || up==='REJECTED') return 'Avvisad'; return up; })(latestDecision.action) : '—')}</div>
              <div className="mt-1"><strong>Confidence:</strong> {formatConfidenceLabel(latestDecision && (latestDecision as any).dataQualityLevel ? (latestDecision as any).dataQualityLevel : null, latestDecision && typeof latestDecision.confidence === 'number' ? latestDecision.confidence : null)}</div>
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

              {/* Unified Victor analysis narrative (presentation-only) */}
              {(() => {
                try{
                  const nv = latestDecision ? buildVictorAnalysisNarrative(latestDecision) : null;
                  if (!nv) return null;
                  const renderList = (arr: readonly string[] | undefined) => Array.isArray(arr) && arr.length ? (<ul className="list-disc list-inside mt-1 text-gray-700">{arr.map((s,i)=>(<li key={i}>{String(s)}</li>))}</ul>) : null;
                  return (
                    <div className="mt-4">
                      <div className="font-semibold">Victors samlade analys</div>
                      <div className="mt-1 text-sm text-gray-800"><strong>{nv.headline}</strong></div>
                      <div className="mt-1 text-sm text-gray-700">{nv.verdict}</div>
                      {nv.whyNow && nv.whyNow.length ? (<div className="mt-2 text-xs text-gray-500">Varför nu?</div>) : null}
                      {renderList(nv.whyNow)}
                      {nv.supportingFactors && nv.supportingFactors.length ? (<div className="mt-2 text-xs text-gray-500">Det som stödjer</div>) : null}
                      {renderList(nv.supportingFactors)}
                      {nv.conflictingFactors && nv.conflictingFactors.length ? (<div className="mt-2 text-xs text-gray-500">Det som talar emot</div>) : null}
                      {renderList(nv.conflictingFactors)}
                      {nv.riskFactors && nv.riskFactors.length ? (<div className="mt-2 text-xs text-gray-500">Risker</div>) : null}
                      {renderList(nv.riskFactors)}
                      {nv.watchNext && nv.watchNext.length ? (<div className="mt-2 text-xs text-gray-500">Det Victor bevakar</div>) : null}
                      {renderList(nv.watchNext)}
                      <div className="mt-2 text-xs text-gray-500">Beslutsunderlag / Datakvalitet</div>
                      <div className="mt-1 text-sm text-gray-700">{nv.dataQuality.label}</div>
                    </div>
                  );
                }catch(_){ return null; }
              })()}

              {/* Additional diagnostics: Market Regime, Historical Context, Context Impact */}
              <div className="mt-4">
                <div className="font-semibold">Marknadskontext</div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-gray-700">
                  {/* Market Regime */}
                  {(() => {
                    try{
                      const diag = latestDecision && latestDecision.marketContextDiagnostics ? latestDecision.marketContextDiagnostics : null;
                      const mr = diag && diag.marketRegime ? diag.marketRegime : null;
                      if (!mr) return (<div className="text-gray-500">Marknadsläge saknas</div>);
                      const mapRegime = (r:any) => ({
                        primaryRegime: mapPrimaryRegimeToSwedish(r.primaryRegime || null),
                        volatilityRegime: r.volatilityRegime || null,
                        riskRegime: mapRiskRegimeToSwedish(r.riskRegime || null),
                        confidencePercent: typeof r.confidence === 'number' && isFinite(r.confidence) ? Math.round(r.confidence * 100) / 100 : null,
                        strength: r.strength || null,
                        quality: r.quality || null,
                        warnings: Array.isArray(r.warnings) ? r.warnings.slice(0,5) : []
                      }) as MarketRegimeView;
                      const mv = mapRegime(mr);
                      const present = (k:string|null) => k ? k : 'Okänt';
                      return (
                        <div>
                          <div className="text-xs text-gray-500">MARKNADSLÄGE</div>
                          <div className="mt-1 grid grid-cols-2 gap-2">
                            <div><strong>Regim:</strong> {present(mv.primaryRegime)}</div>
                            <div><strong>Volatilitet:</strong> {present(mv.volatilityRegime)}</div>
                            <div><strong>Riskläge:</strong> {present(mv.riskRegime)}</div>
                            <div><strong>Confidence:</strong> {mv.confidencePercent !== null ? String(mv.confidencePercent) + ' %' : '—'}</div>
                            <div><strong>Strength:</strong> {present(mv.strength)}</div>
                            <div><strong>Datakvalitet:</strong> {present(mv.quality)}</div>
                          </div>
                        </div>
                      );
                    }catch(_){ return (<div className="text-gray-500">Marknadsläge saknas</div>); }
                  })()}

                  {/* Historical Context */}
                  {(() => {
                    try{
                      const diag = latestDecision && latestDecision.marketContextDiagnostics ? latestDecision.marketContextDiagnostics : null;
                      const hc = diag && diag.historicalContext ? diag.historicalContext : null;
                      if (!hc) return (<div className="text-gray-500">Historisk kontext saknas</div>);
                      const mapHist = (h:any) => ({
                        shortTrend: h.shortTrend || null,
                        mediumTrend: h.mediumTrend || null,
                        longTrend: h.longTrend || null,
                        trendAgreement: typeof h.trendAgreement === 'number' ? Math.round(Number(h.trendAgreement) * 100) / 100 : null,
                        volatilityState: h.volatilityState || null,
                        momentumPersistence: h.momentumPersistence || null,
                        currentDrawdownPercent: typeof h.currentDrawdownPercent === 'number' && isFinite(h.currentDrawdownPercent) ? Math.round(h.currentDrawdownPercent * 100) / 100 : null,
                        rangePositionPercent: typeof h.rangePosition === 'number' && isFinite(h.rangePosition) ? Math.round(h.rangePosition * 10000) / 100 : null,
                        volumeTrend: h.volumeTrend || null,
                        warnings: Array.isArray(h.warnings) ? h.warnings.slice(0,5) : []
                      }) as HistoricalContextView;
                      const hv = mapHist(hc);
                      return (
                        <div>
                          <div className="text-xs text-gray-500">HISTORISK KONTEXT</div>
                          <div className="mt-1 grid grid-cols-2 gap-2">
                            <div><strong>Kort trend:</strong> {hv.shortTrend ?? '—'}</div>
                            <div><strong>Medeltrend:</strong> {hv.mediumTrend ?? '—'}</div>
                            <div><strong>Lång trend:</strong> {hv.longTrend ?? '—'}</div>
                            <div><strong>Överensstämmelse:</strong> {hv.trendAgreement !== null ? String(hv.trendAgreement) : '—'}</div>
                            <div><strong>Volatilitet:</strong> {hv.volatilityState ?? '—'}</div>
                            <div><strong>Momentum:</strong> {hv.momentumPersistence ?? '—'}</div>
                            <div><strong>Aktuell drawdown:</strong> {hv.currentDrawdownPercent !== null ? String(hv.currentDrawdownPercent) + ' %' : '—'}</div>
                            <div><strong>Position i intervall:</strong> {hv.rangePositionPercent !== null ? String(hv.rangePositionPercent) + ' %' : '—'}</div>
                            <div><strong>Volymtrend:</strong> {hv.volumeTrend ?? '—'}</div>
                          </div>
                        </div>
                      );
                    }catch(_){ return (<div className="text-gray-500">Historisk kontext saknas</div>); }
                  })()}

                  {/* Context impact */}
                  {(() => {
                    try{
                      const diag = latestDecision && latestDecision.marketContextDiagnostics ? latestDecision.marketContextDiagnostics : null;
                      const ca = diag && diag.contextAlignment ? String(diag.contextAlignment) : null;
                      const summary = diag && Array.isArray(diag.contextSummary) ? diag.contextSummary.slice(0,5) : [];
                      const mapAlign = (a:string|null) => {
                        if (!a) return 'Otillräcklig data';
                        const up = String(a).toUpperCase();
                        if (up === 'SUPPORTIVE') return 'Stödjer beslutet';
                        if (up === 'CONFLICTING') return 'Motsäger beslutet';
                        if (up === 'NEUTRAL') return 'Neutral påverkan';
                        if (up === 'INSUFFICIENT') return 'Otillräcklig data';
                        return 'Okänt';
                      };
                      return (
                        <div>
                          <div className="text-xs text-gray-500">KONTEXTENS PÅVERKAN PÅ BESLUTET</div>
                          <div className="mt-1"><strong>{mapAlign(ca)}</strong></div>
                          {summary.length > 0 ? (
                            <ul className="list-disc list-inside mt-2 text-gray-700">
                              {summary.map((s:any,i:number)=>(<li key={i}>{String(s)}</li>))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    }catch(_){ return (<div className="text-gray-500">Kontekstens påverkan saknas</div>); }
                  })()}

                </div>
              </div>
        </div>
      )}
    </section>
  );
}
