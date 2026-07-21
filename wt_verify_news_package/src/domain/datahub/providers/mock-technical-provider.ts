import mockAnalysis from '../../../data/mock-analysis-data';
import { VictorDataProvider, VictorEvidence } from '../types';
import registry from '../provider-registry';

const provider: VictorDataProvider = {
  providerId: 'mock-technical',
  providerName: 'Mock Technical Provider',
  categories: ['Technical Analysis'],
  isAvailable: async () => true,
  fetchEvidence: async (symbol?: string) => {
    const items = mockAnalysis.mockTechnical.map((t:any,i:number)=> ({
      evidenceId: `tech-${t.symbol}-${i}`,
      category: 'Technical Analysis',
      symbol: t.symbol,
      title: `Technical ${t.symbol}`,
      summary: t.summary,
      facts: [t.summary],
      provider: 'MockTech',
      sourceName: 'MockTech',
      publishedAt: t.publishedAt,
      fetchedAt: new Date().toISOString(),
      freshnessStatus: 'Fresh',
      reliabilityScore: Math.min(90, t.momentumScore + 15),
      confidence: Math.min(95, t.momentumScore + 20),
    })) as VictorEvidence[];
    return symbol ? items.filter(i => i.symbol === symbol) : items;
  }
};

registry.registerProvider(provider);
export default provider;
