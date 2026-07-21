export type RefreshSource =
  | 'quotes'
  | 'company-news'
  | 'market-news'
  | 'analyst-ratings'
  | 'insider-transactions'
  | 'sec-filings'
  | 'earnings-calendar'
  | 'economic-calendar';

export type RefreshStatus = 'DUE' | 'NOT_DUE' | 'REFRESHING' | 'BACKOFF' | 'DISABLED';

export interface RefreshSourceState {
  source: RefreshSource;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  consecutiveFailures: number;
  refreshing: boolean;
  enabled: boolean;
}

export interface RefreshSchedulerInput {
  now: string; // ISO UTC
  marketOpen: boolean;
  sources: RefreshSourceState[];
}

export interface RefreshDecision {
  source: RefreshSource;
  status: RefreshStatus;
  priority: number;
  reason: string;
  dueAt: string | null;
  nextCheckAt: string;
}

function ms(n: number){ return n; }

export function getRefreshPolicy(source: RefreshSource){
  const minute = 60_000;
  const hour = 60 * minute;
  switch(source){
    case 'quotes': return { openMarketIntervalMs: ms(1*minute), closedMarketIntervalMs: ms(30*minute), priority: 100, maxBackoffMs: ms(60*minute) };
    case 'company-news': return { openMarketIntervalMs: ms(5*minute), closedMarketIntervalMs: ms(20*minute), priority: 90, maxBackoffMs: ms(8*60*minute) };
    case 'market-news': return { openMarketIntervalMs: ms(5*minute), closedMarketIntervalMs: ms(15*minute), priority: 85, maxBackoffMs: ms(8*60*minute) };
    case 'analyst-ratings': return { openMarketIntervalMs: ms(60*minute), closedMarketIntervalMs: ms(60*minute), priority: 70, maxBackoffMs: ms(24*60*minute) };
    case 'sec-filings': return { openMarketIntervalMs: ms(30*minute), closedMarketIntervalMs: ms(120*minute), priority: 75, maxBackoffMs: ms(24*60*minute) };
    case 'insider-transactions': return { openMarketIntervalMs: ms(4*hour), closedMarketIntervalMs: ms(4*hour), priority: 60, maxBackoffMs: ms(48*hour) };
    case 'earnings-calendar': return { openMarketIntervalMs: ms(6*hour), closedMarketIntervalMs: ms(6*hour), priority: 55, maxBackoffMs: ms(48*hour) };
    case 'economic-calendar': return { openMarketIntervalMs: ms(12*hour), closedMarketIntervalMs: ms(12*hour), priority: 50, maxBackoffMs: ms(48*hour) };
    default: return { openMarketIntervalMs: ms(60*minute), closedMarketIntervalMs: ms(60*minute), priority: 10, maxBackoffMs: ms(24*hour) };
  }
}

function parseISOToMs(s?: string | undefined | null){
  if(!s) return null;
  const v = Date.parse(s);
  if(!isFinite(v)) return null;
  return v;
}

export function evaluateRefreshSchedule(input: RefreshSchedulerInput): RefreshDecision[]{
  if(!input || typeof input.now !== 'string') throw new Error('invalid now');
  const nowMs = Date.parse(input.now);
  if(!isFinite(nowMs)) throw new Error('invalid now');

  const decisions: RefreshDecision[] = input.sources.map(s => {
    const policy = getRefreshPolicy(s.source);
    const interval = input.marketOpen ? policy.openMarketIntervalMs : policy.closedMarketIntervalMs;
    const priority = policy.priority;

    // check flags
    if(!s.enabled){
      return { source: s.source, status: 'DISABLED', priority, reason: 'disabled', dueAt: null, nextCheckAt: input.now };
    }
    if(s.refreshing){
      return { source: s.source, status: 'REFRESHING', priority, reason: 'refreshing', dueAt: null, nextCheckAt: input.now };
    }

    const lastSuccessMs = parseISOToMs(s.lastSuccessAt);
    const lastFailureMs = parseISOToMs(s.lastFailureAt);

    // if no last success => DUE immediately (rule)
    if(lastSuccessMs === null){
      return { source: s.source, status: 'DUE', priority, reason: 'never succeeded', dueAt: null, nextCheckAt: input.now };
    }

    const dueMs = lastSuccessMs + interval;

    // Backoff applies only if consecutiveFailures > 0 AND lastFailure exists
    if(s.consecutiveFailures > 0 && lastFailureMs !== null){
      const normal = interval;
      // exponential backoff
      const backoffMs = Math.min(normal * Math.pow(2, s.consecutiveFailures), policy.maxBackoffMs);
      const backoffEnd = lastFailureMs + backoffMs;
      if(nowMs < backoffEnd){
        return { source: s.source, status: 'BACKOFF', priority, reason: `backoff (level ${s.consecutiveFailures})`, dueAt: new Date(backoffEnd).toISOString(), nextCheckAt: new Date(backoffEnd).toISOString() };
      }
      // else backoff passed, continue to evaluate DUE/not due based on dueMs
    }

    if(nowMs >= dueMs){
      return { source: s.source, status: 'DUE', priority, reason: 'interval passed', dueAt: null, nextCheckAt: input.now };
    }

    // not due yet
    return { source: s.source, status: 'NOT_DUE', priority, reason: 'not reached', dueAt: new Date(dueMs).toISOString(), nextCheckAt: new Date(dueMs).toISOString() };
  });

  // deterministic sort: DUE first, then priority desc, then source alpha
  const orderStatus = (st: RefreshStatus) => st === 'DUE' ? 0 : st === 'REFRESHING' ? 1 : st === 'BACKOFF' ? 2 : st === 'NOT_DUE' ? 3 : 4;
  decisions.sort((a,b)=>{
    const sa = orderStatus(a.status), sb = orderStatus(b.status);
    if(sa !== sb) return sa - sb;
    if(a.priority !== b.priority) return b.priority - a.priority;
    return a.source.localeCompare(b.source);
  });

  return decisions;
}

export default { evaluateRefreshSchedule, getRefreshPolicy };
