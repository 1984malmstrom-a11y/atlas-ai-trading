export type FinnhubEconomicCalendarErrorCode =
  | 'MACRO_CALENDAR_KEY_MISSING'
  | 'MACRO_CALENDAR_PREMIUM_REQUIRED'
  | 'MACRO_CALENDAR_RATE_LIMITED'
  | 'MACRO_CALENDAR_TIMEOUT'
  | 'MACRO_CALENDAR_PAYLOAD_INVALID'
  | 'MACRO_CALENDAR_PROVIDER_ERROR';

export class FinnhubEconomicCalendarError extends Error{
  name = 'FinnhubEconomicCalendarError';
  code: FinnhubEconomicCalendarErrorCode;
  constructor(code: FinnhubEconomicCalendarErrorCode, message: string){
    super(String(message || ''));
    this.code = code;
    Object.setPrototypeOf(this, FinnhubEconomicCalendarError.prototype);
  }
}

function sanitizeMessage(msg: any){
  try{
    let s = String(msg || '');
    s = s.replace(/[A-Za-z0-9_-]{20,}/g, '[REDACTED]');
    s = s.replace(/https?:\/\/[\S]+/g,'[REDACTED_URL]');
    return s;
  }catch(e){ return 'error'; }
}

async function fetchWithTimeout(fetchImpl: any, url: string, opts: any, timeoutMs = 8000){
  if(typeof fetchImpl !== 'function') throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_PROVIDER_ERROR', 'No fetch implementation');
  return fetchImpl(url, opts);
}

function fmtDate(d: Date){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export async function fetchFinnhubEconomicCalendar(opts?: { from?: string; to?: string; apiKey?: string; fetchImpl?: typeof fetch }){
  const apiKey = opts && opts.apiKey ? String(opts.apiKey) : (process && process.env ? String(process.env.FINNHUB_API_KEY || '') : '');
  if(!apiKey) throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_KEY_MISSING', 'Missing FINNHUB_API_KEY');

  const fetchImpl = opts && opts.fetchImpl ? opts.fetchImpl : (globalThis as any).fetch;
  if(typeof fetchImpl !== 'function') throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_PROVIDER_ERROR', 'No fetch available');

  // determine from/to (YYYY-MM-DD)
  const now = new Date();
  const from = opts && opts.from ? String(opts.from) : fmtDate(now);
  const to = opts && opts.to ? String(opts.to) : fmtDate(new Date(now.getTime() + 7*24*60*60*1000));

  const params = new URLSearchParams();
  params.set('from', from);
  params.set('to', to);
  params.set('token', apiKey);
  const url = `https://finnhub.io/api/v1/calendar/economic?${params.toString()}`;

  let res: any;
  try{
    res = await fetchWithTimeout(fetchImpl, url, { method: 'GET' }, 8000);
  }catch(e:any){
    const msg = sanitizeMessage(e && e.message ? e.message : e);
    if(String(msg).toLowerCase().includes('timeout')) throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_TIMEOUT', msg);
    throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_PROVIDER_ERROR', msg);
  }

  if(!res || !res.ok){
    const status = res && res.status ? Number(res.status) : 0;
    if(status === 401 || status === 403) throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_PREMIUM_REQUIRED', 'Premium access or invalid key');
    if(status === 429) throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_RATE_LIMITED', 'Rate limited');
    // other provider failures
    let snippet = '';
    try{ const t = await res.text(); snippet = sanitizeMessage(String(t || '').slice(0,1000)); }catch(_e){}
    throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_PROVIDER_ERROR', `Status ${status} ${String(res.statusText||'')}: ${snippet}`);
  }

  let body: any;
  try{ body = await res.json(); }catch(e:any){ throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_PAYLOAD_INVALID', 'Invalid JSON payload'); }

  // expect body to be an object with a 'data' or 'calendar' array or an array itself
  let rows: any[] = [];
  if (Array.isArray(body)) rows = body;
  else if (Array.isArray(body.data)) rows = body.data;
  else if (Array.isArray(body.calendar)) rows = body.calendar;
  else throw new FinnhubEconomicCalendarError('MACRO_CALENDAR_PAYLOAD_INVALID', 'Unexpected payload shape');

  // Map only verified fields; be conservative
  const out = [] as any[];
  for(const r of rows){
    try{
      const id = r.id !== undefined && r.id !== null ? String(r.id) : undefined;
      const event = r.event || r.name || r.title || r.description || '';
      const country = r.country || r.country_code || null;
      const time = r.time || r.timestamp || r.date || r.scheduled_at || null;
      const timestamp = time ? (isNaN(Number(time)) ? (new Date(String(time)).toISOString()) : new Date(Number(time)*1000).toISOString()) : null;
      if(!timestamp) continue; // exclude events without verifiable scheduledAt
      const impact = (r.impact || r.importance || r.impact_level || '').toString().toUpperCase() || '';
      // importance mapping
      let importance: 'HIGH'|'MEDIUM'|'LOW' = 'LOW';
      if(/HIGH|H|3/.test(impact)) importance = 'HIGH'; else if(/MEDIUM|M|2/.test(impact)) importance = 'MEDIUM'; else importance = 'LOW';

      // category mapping (conservative)
      const nameLower = String(event || '').toLowerCase();
      let category: string = 'OTHER';
      if(/rate|fomc|central bank|interest rate/.test(nameLower)) category = 'INTEREST_RATE';
      else if(/cpi|ppi|inflation/.test(nameLower)) category = 'INFLATION';
      else if(/payroll|employment|unemployment|jobless|payrolls/.test(nameLower)) category = 'EMPLOYMENT';
      else if(/gdp/.test(nameLower)) category = 'GDP';
      else if(/pmi/.test(nameLower)) category = 'PMI';
      else if(/speech|testimony|press conference|remarks/.test(nameLower)) category = 'CENTRAL_BANK_SPEECH';

      const actual = (r.actual !== undefined && r.actual !== null) ? Number(r.actual) : null;
      const estimate = (r.estimate !== undefined && r.estimate !== null) ? Number(r.estimate) : null;
      const previous = (r.previous !== undefined && r.previous !== null) ? Number(r.previous) : null;

      out.push({ id, event: String(event || ''), country: country || null, time: timestamp, impact: importance, actual: Number.isFinite(Number(actual)) ? actual : null, estimate: Number.isFinite(Number(estimate)) ? estimate : null, previous: Number.isFinite(Number(previous)) ? previous : null, currency: r.currency || null, category });
    }catch(_){ continue; }
  }

  return out;
}

export default { fetchFinnhubEconomicCalendar, FinnhubEconomicCalendarError };
