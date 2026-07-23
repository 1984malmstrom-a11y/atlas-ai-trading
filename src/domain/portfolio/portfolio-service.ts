import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Portfolio } from './types';

let PORTFOLIO_PATH = path.join(process.cwd(), 'src', 'data', 'portfolio.json');

// In-memory cache of the loaded portfolio. Expose getters that return clones.
let cached: Portfolio | null = null;

function isValidPortfolio(obj: any): obj is Portfolio {
  return obj && typeof obj.availableCash === 'number' && Array.isArray(obj.holdings) && typeof obj.totalValue === 'number';
}

function loadFromDisk(): Portfolio | null {
  try{
    if (!fs.existsSync(PORTFOLIO_PATH)) return null;
    const raw = fs.readFileSync(PORTFOLIO_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (isValidPortfolio(parsed)) return parsed as Portfolio;
    return null;
  }catch(e){ return null; }
}

function defaultPortfolio(): Portfolio {
  return {
    id: 'demo',
    baseCurrency: 'SEK',
    totalValue: 0,
    availableCash: 0,
    totalReturnPercent: 0,
    benchmarkReturnPercent: 0,
    largestRisk: '',
    estimatedRisk: '',
    holdings: []
  } as Portfolio;
}

// Initialize cached portfolio on module load (read-only safe load)
const initial = loadFromDisk();
cached = initial || defaultPortfolio();

// In-process write chain to serialize save operations
let writeChain: Promise<void> = Promise.resolve();

function enqueueWrite(op: () => Promise<void>): Promise<void> {
  // Ensure previous failures don't block the queue
  const start = writeChain.catch(() => undefined);
  // Create a ticket that runs the operation after previous completes.
  const ticket = start.then(() => op());
  // Advance the chain but swallow errors so later ops still run.
  writeChain = ticket.catch(() => undefined);
  return ticket;
}

// Test indirection for fs/promises to allow test spies/mocks
export const __fs = {
  writeFile: fsp.writeFile.bind(fsp),
  rename: fsp.rename.bind(fsp),
  rm: (p: string, opts?: any) => (fsp as any).rm ? (fsp as any).rm(p, opts) : fsp.unlink(p),
};

// Return a deep clone to callers to avoid accidental mutation.
export function getPortfolio(): Portfolio {
  return JSON.parse(JSON.stringify(cached));
}

// Persist updated portfolio atomically (tmp + rename). Also update in-memory cache.
export async function savePortfolio(updated: Portfolio): Promise<void> {
  const dir = path.dirname(PORTFOLIO_PATH);
  const data = JSON.stringify(updated, null, 2);

  // Ensure directory exists
  try{ await fsp.mkdir(dir, { recursive: true }); }catch(e){}

  // Unique temp filename to avoid races and allow safe cleanup
  const tmp = `${PORTFOLIO_PATH}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2,8)}`;

  // Use an in-process serializing queue to ensure saves execute sequentially
  // writeChain is a module-scoped Promise chain (defined below)
  return enqueueWrite(async () => {
    try{
      await __fs.writeFile(tmp, data, 'utf-8');
      await __fs.rename(tmp, PORTFOLIO_PATH);
      cached = JSON.parse(JSON.stringify(updated));
    }catch(err){
      // Attempt to remove tmp file if it exists
      try{ await __fs.rm(tmp, { force: true }); }catch(_){ }
      throw err;
    }
  });
}

export default { getPortfolio, savePortfolio };

// Test helper: override the portfolio path for tests. Only used in tests.
export function __setPortfolioPathForTest(p: string){
  const previous = { path: PORTFOLIO_PATH, cache: cached };
  PORTFOLIO_PATH = p;
  const loaded = loadFromDisk();
  cached = loaded || defaultPortfolio();
  // return restore function
  return function restore(){
    PORTFOLIO_PATH = previous.path;
    cached = previous.cache;
  };
}
