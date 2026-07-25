import { PortfolioAdapter, SimulatedExecution } from './types';
import computeNextPortfolioState from './portfolio-mutation';
import {
  loadPaperPortfolio,
  commitPaperPortfolioExecution,
} from './supabase-paper-portfolio-store';

export function createSupabasePortfolioAdapter(
  portfolioId: string
): PortfolioAdapter {
  if (!portfolioId || typeof portfolioId !== 'string') throw new Error('invalid portfolioId');
  const id = portfolioId.trim();
  if (!id) throw new Error('invalid portfolioId');

  return {
    getPortfolio: async () => {
      const loaded = await loadPaperPortfolio(id);
      return loaded.state;
    },

    applyExecution: async (exec: SimulatedExecution) => {
      // load current version once
      const current = await loadPaperPortfolio(id);
      const nextState = computeNextPortfolioState(current.state, exec);

      const res = await commitPaperPortfolioExecution({
        portfolioId: id,
        expectedVersion: current.version,
        executionId: exec.id,
        nextState,
      });

      const status = res.status;
      if (status === 'APPLIED' || status === 'DUPLICATE') {
        if (!res.state || typeof res.version !== 'number') throw new Error('invalid store response');
        return res.state;
      }

      if (status === 'VERSION_CONFLICT') throw new Error('VERSION_CONFLICT');
      if (status === 'NOT_FOUND') throw new Error('NOT_FOUND');
      if (status === 'INVALID_INPUT') throw new Error('INVALID_INPUT');

      throw new Error('unsupported status');
    },
  };
}

export default createSupabasePortfolioAdapter;
