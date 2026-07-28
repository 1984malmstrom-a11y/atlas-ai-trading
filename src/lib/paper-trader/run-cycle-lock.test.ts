import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { acquireRunCycleLock, acquireRunCycleLockWithOwner, releaseRunCycleLock } from './run-cycle-lock';

const ORIG_URL = process.env.UPSTASH_REDIS_REST_URL;
const ORIG_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.UPSTASH_REDIS_REST_URL = ORIG_URL;
  process.env.UPSTASH_REDIS_REST_TOKEN = ORIG_TOKEN;
});

afterEach(() => {
  delete (global as any).fetch;
  process.env.UPSTASH_REDIS_REST_URL = ORIG_URL;
  process.env.UPSTASH_REDIS_REST_TOKEN = ORIG_TOKEN;
});

describe('acquireRunCycleLock', () => {
  it('returns ACQUIRED when redis returns OK and sends correct request and owner token', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    let seenBody: any = null;
    const fetchMock = vi.fn().mockImplementation(async (_url:any, opts:any) => {
      seenBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ result: 'OK' }) };
    });
    (global as any).fetch = fetchMock;

    const res = await acquireRunCycleLockWithOwner('my-key', 123);
    expect(res.status).toBe('ACQUIRED');
    expect(typeof (res as any).ownerToken === 'string' && (res as any).ownerToken.length > 0).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(process.env.UPSTASH_REDIS_REST_URL);
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe(`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`);
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = seenBody;
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toBe('SET');
    expect(body[1]).toBe('atlas:paper-trader:run-cycle:my-key');
    // body[2] should be the owner token we generated
    expect(body[2]).toBe((res as any).ownerToken);
    expect(body[3]).toBe('NX');
    expect(body[4]).toBe('EX');
    expect(body[5]).toBe(123);
  });

  it('returns DUPLICATE when redis returns null', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: null }) });

    const res = await acquireRunCycleLockWithOwner('k', 60);
    expect(res.status).toBe('DUPLICATE');
  });

  it('returns UNAVAILABLE and does not call fetch when env missing', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock;
    const res = await acquireRunCycleLockWithOwner('k', 60);
    expect(res.status).toBe('UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns UNAVAILABLE on network error', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    (global as any).fetch = vi.fn().mockRejectedValue(new Error('network'));
    const res = await acquireRunCycleLockWithOwner('k', 60);
    expect(res.status).toBe('UNAVAILABLE');
  });

  it('returns UNAVAILABLE when ttlSeconds is invalid and does not call fetch', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock;
    const res = await acquireRunCycleLockWithOwner('k', 0 as any);
    expect(res.status).toBe('UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('releaseRunCycleLock performs atomic compare-and-delete and returns true on success', async ()=>{
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    let seenBody: any = null;
    (global as any).fetch = vi.fn().mockImplementation(async (_url:any, opts:any) => { seenBody = JSON.parse(opts.body); return { ok: true, json: async ()=> ({ result: 1 }) }; });
    const ok = await releaseRunCycleLock('my-key', 'owner-123');
    expect(ok).toBe(true);
    expect(seenBody[0]).toBe('EVAL');
    expect(typeof seenBody[1]).toBe('string');
    expect(seenBody[2]).toBe(1);
    expect(seenBody[3]).toBe('atlas:paper-trader:run-cycle:my-key');
    expect(seenBody[4]).toBe('owner-123');
  });

  it('releaseRunCycleLock returns false when token does not match', async ()=>{
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async ()=> ({ result: 0 }) });
    const ok = await releaseRunCycleLock('my-key', 'bad-token');
    expect(ok).toBe(false);
  });

  it('acquired wrapper still returns status string for backward compatibility', async ()=>{
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: 'OK' }) });
    const s = await acquireRunCycleLock('k', 60);
    expect(s).toBe('ACQUIRED');
  });
});
