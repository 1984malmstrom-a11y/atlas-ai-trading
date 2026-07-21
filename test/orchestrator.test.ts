import { describe, it, expect, beforeEach } from 'vitest';
import registry, { clearProviders } from '../src/domain/datahub/provider-registry';
import orchestrator from '../src/domain/datahub/victor-data-orchestrator';
import { VictorDataProvider } from '../src/domain/datahub/types';

beforeEach(()=>{ clearProviders(); orchestrator.clearCache(); });

describe('Data Fetch Orchestrator', ()=>{
  it('handles successful provider', async ()=>{
    const provider: VictorDataProvider = { providerId: 'p1', providerName: 'P1', categories: ['Market Data'], isAvailable: async ()=> true, fetchEvidence: async ()=> [{ evidenceId: 'e1', category: 'Market Data', title: 't', summary: 's', provider: 'p1', fetchedAt: new Date().toISOString(), freshnessStatus: 'Fresh', reliabilityScore: 80, confidence: 70 }] } as any;
    registry.registerProvider(provider);
    const res = await orchestrator.fetchAllProviders('FOO', { timeoutMs: 2000, retries: 0, cacheTtls: { 'Market Data': 60000 } });
    expect(res.find(r=> r.providerId === 'p1')?.status).toBe('Success');
  });

  it('continues when one provider fails', async ()=>{
    const good: VictorDataProvider = { providerId: 'good', providerName: 'Good', categories: ['Market Data'], isAvailable: async ()=> true, fetchEvidence: async ()=> [{ evidenceId: 'g1', category: 'Market Data', title: 't', summary: 's', provider: 'good', fetchedAt: new Date().toISOString(), freshnessStatus: 'Fresh', reliabilityScore: 80, confidence: 70 }] } as any;
    const bad: VictorDataProvider = { providerId: 'bad', providerName: 'Bad', categories: ['Market Data'], isAvailable: async ()=> true, fetchEvidence: async ()=> { throw new Error('boom'); } } as any;
    registry.registerProvider(good); registry.registerProvider(bad);
    const res = await orchestrator.fetchAllProviders('X', { timeoutMs: 2000, retries: 0, cacheTtls: { 'Market Data': 60000 } });
    const rGood = res.find(r=> r.providerId === 'good');
    const rBad = res.find(r=> r.providerId === 'bad');
    expect(rGood?.status).toBe('Success');
    expect(['Failed','Timeout']).toContain(rBad?.status);
  });

  it('times out slow provider', async ()=>{
    const slow: VictorDataProvider = { providerId: 'slow', providerName: 'Slow', categories: ['Market Data'], isAvailable: async ()=> true, fetchEvidence: async ()=> { await new Promise(r=> setTimeout(r, 100)); return []; } } as any;
    registry.registerProvider(slow);
    const res = await orchestrator.fetchAllProviders('S', { timeoutMs: 10, retries: 0, cacheTtls: { 'Market Data': 60000 } });
    const r = res.find(r=> r.providerId === 'slow');
    expect(r?.status).toBe('Timeout');
  });

  it('serves cache hits', async ()=>{
    const p: VictorDataProvider = { providerId: 'c1', providerName: 'C1', categories: ['Market Data'], isAvailable: async ()=> true, fetchEvidence: async ()=> [{ evidenceId: 'c-e', category: 'Market Data', title: 't', summary: 's', provider: 'c1', fetchedAt: new Date().toISOString(), freshnessStatus: 'Fresh', reliabilityScore: 80, confidence: 70 }] } as any;
    registry.registerProvider(p);
    const res1 = await orchestrator.fetchAllProviders('A', { timeoutMs: 2000, retries: 0, cacheTtls: { 'Market Data': 60000 } });
    expect(res1.find(r=> r.providerId === 'c1')?.status).toBe('Success');
    const res2 = await orchestrator.fetchAllProviders('A', { timeoutMs: 2000, retries: 0, cacheTtls: { 'Market Data': 60000 } });
    expect(res2.find(r=> r.providerId === 'c1')?.status).toBe('Cached');
  });

  it('uses stale cache as fallback when provider fails', async ()=>{
    const id = 'stale1';
    let behave = 'ok';
    const p: VictorDataProvider = { providerId: id, providerName: 'Stale1', categories: ['Market Data'], isAvailable: async ()=> true, fetchEvidence: async ()=> {
      if (behave === 'ok') return [{ evidenceId: 's1', category: 'Market Data', title: 't', summary: 's', provider: id, fetchedAt: new Date().toISOString(), freshnessStatus: 'Fresh', reliabilityScore: 80, confidence: 70 }];
      throw new Error('down');
    } } as any;
    registry.registerProvider(p);
    // short ttl to expire
    await orchestrator.fetchAllProviders('Z', { timeoutMs: 2000, retries: 0, cacheTtls: { 'Market Data': 1 } });
    // let cache expire
    await new Promise(r=> setTimeout(r, 10));
    behave = 'down';
    const res = await orchestrator.fetchAllProviders('Z', { timeoutMs: 50, retries: 0, cacheTtls: { 'Market Data': 1 } });
    const r = res.find(x=> x.providerId === id);
    expect(r?.status).toBe('Cached');
  });
});
