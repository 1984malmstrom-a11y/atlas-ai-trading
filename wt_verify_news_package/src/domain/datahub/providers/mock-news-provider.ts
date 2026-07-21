import mockAnalysis from '../../../data/mock-analysis-data';
import { VictorDataProvider, VictorEvidence } from '../types';
import registry from '../provider-registry';

const provider: VictorDataProvider = {
  providerId: 'mock-news',
  providerName: 'Mock News Provider',
  categories: ['Financial News'],
  isAvailable: async () => true,
  fetchEvidence: async (symbol?: string) => {
    const items = mockAnalysis.mockNews.map((n:any,i:number)=> ({
      evidenceId: `news-${n.symbol}-${i}`,
      category: 'Financial News',
      symbol: n.symbol,
      title: `News ${n.symbol}`,
      summary: n.summary,
      facts: [n.summary],
      provider: 'MockNews',
      sourceName: 'MockNews',
      publishedAt: n.publishedAt,
      fetchedAt: new Date().toISOString(),
      freshnessStatus: 'Fresh',
      reliabilityScore: Math.min(100, n.importanceScore + 20),
      confidence: Math.min(100, n.importanceScore + 30),
    })) as VictorEvidence[];
    return symbol ? items.filter(i => i.symbol === symbol) : items;
  }
};

registry.registerProvider(provider);
export default provider;
