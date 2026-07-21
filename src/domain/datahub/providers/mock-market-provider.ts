import mockAnalysis from '../../../data/mock-analysis-data';
import { VictorDataProvider, VictorEvidence } from '../types';
import registry from '../provider-registry';

const provider: VictorDataProvider = {
  providerId: 'mock-market',
  providerName: 'Mock Market Provider',
  categories: ['Market Data'],
  isAvailable: async () => true,
  fetchEvidence: async (symbol?: string) => {
    const items = mockAnalysis.mockTechnical.map((t:any,i:number)=> ({
      evidenceId: `mkt-${t.symbol}-${i}`,
      category: 'Market Data',
      symbol: t.symbol,
      title: `Market snapshot ${t.symbol}`,
      summary: t.summary,
      facts: [t.summary],
      provider: 'MockMarket',
      sourceName: 'MockMarket',
      publishedAt: t.publishedAt,
      fetchedAt: new Date().toISOString(),
      freshnessStatus: 'Fresh',
      reliabilityScore: Math.min(100, t.momentumScore + 10),
      confidence: Math.min(100, t.momentumScore + 10),
    })) as VictorEvidence[];
    return symbol ? items.filter(i => i.symbol === symbol) : items;
  }
};

registry.registerProvider(provider);
export default provider;
