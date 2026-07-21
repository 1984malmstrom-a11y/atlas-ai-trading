import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROVIDER_PATH = '../src/domain/datahub/providers/riksbank-macro-provider';

beforeEach(()=>{ vi.resetModules(); });

describe('Riksbank provider', ()=>{
  it('does not register when feature flag is off', async ()=>{
    process.env.ATLAS_ENABLE_RIKSBANK_PROVIDER = 'false';
    await import(PROVIDER_PATH);
    const { default: reg, getProviders } = await import('../src/domain/datahub/provider-registry');
    const ps = getProviders();
    expect(ps.find(p=> p.providerId === 'riksbank')).toBeUndefined();
  });

  it('normalizes latest observations to VictorEvidence', async ()=>{
    process.env.ATLAS_ENABLE_RIKSBANK_PROVIDER = 'true';
    // mock fetch responses
    vi.stubGlobal('fetch', (url: string) => {
      if ((url as string).includes('/Observations/Latest/secbrepoeff')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 1.75 })));
      if ((url as string).includes('/Observations/secbrepoeff/')) return Promise.resolve(new Response(JSON.stringify([{ date: '2026-06-17', value: 1.5 }, { date: '2026-07-17', value: 1.75 }])));
      if ((url as string).includes('/Observations/Latest/sekeurpmi')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 11.23 })));
      if ((url as string).includes('/Observations/Latest/sekusdpmi')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 9.12 })));
      if ((url as string).includes('/Observations/Latest/sekgbppmi')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 12.34 })));
      if ((url as string).includes('/Observations/Latest/seknokpmi')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 1.02 })));
      if ((url as string).includes('/Observations/Latest/sekdkkpmi')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 0.68 })));
      return Promise.reject(new Error('unexpected'));
    });

    const mod = await import(PROVIDER_PATH);
    const { getProviders } = await import('../src/domain/datahub/provider-registry');
    const p = getProviders().find(x=> x.providerId === 'riksbank');
    expect(p).toBeDefined();
    const arr = await p!.fetchEvidence();
    expect(arr.find(a=> a.title.includes('Policy rate'))).toBeDefined();
    expect(arr.find(a=> a.title.includes('Policy rate change'))).toBeDefined();
    // exchange rates
    expect(arr.find(a=> a.symbol === 'SEKEURPMI')).toBeDefined();
    expect(arr.every(a=> a.provider === 'riksbank')).toBeTruthy();
  });

  it('orchestrator surfaces provider error on bad API', async ()=>{
    process.env.ATLAS_ENABLE_RIKSBANK_PROVIDER = 'true';
    vi.stubGlobal('fetch', ()=> Promise.resolve(new Response('Not JSON', { status: 500, statusText: 'Err' })));
    await import(PROVIDER_PATH);
    const orchestrator = (await import('../src/domain/datahub/victor-data-orchestrator')).default;
    const res = await orchestrator.fetchAllProviders('X', { timeoutMs: 2000, retries: 0, cacheTtls: { 'Macro Economy': 60000 } });
    const r = res.find(x=> x.providerId === 'riksbank');
    expect(r).toBeDefined();
    expect(r!.status === 'Failed' || r!.status === 'Timeout').toBeTruthy();
  });

  it('uses cache fallback when provider fails after success', async ()=>{
    process.env.ATLAS_ENABLE_RIKSBANK_PROVIDER = 'true';
    let behave = 'ok';
    vi.stubGlobal('fetch', (url: string) => {
      if (behave === 'ok'){
        if ((url as string).includes('/Observations/Latest/secbrepoeff')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 1.75 })));
        if ((url as string).includes('/Observations/secbrepoeff/')) return Promise.resolve(new Response(JSON.stringify([{ date: '2026-06-17', value: 1.5 }, { date: '2026-07-17', value: 1.75 }])));
        if ((url as string).includes('/Observations/Latest/')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 9.99 })));
      }
      return Promise.reject(new Error('down'));
    });
    await import(PROVIDER_PATH);
    const orchestrator = (await import('../src/domain/datahub/victor-data-orchestrator')).default;
    // first successful fetch
    const r1 = await orchestrator.fetchAllProviders('A', { timeoutMs: 2000, retries: 0, cacheTtls: { 'Macro Economy': 1 } });
    expect(r1.find(x=> x.providerId === 'riksbank')?.status).toBe('Success');
    // expire small ttl
    await new Promise(r=> setTimeout(r, 10));
    behave = 'down';
    const r2 = await orchestrator.fetchAllProviders('A', { timeoutMs: 50, retries: 0, cacheTtls: { 'Macro Economy': 1 } });
    expect(r2.find(x=> x.providerId === 'riksbank')?.status).toBe('Cached');
  });

  it('real data prioritized over mock in dataHub', async ()=>{
    process.env.ATLAS_ENABLE_RIKSBANK_PROVIDER = 'true';
    // stub riksbank success
    vi.stubGlobal('fetch', (url: string) => {
      if ((url as string).includes('/Observations/Latest/secbrepoeff')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 1.75 })));
      if ((url as string).includes('/Observations/secbrepoeff/')) return Promise.resolve(new Response(JSON.stringify([{ date: '2026-06-17', value: 1.5 }, { date: '2026-07-17', value: 1.75 }])));
      if ((url as string).includes('/Observations/Latest/')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 9.99 })));
      return Promise.reject(new Error('unexpected'));
    });
    const mock = await import('../src/domain/datahub/providers/mock-macro-provider');
    const riks = await import(PROVIDER_PATH);
    const dataHub = await import('../src/domain/datahub/victor-data-hub');
    // collect via dataHub to ensure dedupe and prioritization
    const res = await dataHub.collectEvidence('');
    expect(res.evidence.length).toBeGreaterThan(0);
    // first evidence should be from riksbank due to higher reliability
    expect(res.evidence[0].provider).toBe('riksbank');
  });
});
