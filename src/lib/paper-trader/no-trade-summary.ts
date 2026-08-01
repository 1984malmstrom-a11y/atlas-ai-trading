const NORMALIZED_REASONS: Record<string,string> = {
  'INSUFFICIENT_SIGNAL_SUPPORT': 'INSUFFICIENT_SIGNAL_SUPPORT',
  'CONFIDENCE_BELOW_THRESHOLD': 'CONFIDENCE_BELOW_THRESHOLD',
  'RISK_REJECTED': 'RISK_REJECTED',
  'FOREX_DIAGNOSTIC_ONLY': 'FOREX_DIAGNOSTIC_ONLY',
  'FOREX_AUTONOMY_NOT_ARMED': 'FOREX_AUTONOMY_NOT_ARMED',
  'FOREX_SESSION_CLOSED': 'FOREX_SESSION_CLOSED',
  'QUOTE_UNAVAILABLE': 'QUOTE_UNAVAILABLE',
  'QUOTE_STALE': 'QUOTE_STALE',
  'CONVERSION_UNAVAILABLE': 'CONVERSION_UNAVAILABLE',
  'DAILY_TRADE_LIMIT_REACHED': 'DAILY_TRADE_LIMIT_REACHED',
  'DAILY_LOSS_LIMIT_REACHED': 'DAILY_LOSS_LIMIT_REACHED',
  'POSITION_LIMIT_REACHED': 'POSITION_LIMIT_REACHED',
  'EXISTING_POSITION': 'EXISTING_POSITION',
  'NO_HOLDING_FOR_SELL': 'NO_HOLDING_FOR_SELL',
  'TRADING_DISABLED': 'TRADING_DISABLED',
};

function normalizeReason(raw: any){
  try{
    if (!raw) return 'OTHER';
    const code = raw.code || (raw.reason && raw.reason.code) || (raw.rejectReason) || raw;
    const key = String(code || '').toUpperCase();
    return NORMALIZED_REASONS[key] || (key || 'OTHER');
  }catch(_){ return 'OTHER'; }
}

export function buildForexNoTradeSummary(opts: { cycleId?: string; checkedAt?: string; evaluations?: any[]; audits?: any[] }){
  const cycleId = opts.cycleId || undefined;
  const checkedAt = opts.checkedAt || new Date().toISOString();
  const evaluations = Array.isArray(opts.evaluations) ? opts.evaluations : [];
  const audits = Array.isArray(opts.audits) ? opts.audits : [];

  const byCandidate = new Map<string, { id:string; symbol?:string; countedReasons: Set<string>; countedExecIds: Set<string>; hold?: boolean; blocked?: boolean; rejected?: boolean }>();

  function markCandidate(id: string, symbol?: string){
    if (!byCandidate.has(id)) byCandidate.set(id, { id, symbol, countedReasons: new Set(), countedExecIds: new Set(), hold: false, blocked: false, rejected: false });
    return byCandidate.get(id)!;
  }

  // Inspect evaluations to mark holds
  for (const e of evaluations){
    try{
      const dec = e && (e.decision || e.raw && e.raw.decision) ? (e.decision || (e.raw && e.raw.decision)) : null;
      const id = dec && dec.id ? String(dec.id) : (`eval_${Math.random().toString(36).slice(2,6)}`);
      const sym = dec && dec.symbol ? String(dec.symbol).toUpperCase() : undefined;
      const c = markCandidate(id, sym);
      if (e && (e.kind === 'EVALUATION' || (e.raw && e.raw.kind === 'EVALUATION'))) c.hold = true;
    }catch(_){ }
  }

  // Inspect audits (REJECT/EXECUTION/etc.) and map reasons
  for (const a of audits){
    try{
      const raw = a && a.raw ? a.raw : a;
      if (!raw) continue;
      const decision = raw.decision || (raw.execution && raw.execution && { id: raw.execution.id, symbol: raw.execution.symbol }) || null;
      const id = decision && decision.id ? String(decision.id) : (`audit_${Math.random().toString(36).slice(2,6)}`);
      const sym = decision && decision.symbol ? String(decision.symbol).toUpperCase() : undefined;
      const c = markCandidate(id, sym);
      const kind = raw.kind;
      if (kind === 'REJECT'){
        c.rejected = true;
        const r = raw.reason || raw || {};
        const nr = normalizeReason(r);
        c.countedReasons.add(nr);
        c.blocked = c.blocked || nr === 'FOREX_DIAGNOSTIC_ONLY' || nr === 'FOREX_AUTONOMY_NOT_ARMED' || nr === 'FOREX_SESSION_CLOSED' || nr === 'DAILY_TRADE_LIMIT_REACHED' || nr === 'DAILY_LOSS_LIMIT_REACHED';
      }
      if (kind === 'EXECUTION'){
        // executed -> not no-trade
        if (c) { c.countedReasons.clear(); c.hold = false; c.blocked = false; c.rejected = false; }
      }
    }catch(_){ }
  }

  // Aggregate counts
  let analyzedPairCount = 0; let holdCount = 0; let blockedCount = 0; let rejectedCount = 0;
  const reasonCounts: Record<string, number> = {};
  for (const [id, rec] of byCandidate.entries()){
    analyzedPairCount++;
    if (rec.hold) holdCount++;
    if (rec.blocked) blockedCount++;
    if (rec.rejected) rejectedCount++;
    for (const r of Array.from(rec.countedReasons)){ reasonCounts[r] = (reasonCounts[r]||0) + 1; }
  }

  const topReasons = Object.keys(reasonCounts).map(r=> ({ reason: r, count: reasonCounts[r] })).sort((a,b)=> b.count - a.count || a.reason.localeCompare(b.reason)).slice(0,10);

  return { cycleId, checkedAt, analyzedPairCount, holdCount, blockedCount, rejectedCount, topReasons };
}

export default buildForexNoTradeSummary;
