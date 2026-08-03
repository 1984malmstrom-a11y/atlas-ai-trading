export function mapQualityLabel(q:any){
  if (!q) return null;
  const up = String(q).toUpperCase();
  if (up === 'INSUFFICIENT') return 'Otillräckligt underlag';
  if (up === 'LIMITED') return 'Begränsat underlag';
  if (up === 'COMPLETE' || up === 'HIGH') return 'Hög kvalitet';
  return null;
}

export function buildPaperTradingPresentation(runtime:any){
  if (!runtime) return null;
  const s = runtime;
  // helper to detect skipped/duplicate_lock
  const lastStatus = s.lastAutomaticRunStatus || null;
  const lastMsg = s.lastAutomaticRunMessage || '';
  const isSkipped = lastStatus === 'skipped' || (typeof lastMsg === 'string' && lastMsg.toLowerCase().includes('duplicate_lock'));

  // Prefer latest successful completed cycle with actual analyses
  const cycle = s.latestCycle || null;
  const cycleSummary = cycle && cycle.decisionSummary ? cycle.decisionSummary : null;
  const cycleHasAnalyses = cycleSummary && Array.isArray(cycleSummary.analyzedSymbols) && cycleSummary.analyzedSymbols.length > 0 && (!isSkipped);

  let source = 'HISTORICAL_DECISION';
  let timestamp = s.lastAutomaticRunAt || (s.latestDecision && s.latestDecision.generatedAt) || new Date().toISOString();
  let analyzedSymbols: string[] = [];
  let analyzedCount = 0;
  let assetTypes: string[] = [];
  let opportunityCount = 0;
  let executionCount = (typeof s.tradesToday === 'number') ? s.tradesToday : 0;
  let displayAction = 'Avstår';
  let analysisQualityLabel: string | null = null;
  let summary = '';
  let riskStatus = 'NOT_APPLICABLE';
  let riskMessage = '';
  let activityTitle = '';
  let activityDetail = '';
  let isHistoricalFallback = false;

  if (cycleHasAnalyses){
    source = 'SUCCESS_CYCLE';
    timestamp = cycle.completedAt || cycle.generatedAt || s.lastAutomaticRunAt || timestamp;
    analyzedSymbols = Array.from(new Set(cycleSummary.analyzedSymbols || []));
    analyzedCount = analyzedSymbols.length;
    opportunityCount = Array.isArray(cycleSummary.decisions) ? cycleSummary.decisions.filter((d:any)=> d && ['BUY','SELL'].includes(String(d.action).toUpperCase())).length : 0;
    executionCount = executionCount || 0;
    displayAction = opportunityCount > 0 ? (cycleSummary.decisions[0] && cycleSummary.decisions[0].action ? cycleSummary.decisions[0].action : 'Avstår') : 'Avstår';
    analysisQualityLabel = cycleSummary.analysisQuality && cycleSummary.analysisQuality.level ? mapQualityLabel(cycleSummary.analysisQuality.level) : null;
    summary = cycleSummary.summary || '';
    riskStatus = opportunityCount > 0 ? (cycleSummary.riskOutcome ? 'RISK_REVIEW' : 'PENDING') : 'NOT_APPLICABLE';
    riskMessage = opportunityCount > 0 ? (cycleSummary.riskMessage || '') : 'Ingen handelskandidat skapades i senaste analysen.';
    activityTitle = `Victor analyserade ${analyzedCount} marknader`;
    activityDetail = `Inga marknader uppfyllde kraven för en affär.`;
    isHistoricalFallback = false;
  } else {
    // Try intelligence maps
    const mtti = s.latestMultiTimeframeTechnicalIntelligenceBySymbol || {};
    const fxsi = s.latestForexSessionIntelligenceBySymbol || {};
    const di = s.latestDecisionIntelligenceBySymbol || {};
    const keys = new Set<string>([...Object.keys(mtti||{}), ...Object.keys(fxsi||{}), ...Object.keys(di||{})]);
    const keyArr = Array.from(keys);
    if (keyArr.length > 0){
      source = 'INTELLIGENCE_MAPS';
      timestamp = s.lastAutomaticRunAt || timestamp;
      analyzedSymbols = keyArr;
      analyzedCount = keyArr.length;
      opportunityCount = 0;
      displayAction = 'Avstår';
      analysisQualityLabel = null;
      summary = '';
      riskStatus = 'NOT_APPLICABLE';
      riskMessage = 'Ingen handelskandidat skapades i senaste analysen.';
      activityTitle = `Victor analyserade ${analyzedCount} marknader`;
      activityDetail = `Inga marknader uppfyllde kraven för en affär.`;
      isHistoricalFallback = false;
    } else {
      // Fallback to latestDecision as historical
      source = 'HISTORICAL_DECISION';
      const ld = s.latestDecision || null;
      if (ld){
        timestamp = ld.generatedAt || timestamp;
        analyzedSymbols = ld.symbol ? [ld.symbol] : [];
        analyzedCount = analyzedSymbols.length;
        displayAction = ld.action ? (String(ld.action).toUpperCase() === 'HOLD' ? 'Avstår' : ld.action) : 'Avstår';
        analysisQualityLabel = ld.analysisQuality ? mapQualityLabel(ld.analysisQuality.level) : null;
        summary = Array.isArray(ld.reasoning) ? (ld.reasoning[0] || '') : (ld.reasoning || '');
        riskStatus = ld.riskOutcome ? 'RISK_REJECTION' : 'NOT_APPLICABLE';
        riskMessage = ld.riskOutcome ? (ld.riskOutcomeMessage || '') : '';
        activityTitle = ld.symbol ? `Victor analyserade ${ld.symbol}` : 'Victor analyserade marknaden';
        activityDetail = summary || '';
        isHistoricalFallback = true;
      }
    }
  }

  // Map confidence: when quality is INSUFFICIENT don't show 0%
  let confidencePercent: number | null = null;
  if (!isHistoricalFallback && analysisQualityLabel === 'Otillräckligt underlag') confidencePercent = null;
  else if (s.latestDecision && typeof s.latestDecision.confidence === 'number') confidencePercent = s.latestDecision.confidence;

  return {
    source,
    timestamp,
    status: lastStatus || 'unknown',
    analyzedCount,
    analyzedSymbols,
    assetTypes,
    opportunityCount,
    executionCount,
    displayAction: (function(a:any){ if (!a) return 'Avstår'; const up = String(a).toUpperCase(); if (up==='HOLD') return 'Avstår'; if (up==='BUY') return 'Köp'; if (up==='SELL') return 'Sälj'; if (up==='REJECT' || up==='REJECTED') return 'Avvisad'; return a; })(displayAction),
    analysisQualityLabel,
    summary,
    riskStatus,
    riskMessage,
    activityTitle,
    activityDetail,
    isHistoricalFallback,
    confidencePercent,
  };
}

export default buildPaperTradingPresentation;
