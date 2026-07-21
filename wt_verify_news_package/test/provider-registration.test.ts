import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(()=>{ process.env.ATLAS_ENABLE_RIKSBANK_PROVIDER = 'true'; });

describe('Provider registration', ()=>{
  it('does not create duplicate registrations on multiple imports', async ()=>{
    // ensure clean registry
    const registry = await import('../src/domain/datahub/provider-registry');
    registry.clearProviders();
    await import('../src/domain/datahub/providers/riksbank-macro-provider');
    await import('../src/domain/datahub/providers/riksbank-macro-provider');
    const ps = registry.getProviders().filter(p=> p.providerId === 'riksbank');
    expect(ps.length).toBe(1);
  });
});
