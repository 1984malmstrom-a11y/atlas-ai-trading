export type VictorEvidence = {
  evidenceId: string;
  category: 'Market Data'|'Company Fundamentals'|'Financial News'|'Technical Analysis'|'Macro Economy'|string;
  symbol?: string | null;
  title: string;
  summary: string;
  facts?: string[];
  provider: string;
  sourceName?: string;
  sourceUrl?: string;
  publishedAt?: string | null;
  fetchedAt: string;
  freshnessStatus: 'Fresh'|'Aging'|'Stale';
  reliabilityScore: number; // 0-100
  confidence: number; // 0-100
};

export type VictorDataProvider = {
  providerId: string;
  providerName: string;
  categories: string[];
  fetchEvidence: (symbol?: string)=> Promise<VictorEvidence[]>;
  isAvailable?: ()=> Promise<boolean> | boolean;
};

export default VictorEvidence;
