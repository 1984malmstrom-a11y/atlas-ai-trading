import mockAnalysis from '../../../data/mock-analysis-data';
import { VictorDataProvider, VictorEvidence } from '../types';
import registry from '../provider-registry';

const provider: VictorDataProvider = {
  providerId: 'mock-fundamental',
  providerName: 'Mock Fundamentals Provider',
  categories: ['Company Fundamentals'],
  isAvailable: async () => true,
  fetchEvidence: async (symbol?: string) => {
    const items = mockAnalysis.mockFundamental.map((f:any,i:number)=> ({
      evidenceId: `fund-${f.symbol}-${i}`,
      category: 'Company Fundamentals',
      symbol: f.symbol,
      title: `Fundamentals ${f.symbol}`,
      summary: f.summary,
      facts: [f.summary],
      provider: 'MockFund',
      sourceName: 'MockFund',
      publishedAt: f.publishedAt,
      fetchedAt: new Date().toISOString(),
      freshnessStatus: 'Fresh',
      reliabilityScore: 80,
      confidence: Math.round((f.qualityScore + f.valuationScore)/2),
    })) as VictorEvidence[];
    return symbol ? items.filter(i => i.symbol === symbol) : items;
  }
};

registry.registerProvider(provider);
export default provider;
