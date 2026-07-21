import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(()=>{ vi.resetModules(); });

describe('API /api/victor/analyze route', ()=>{
  it('returns 400 for empty symbol', async ()=>{
    const route = await import('../src/app/api/victor/analyze/route');
    const req = new Request('http://localhost/api/victor/analyze', { method: 'POST', body: JSON.stringify({ symbol: '' }), headers: { 'content-type': 'application/json' } });
    const res = await route.POST(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 500 on internal error', async ()=>{
    const route = await import('../src/app/api/victor/analyze/route');
    const req = new Request('http://localhost/api/victor/analyze', { method: 'POST', body: JSON.stringify({ symbol: '__TEST_FORCE_ERROR__' }), headers: { 'content-type': 'application/json' } });
    const res = await route.POST(req as any);
    expect(res.status).toBe(500);
  });

  it('returns investment report on success', async ()=>{
    process.env.ATLAS_ENABLE_RIKSBANK_PROVIDER = 'true';
    vi.resetModules();
    vi.unmock('../src/domain/research/victor-research-engine');
    // stub fetch for riksbank endpoints
    vi.stubGlobal('fetch', (url: string) => {
      if ((url as string).includes('/Observations/Latest/secbrepoeff')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 1.75 })));
      if ((url as string).includes('/Observations/secbrepoeff/')) return Promise.resolve(new Response(JSON.stringify([{ date: '2026-06-17', value: 1.5 }, { date: '2026-07-17', value: 1.75 }])));
      if ((url as string).includes('/Observations/Latest/')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-07-17', value: 9.99 })));
      return Promise.reject(new Error('unexpected'));
    });
    const route = await import('../src/app/api/victor/analyze/route');
    const req = new Request('http://localhost/api/victor/analyze', { method: 'POST', body: JSON.stringify({ symbol: 'ABC' }), headers: { 'content-type': 'application/json' } });
    const res = await route.POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.investmentReport).toBeDefined();
  });
});
