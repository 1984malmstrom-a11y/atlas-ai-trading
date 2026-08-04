export type MacroEventImportance = 'LOW' | 'MEDIUM' | 'HIGH';

export type MacroEventCategory =
  | 'INTEREST_RATE'
  | 'INFLATION'
  | 'EMPLOYMENT'
  | 'GDP'
  | 'PMI'
  | 'CENTRAL_BANK_SPEECH'
  | 'OTHER';

export type MacroEventItem = {
  id: string;
  category: MacroEventCategory;
  name: string;
  scheduledAt: string;
  importance: MacroEventImportance;
  hoursUntil: number;
  country: string | null;
  currency: string | null;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
};

export type MacroEventContext = {
  schemaVersion: 1;
  source: string;
  observedAt: string | null;
  generatedAt: string;
  upcomingEvents: readonly MacroEventItem[];
  highImportanceEventCount: number;
  nearestHighImportanceEventAt: string | null;
  hoursUntilNearestHighImportanceEvent: number | null;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
  warnings: readonly string[];
};

import { fetchFinnhubEconomicCalendar, FinnhubEconomicCalendarError } from '../news-providers/finnhub-economic-calendar';

function toFiniteOrNull(v: any): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function normalizeId(id: any){ try{ return String(id||'').trim(); }catch(_){ return ''; } }
function nowIso(d?: Date){ return (d instanceof Date ? d : new Date()).toISOString(); }

