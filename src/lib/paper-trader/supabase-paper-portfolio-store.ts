import { Portfolio } from '../../domain/portfolio/types';

export type VersionedPaperPortfolio = {
  state: Portfolio;
  version: number;
};

export type CommitPaperPortfolioStatus =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'VERSION_CONFLICT'
  | 'NOT_FOUND'
  | 'INVALID_INPUT';

export type CommitPaperPortfolioResult = {
  status: CommitPaperPortfolioStatus;
  state: Portfolio | null;
  version: number | null;
};

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function isPlainObject(v: any): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function loadPaperPortfolio(
  portfolioId: string
): Promise<VersionedPaperPortfolio> {
  if (!portfolioId || typeof portfolioId !== 'string') throw new Error('invalid portfolioId');

  const SUPABASE_URL = requiredEnv('SUPABASE_URL');
  const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/paper_portfolio?select=state,version&id=eq.${encodeURIComponent(
    portfolioId
  )}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Accept: 'application/json',
    },
  });

  if (!res.ok) throw new Error(`http error ${res.status}`);

  let data: any;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error('invalid json');
  }

  if (!Array.isArray(data) || data.length !== 1) throw new Error('unexpected row count');

  const row = data[0];
  if (!isPlainObject(row.state)) throw new Error('invalid state');
  if (
    typeof row.version !== 'number' ||
    !Number.isFinite(row.version) ||
    !Number.isInteger(row.version) ||
    row.version < 0
  )
    throw new Error('invalid version');

  return { state: row.state as Portfolio, version: row.version };
}

export async function commitPaperPortfolioExecution(input: {
  portfolioId: string;
  expectedVersion: number;
  executionId: string;
  nextState: Portfolio;
}): Promise<CommitPaperPortfolioResult> {
  if (!input || typeof input !== 'object') throw new Error('invalid input');
  const { portfolioId, expectedVersion, executionId, nextState } = input;
  if (!portfolioId || typeof portfolioId !== 'string') throw new Error('invalid portfolioId');
  if (!Number.isFinite(expectedVersion) || !Number.isInteger(expectedVersion) || expectedVersion < 0)
    throw new Error('invalid expectedVersion');
  if (!executionId || typeof executionId !== 'string') throw new Error('invalid executionId');
  if (!isPlainObject(nextState)) throw new Error('invalid nextState');

  const SUPABASE_URL = requiredEnv('SUPABASE_URL');
  const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/commit_paper_portfolio_execution`;

  const body = {
    p_portfolio_id: portfolioId,
    p_expected_version: expectedVersion,
    p_execution_id: executionId,
    p_next_state: nextState,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`http error ${res.status}`);

  let data: any;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error('invalid json');
  }

  if (!Array.isArray(data) || data.length !== 1) throw new Error('unexpected row count');

  const row = data[0];
  const status = row.status as CommitPaperPortfolioStatus | undefined;
  const allowed = ['APPLIED', 'DUPLICATE', 'VERSION_CONFLICT', 'NOT_FOUND', 'INVALID_INPUT'];
  if (!status || typeof status !== 'string' || !allowed.includes(status)) throw new Error('invalid status');

  if (status === 'APPLIED' || status === 'DUPLICATE' || status === 'VERSION_CONFLICT') {
    if (!isPlainObject(row.state)) throw new Error('invalid state');
    if (
      typeof row.version !== 'number' ||
      !Number.isFinite(row.version) ||
      !Number.isInteger(row.version) ||
      row.version < 0
    )
      throw new Error('invalid version');
    return { status, state: row.state as Portfolio, version: row.version };
  }

  // NOT_FOUND or INVALID_INPUT
  return { status, state: row.state === null ? null : null, version: row.version === null ? null : null };
}

export default {
  loadPaperPortfolio,
  commitPaperPortfolioExecution,
};
