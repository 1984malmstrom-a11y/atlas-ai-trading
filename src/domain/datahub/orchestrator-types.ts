import { VictorEvidence } from './types';

export type ProviderFetchResult = {
  providerId: string;
  providerName: string;
  status: 'Success'|'Partial'|'Failed'|'Timeout'|'Cached'|'RateLimited';
  evidence: VictorEvidence[];
  error?: string | null;
  durationMs: number;
  fetchedAt: string;
  fromCache?: boolean;
  retryCount?: number;
};

export type ProviderHealth = {
  providerId: string;
  available: boolean;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  consecutiveFailures: number;
  averageResponseTimeMs?: number;
  successRate?: number;
  status: 'Healthy'|'Degraded'|'Offline';
};

// types exported above
