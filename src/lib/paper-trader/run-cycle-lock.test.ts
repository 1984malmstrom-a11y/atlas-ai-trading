import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { acquireRunCycleLock } from './run-cycle-lock';

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
  it('returns ACQUIRED when redis returns OK and sends correct request', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'OK' }),
    });
    (global as any).fetch = fetchMock;

    const res = await acquireRunCycleLock('my-key', 123);
    expect(res).toBe('ACQUIRED');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(process.env.UPSTASH_REDIS_REST_URL);
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe(`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`);
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body as string);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toBe('SET');
    expect(body[1]).toBe('atlas:paper-trader:run-cycle:my-key');
    expect(body[3]).toBe('NX');
    expect(body[4]).toBe('EX');
    expect(body[5]).toBe(123);
  });

  it('returns DUPLICATE when redis returns null', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: null }) });

    const res = await acquireRunCycleLock('k', 60);
    expect(res).toBe('DUPLICATE');
  });

  it('returns UNAVAILABLE and does not call fetch when env missing', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock;

    const res = await acquireRunCycleLock('k', 60);
    expect(res).toBe('UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns UNAVAILABLE on network error', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    (global as any).fetch = vi.fn().mockRejectedValue(new Error('network'));

    const res = await acquireRunCycleLock('k', 60);
    expect(res).toBe('UNAVAILABLE');
  });

  it('returns UNAVAILABLE when ttlSeconds is invalid and does not call fetch', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secrettoken';
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock;

    const res = await acquireRunCycleLock('k', 0 as any);
    expect(res).toBe('UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