export function buildMacroEventContext(opts: { events?: any[] | null; now?: Date }) : MacroEventContext{
  const now = opts && opts.now ? opts.now : new Date();
  const nowMs = now.getTime();
  const eventsRaw = Array.isArray(opts && opts.events) ? (opts as any).events.slice() : null;
  const warnings = new Set<string>();

  if (!eventsRaw || eventsRaw.length === 0){ warnings.add('MACRO_CALENDAR_UNAVAILABLE'); }

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const keep: MacroEventItem[] = [];
  const seen = new Set<string>();

  for (const r of (eventsRaw || [])){
    try{
      const idRaw = r.id || r.event_id || null;
      const name = String(r.name || r.title || r.event || '').trim();
      const category = (String(r.category || r.type || 'OTHER').toUpperCase() || 'OTHER') as MacroEventCategory;
      const importance = (String(r.importance || r.importance_level || r.impact || 'LOW').toUpperCase() || 'LOW') as MacroEventImportance;
      const scheduledRaw = r.scheduled_at || r.date || r.datetime || r.scheduled || null;
      const scheduled = scheduledRaw ? new Date(String(scheduledRaw)) : null;
      if (!scheduled || !isFinite(scheduled.getTime())){ warnings.add('MACRO_EVENT_TIMESTAMP_INVALID'); continue; }
      const dt = scheduled.getTime();
      const offset = dt - nowMs;
      // allow events up to 30 minutes in the past (recently published) so downstream gates
      // can still observe just-passed HIGH-impact events. Older past events are excluded.
      const allowPastMs = 30 * 60 * 1000;
      if (offset < -allowPastMs) continue; // too far in the past
      if (offset > sevenDaysMs) continue; // beyond 7 days excluded

      const hoursUntil = Number(((offset) / (1000*60*60)).toFixed(2));
      const country = r.country ? String(r.country).trim() : null;
      const currency = r.currency ? String(r.currency).trim() : null;
      const actual = toFiniteOrNull(r.actual);
      const forecast = toFiniteOrNull(r.forecast);
      const previous = toFiniteOrNull(r.previous);

      const dedupeKey = normalizeId(idRaw) || `${category}|${name.toLowerCase()}|${scheduled.toISOString()}`;
      if (seen.has(dedupeKey)){ warnings.add('MACRO_EVENT_DEDUPED'); continue; }
      seen.add(dedupeKey);

      keep.push({ id: normalizeId(idRaw) || `${category}_${scheduled.toISOString()}`, category, name, scheduledAt: scheduled.toISOString(), importance: (importance as MacroEventImportance), hoursUntil, country: country || null, currency: currency || null, actual, forecast, previous });
    }catch(e){ continue; }
  }

  // sort chronologically
  keep.sort((a,b)=> new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  // cap to 10
  const upcoming = keep.slice(0,10);

  const highCount = upcoming.filter(e => e.importance === 'HIGH').length;
  const nextHigh = upcoming.find(e => e.importance === 'HIGH') || null;
  const nearestHighAt = nextHigh ? nextHigh.scheduledAt : null;
  const hoursUntilNearest = nextHigh ? Number(((new Date(nextHigh.scheduledAt).getTime() - nowMs)/(1000*60*60)).toFixed(2)) : null;

  // risk rules
  let risk: MacroEventContext['riskLevel'] = 'UNKNOWN';
  if (upcoming.length === 0){ risk = 'UNKNOWN'; }
  else {
    // HIGH if any HIGH within 6 hours
    const hasHighWithin6 = upcoming.some(e => e.importance === 'HIGH' && e.hoursUntil <= 6);
    const hasHighWithin24 = upcoming.some(e => e.importance === 'HIGH' && e.hoursUntil > 6 && e.hoursUntil <= 24);
    const hasMedWithin6 = upcoming.some(e => e.importance === 'MEDIUM' && e.hoursUntil <= 6);
    if (hasHighWithin6) risk = 'HIGH';
    else if (hasHighWithin24 || hasMedWithin6) risk = 'MODERATE';
    else risk = 'LOW';
  }

  // warnings for imminent events
  if (upcoming.some(e => e.importance === 'HIGH' && e.hoursUntil <= 6)) warnings.add('MACRO_EVENT_IMMINENT');
  if (eventsRaw && eventsRaw.length > 0 && upcoming.length === 0) warnings.add('MACRO_EVENT_DATA_STALE');

  const out: MacroEventContext = {
    schemaVersion: 1,
    source: 'ECONOMIC_CALENDAR',
    observedAt: eventsRaw && eventsRaw.length ? nowIso() : null,
    generatedAt: nowIso(now),
    upcomingEvents: upcoming,
    highImportanceEventCount: highCount,
    nearestHighImportanceEventAt: nearestHighAt,
    hoursUntilNearestHighImportanceEvent: hoursUntilNearest,
    riskLevel: risk,
    warnings: Array.from(warnings).slice(0,10),
  };

  return JSON.parse(JSON.stringify(out));
}

export function sanitizeMacroEventContextForState(ctx: MacroEventContext | null){
  if (!ctx) return null;
  return {
    schemaVersion: ctx.schemaVersion,
    source: ctx.source,
    observedAt: ctx.observedAt || null,
    generatedAt: ctx.generatedAt,
    upcomingEvents: Array.isArray(ctx.upcomingEvents) ? ctx.upcomingEvents.map(e=> ({ id: String(e.id), category: e.category, name: String(e.name), scheduledAt: e.scheduledAt, importance: e.importance, hoursUntil: Number(e.hoursUntil), country: e.country || null, currency: e.currency || null, actual: e.actual === null ? null : Number(e.actual), forecast: e.forecast === null ? null : Number(e.forecast), previous: e.previous === null ? null : Number(e.previous) })) : [],
    highImportanceEventCount: Number(ctx.highImportanceEventCount || 0),
    nearestHighImportanceEventAt: ctx.nearestHighImportanceEventAt || null,
    hoursUntilNearestHighImportanceEvent: ctx.hoursUntilNearestHighImportanceEvent === null ? null : Number(ctx.hoursUntilNearestHighImportanceEvent),
    riskLevel: ctx.riskLevel,
    warnings: Array.isArray(ctx.warnings) ? ctx.warnings.slice(0,10) : [],
  } as MacroEventContext;
}

// Determine whether a given instrument is affected by any relevant HIGH-impact macro event
export function isInstrumentBlockedByMacroEvent(opts: { macroContext?: MacroEventContext | null; instrument?: { id?: string; providerSymbol?: string; baseAsset?: string | null; quoteCurrency?: string | null; assetType?: string | null; symbol?: string | null } | null; now?: Date; beforeMinutes?: number; afterMinutes?: number }): { blocked: boolean; evidence?: any } {
  try{
    const macro = opts && opts.macroContext ? opts.macroContext : null;
    const inst = opts && opts.instrument ? opts.instrument : null;
    const now = opts && opts.now ? opts.now : new Date();
    const before = typeof (opts && opts.beforeMinutes) === 'number' ? Number(opts!.beforeMinutes) : 120;
    const after = typeof (opts && opts.afterMinutes) === 'number' ? Number(opts!.afterMinutes) : 30;
    if (!macro || !Array.isArray(macro.upcomingEvents) || macro.upcomingEvents.length === 0) return { blocked: false };
    if (!inst) return { blocked: false };

    const sym = String(inst.symbol || inst.providerSymbol || inst.id || '').toUpperCase();
    const base = inst.baseAsset ? String(inst.baseAsset).toUpperCase() : null;
    const quote = inst.quoteCurrency ? String(inst.quoteCurrency).toUpperCase() : null;
    const assetType = inst.assetType ? String(inst.assetType).toUpperCase() : null;

    for (const ev of macro.upcomingEvents){
      try{
        if (!ev || String(ev.importance || '').toUpperCase() !== 'HIGH') continue;
        const evCurrency = ev.currency ? String(ev.currency).toUpperCase() : null;
        if (!evCurrency) continue;
        // compute minutesUntil using scheduledAt if present else hoursUntil
        let minutesUntil: number | null = null;
        if (ev.scheduledAt){
          const ts = Date.parse(String(ev.scheduledAt));
          if (!isNaN(ts)) minutesUntil = Math.round((ts - now.getTime()) / 60000);
        }
        if (minutesUntil === null && typeof ev.hoursUntil === 'number') minutesUntil = Math.round(ev.hoursUntil * 60);
        if (minutesUntil === null) continue;

        const beforeMatch = minutesUntil > 0 && minutesUntil <= before;
        const afterMatch = minutesUntil <= 0 && minutesUntil >= -after;
        if (!(beforeMatch || afterMatch)) continue;

        // Matching rules:
        // - Forex: block when event currency matches base OR quote
        // - USD events additionally block equities/US stocks (quoteCurrency === 'USD')
        let matchesInstrument = false;
        if (assetType === 'FOREX' || base || quote){
          if (evCurrency === base || evCurrency === quote) matchesInstrument = true;
        }
        // equities / stocks exposed to USD
        if (!matchesInstrument){
          if (evCurrency === 'USD' && assetType && (assetType === 'STOCK' || assetType === 'EQUITY')) matchesInstrument = true;
        }

        if (matchesInstrument){
          const evidence = { symbol: sym || null, eventTitle: ev.event || ev.name || null, eventCurrency: ev.currency || null, importance: ev.importance || null, scheduledAt: ev.scheduledAt || null, minutesUntil, blockWindowBeforeMinutes: before, blockWindowAfterMinutes: after };
          return { blocked: true, evidence };
        }
      }catch(_){ continue; }
    }
    return { blocked: false };
  }catch(_){ return { blocked: false }; }
}

export function createPerCycleMacroEventResolver(opts?: { fetchMacroCalendar?: (o?:{ now?: Date })=>Promise<any[]|null>, timeoutMs?: number, updateState?: (k:string, r:MacroEventContext|null)=>void }){
  let promise: Promise<MacroEventContext | null> | null = null;
  const timeoutMs = opts && typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 5000;
  async function resolve(){
    if (promise) return promise;
    promise = (async ()=>{
      try{
        const defaultFetcher = async (o?:{ now?: Date }) => {
          // call Finnhub economic calendar conservatively
          const now = o && o.now ? new Date(o.now) : new Date();
          const from = now.toISOString().slice(0,10);
          const to = new Date(now.getTime() + 7*24*60*60*1000).toISOString().slice(0,10);
          const raw = await fetchFinnhubEconomicCalendar({ from, to, apiKey: process.env.FINNHUB_API_KEY, fetchImpl: (globalThis as any).fetch });
          if(!Array.isArray(raw)) return null;
          // map to the loose shape expected by buildMacroEventContext
          return raw.map((a:any)=>({ id: a.id, name: a.event, category: a.category, scheduled_at: a.time, importance: a.impact, actual: a.actual, forecast: a.estimate, previous: a.previous, country: a.country, currency: a.currency }));
        };

        const fetcher = opts && typeof opts.fetchMacroCalendar === 'function' ? opts.fetchMacroCalendar : defaultFetcher;
        const res = await Promise.race([ fetcher({ now: new Date() }), new Promise<null>(resolve => setTimeout(()=> resolve(null), timeoutMs)) ]);
        const ctx = buildMacroEventContext({ events: Array.isArray(res) ? res : null, now: new Date() });
        try{ if (opts && typeof opts.updateState === 'function') opts.updateState('GLOBAL', sanitizeMacroEventContextForState(ctx)); }catch(_){ }
        return ctx;
      }catch(e:any){
        const u = buildMacroEventContext({ events: null, now: new Date() }) as any;
        try{
          if (e && e instanceof FinnhubEconomicCalendarError){
            try{ u.warnings = Array.from(new Set([String(e.code), ...(Array.isArray(u.warnings) ? u.warnings : [])])); }catch(_){ }
          }
        }catch(_){ }
        try{ if (opts && typeof opts.updateState === 'function') opts.updateState('GLOBAL', sanitizeMacroEventContextForState(u)); }catch(_){ }
        return u;
      }
    })();
    return promise;
  }
  return { resolve };
}

export default { buildMacroEventContext, sanitizeMacroEventContextForState, createPerCycleMacroEventResolver };
