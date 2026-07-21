import { VictorDataProvider, VictorEvidence } from '../types';
import registry from '../provider-registry';

const itemsDefault = (()=>{
  const now = new Date().toISOString();
  const items: VictorEvidence[] = [{
    evidenceId: `macro-1`,
    category: 'Macro Economy',
    symbol: null,
    title: 'Macro outlook',
    summary: 'Inga negativa makrohändelser identifierade.',
    facts: ['inflation:fallande'],
    provider: 'MockMacro',
    sourceName: 'MockMacro',
    publishedAt: now,
    fetchedAt: now,
    freshnessStatus: 'Fresh',
    reliabilityScore: 75,
    confidence: 80,
  }];
  return items;
})();

const provider: VictorDataProvider = {
  providerId: 'mock-macro',
  providerName: 'Mock Macro Provider',
  categories: ['Macro Economy'],
  isAvailable: async () => true,
  fetchEvidence: async (symbol?: string) => itemsDefault
};

registry.registerProvider(provider);
export default provider;
