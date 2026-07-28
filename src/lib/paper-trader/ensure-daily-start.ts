import { VersionedPaperPortfolio, commitPaperPortfolioExecution, loadPaperPortfolio } from './supabase-paper-portfolio-store';

type LoadFn = (portfolioId: string) => Promise<VersionedPaperPortfolio>;
type CommitFn = (input: { portfolioId: string; expectedVersion: number; executionId: string; nextState: any; }) => Promise<{ status: string; state: any; version: number | null }>

function isPlainObject(v: any): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function formatStockholmDate(d: Date){
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const map: any = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

function isDailyRisk(obj: any): obj is { date: string; startValue: number }{
  return isPlainObject(obj) && typeof obj.date === 'string' && typeof obj.startValue === 'number' && Number.isFinite(obj.startValue);
}

export async function ensureDailyStart(opts: {
  portfolioId: string;
  load?: LoadFn;
  commit?: CommitFn;
  clock?: { now: () => Date };
}) : Promise<{ date: string; startValue: number }> {
  const { portfolioId } = opts;
  if (!portfolioId || typeof portfolioId !== 'string') throw new Error('invalid portfolioId');
  const loadFn: LoadFn = opts.load || (id => loadPaperPortfolio(id));
  const commitFn: CommitFn = opts.commit || (input => commitPaperPortfolioExecution(input as any) as any);
  const clock = opts.clock || { now: () => new Date() };

  const now = clock.now();
  const date = formatStockholmDate(now);

  // Step 1: read current portfolio/version
  const current = await loadFn(portfolioId);
  if (!isPlainObject(current) || !isPlainObject(current.state) || typeof current.version !== 'number') throw new Error('invalid load result');
  const state = current.state as any;

  // availableCash must be present and valid
  if (typeof state.availableCash !== 'number' || !Number.isFinite(state.availableCash)) throw new Error('invalid availableCash');

  // If dailyRisk already present for today, return it without committing
  const existingDaily = (state as any).dailyRisk;
  if (isPlainObject(existingDaily) && isDailyRisk(existingDaily) && existingDaily.date === date) {
    return { date: existingDaily.date, startValue: existingDaily.startValue };
  }

  // prepare nextState preserving all existing keys
  const nextState = JSON.parse(JSON.stringify(state));
  nextState.dailyRisk = { date, startValue: state.availableCash };

  const executionId = `daily-start:${portfolioId}:${date}`;

  // commit
  const res = await commitFn({ portfolioId, expectedVersion: current.version, executionId, nextState });
  if (!res || typeof res.status !== 'string') throw new Error('invalid commit response');
  const status = res.status;

  if (status === 'APPLIED' || status === 'DUPLICATE'){
    if (!isPlainObject(res.state)) throw new Error('invalid response state');
    const respDaily = (res.state as any).dailyRisk;
    if (!isPlainObject(respDaily) || !isDailyRisk(respDaily)) throw new Error('missing or invalid dailyRisk in response state');
    return { date: respDaily.date, startValue: respDaily.startValue };
  }

  if (status === 'VERSION_CONFLICT'){
    // read once more
    const re = await loadFn(portfolioId);
    if (!isPlainObject(re) || !isPlainObject(re.state)) throw new Error('invalid reload result');
    const reDaily = (re.state as any).dailyRisk;
    if (isPlainObject(reDaily) && isDailyRisk(reDaily) && reDaily.date === date) {
      return { date: reDaily.date, startValue: reDaily.startValue };
    }
    throw new Error('VERSION_CONFLICT_NO_DAILY_RISK');
  }

  throw new Error(`unsupported status ${status}`);
}

export default ensureDailyStart;
