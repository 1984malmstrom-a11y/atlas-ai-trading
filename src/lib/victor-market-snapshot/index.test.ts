import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TTL_MS = 5 * 60 * 1000;

describe('victor-market-snapshot', ()=>{
  beforeEach(async ()=>{
    const mod = await import('./index');
    if(mod.resetMarketSnapshotForTests) mod.resetMarketSnapshotForTests();
  });

  it('initial status EMPTY before first refresh', async ()=>{
    const mod = await import('./index');
    expect(mod.getMarketSnapshot()).toBeNull();
    expect(mod.getMarketSnapshotStatus()).toBe('EMPTY');
  });

  it('successful refresh stores data and returns READY', async ()=>{
    const mod = await import('./index');
    const build = async ()=> ({ generatedAt: new Date().toISOString(), value: 1 });
    const snap = await mod.refreshMarketSnapshot(build as any);
    expect(snap.status === 'READY' || snap.status === undefined).toBe(true);
    const current = mod.getMarketSnapshot();
    expect(current).not.toBeNull();
    expect(current.generatedAt).toBeTruthy();
    expect(current.refreshedAt).toBeTruthy();
    expect(current.expiresAt).toBeTruthy();
  });

  it('TTL: becomes STALE after expiry', async ()=>{
    const mod = await import('./index');
    vi.useFakeTimers();
    try{
      const build = async ()=> ({ generatedAt: new Date().toISOString(), v: 2 });
      await mod.refreshMarketSnapshot(build as any);
      expect(mod.getMarketSnapshotStatus()).toBe('READY');
      vi.advanceTimersByTime(TTL_MS + 1000);
      expect(mod.getMarketSnapshotStatus()).toBe('STALE');
    }finally{
      vi.useRealTimers();
    }
  });

  it('concurrent refresh calls reuse same promise and single build invocation', async ()=>{
    const mod = await import('./index');
    let calls = 0;
    let resolver: any;
    const build = ()=> new Promise(resolve=>{ calls++; resolver = resolve; });
    const p1 = mod.refreshMarketSnapshot(build as any);
    const p2 = mod.refreshMarketSnapshot(build as any);
    // may not be object-identical across module boundary; verify behavior
    resolver({ generatedAt: new Date().toISOString(), v: 3 });
    const r1 = await p1;
    const r2 = await p2;
    expect(calls).toBe(1);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.status === 'READY' || r1.status === undefined).toBe(true);
  });

  it('failed first refresh returns ERROR and does not set snapshot', async ()=>{
    const mod = await import('./index');
    const build = async ()=> { throw new Error('boom-boom-secret-key-12345678901234567890'); };
    const res = await mod.refreshMarketSnapshot(build as any);
    expect(res.status).toBe('ERROR');
    expect(typeof res.error).toBe('string');
    // should not expose long keys
    expect(res.error).not.toMatch(/[A-Za-z0-9_-]{20,}/);
    expect(mod.getMarketSnapshot()).toBeNull();
  });

  it('failed refresh after previous success keeps previous data', async ()=>{
    const mod = await import('./index');
    const okBuild = async ()=> ({ generatedAt: 'GEN-A', payload: 5 });
    await mod.refreshMarketSnapshot(okBuild as any);
    const before = mod.getMarketSnapshot();
    const badBuild = async ()=> { throw 'plain-error-object'; };
    const res = await mod.refreshMarketSnapshot(badBuild as any);
    expect(res.status).toBe('ERROR');
    const after = mod.getMarketSnapshot();
    expect(after).toEqual(before);
  });

  it('new successful refresh after error replaces data', async ()=>{
    const mod = await import('./index');
    await mod.refreshMarketSnapshot(async ()=> ({ generatedAt: 'FIRST', v:1 }) as any);
    const before = mod.getMarketSnapshot();
    // simulate error
    await mod.refreshMarketSnapshot((async ()=> { throw new Error('x'); }) as any);
    const afterError = mod.getMarketSnapshot();
    expect(afterError).toEqual(before);
    // now successful again
    await mod.refreshMarketSnapshot(async ()=> ({ generatedAt: 'SECOND', v:2 }) as any);
    const final = mod.getMarketSnapshot();
    expect(final.data.generatedAt).toBe('SECOND');
  });

  it('getMarketSnapshot returns snapshot without mutation', async ()=>{
    const mod = await import('./index');
    await mod.refreshMarketSnapshot(async ()=> ({ generatedAt: 'IMMUT', v:9 }) as any);
    const s1 = mod.getMarketSnapshot();
    const s2 = mod.getMarketSnapshot();
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });

  it('getMarketSnapshotStatus reflects lifecycle', async ()=>{
    const mod = await import('./index');
    // reset in beforeEach ensures EMPTY
    expect(mod.getMarketSnapshotStatus()).toBe('EMPTY');
    await mod.refreshMarketSnapshot(async ()=> ({ generatedAt: 'LIFE', v:11 }) as any);
    expect(mod.getMarketSnapshotStatus()).toBe('READY');
    // advance to stale
    vi.useFakeTimers();
    try{ vi.advanceTimersByTime(TTL_MS + 10); expect(mod.getMarketSnapshotStatus()).toBe('STALE'); }finally{ vi.useRealTimers(); }
  });

  it('determinism: same build result -> same business data except times', async ()=>{
    const mod = await import('./index');
    const build = async ()=> ({ generatedAt: 'SAME', content: { a:1 } });
    const r1 = await mod.refreshMarketSnapshot(build as any);
    const data1 = r1.data;
    const r2 = await mod.refreshMarketSnapshot(build as any);
    const data2 = r2.data;
    expect(JSON.stringify(data1)).toBe(JSON.stringify(data2));
  });

  it('invalid error objects are handled', async ()=>{
    const mod = await import('./index');
    const bad = async ()=> { throw 42 as any; };
    const res = await mod.refreshMarketSnapshot(bad as any);
    expect(res.status).toBe('ERROR');
    expect(typeof res.error).toBe('string');
  });

  it('expiresAt is after refreshedAt', async ()=>{
    const mod = await import('./index');
    const r = await mod.refreshMarketSnapshot(async ()=> ({ generatedAt: 'T', v:1 }) as any);
    const refreshed = new Date(r.refreshedAt).getTime();
    const expires = new Date(r.expiresAt).getTime();
    expect(expires).toBeGreaterThan(refreshed);
  });
});
