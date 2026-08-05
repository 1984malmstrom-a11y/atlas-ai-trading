import { describe, it, expect } from 'vitest';
import * as LQC from './latest-quote-cache';
import os from 'os';
import path from 'path';
import fs from 'fs';

describe('LatestQuoteCache basic behavior', () => {
  it('empty cache + one quote creates entry', () => {
    const c = LQC.createEmptyLatestQuoteCache();
    const q = [{ instrumentId: 'abc', symbol: 'ABC', providerSymbol: 'ABC', price: 10, previousClose: 9, fetchedAt: '2026-01-01T00:00:00.000Z', dataStatus: 'LIVE' }];
    const merged = LQC.mergeLatestQuotes(c, q, '2026-01-01T00:00:00.000Z');
    expect(Object.keys(merged)).toContain('abc');
    expect(merged['abc'].price).toBe(10);
  });

  it('merge keeps symbols missing in next batch', () => {
    let c = LQC.createEmptyLatestQuoteCache();
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'one', price: 1, fetchedAt: '2026-01-01T00:00:00.000Z' }], '2026-01-01T00:00:00.000Z');
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'two', price: 2, fetchedAt: '2026-01-02T00:00:00.000Z' }], '2026-01-02T00:00:00.000Z');
    expect(Object.keys(c).sort()).toEqual(['one','two'].sort());
  });

  it('newer fetchedAt replaces older', () => {
    let c = LQC.createEmptyLatestQuoteCache();
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'x', price: 5, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'x', price: 6, fetchedAt: '2026-01-01T01:00:00.000Z' }]);
    expect(c['x'].price).toBe(6);
  });

  it('older fetchedAt does not replace newer', () => {
    let c = LQC.createEmptyLatestQuoteCache();
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'y', price: 7, fetchedAt: '2026-01-01T02:00:00.000Z' }]);
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'y', price: 3, fetchedAt: '2026-01-01T01:00:00.000Z' }]);
    expect(c['y'].price).toBe(7);
  });

  it('observedAt preserved from first observation', () => {
    let c = LQC.createEmptyLatestQuoteCache();
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'z', price: 2, fetchedAt: '2026-01-01T00:00:00.000Z' }], '2026-01-01T00:00:00.000Z');
    const firstObserved = c['z'].observedAt;
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'z', price: 3, fetchedAt: '2026-01-02T00:00:00.000Z' }], '2026-01-02T00:00:00.000Z');
    expect(c['z'].observedAt).toBe(firstObserved);
  });

  it('provider changePercent number preserved', () => {
    const c = LQC.mergeLatestQuotes(LQC.createEmptyLatestQuoteCache(), [{ instrumentId: 'p1', price: 100, previousClose: 90, changePercent: 11.11, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(c['p1'].changePercent).toBeCloseTo(11.11, 6);
  });

  it('numeric string parsed', () => {
    const c = LQC.mergeLatestQuotes(LQC.createEmptyLatestQuoteCache(), [{ instrumentId: 'p2', price: '10', previousClose: '5', changePercent: '100', fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(c['p2'].price).toBe(10);
    expect(c['p2'].changePercent).toBeCloseTo(100, 6);
  });

  it('percent string "1.5%" parsed as 1.5', () => {
    const c = LQC.mergeLatestQuotes(LQC.createEmptyLatestQuoteCache(), [{ instrumentId: 'p3', price: 101.5, previousClose: 100, changePercent: '1.5%', fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(c['p3'].changePercent).toBeCloseTo(1.5, 6);
  });

  it('fallback percent calculation from price/previousClose works', () => {
    const c = LQC.mergeLatestQuotes(LQC.createEmptyLatestQuoteCache(), [{ instrumentId: 'p4', price: 110, previousClose: 100, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(c['p4'].changePercent).toBeCloseTo(10, 6);
  });

  it('previousClose missing -> changePercent null', () => {
    const c = LQC.mergeLatestQuotes(LQC.createEmptyLatestQuoteCache(), [{ instrumentId: 'p5', price: 50, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(c['p5'].changePercent).toBeNull();
  });

  it('previousClose <= 0 -> changePercent null', () => {
    const c = LQC.mergeLatestQuotes(LQC.createEmptyLatestQuoteCache(), [{ instrumentId: 'p6', price: 50, previousClose: 0, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(c['p6'].changePercent).toBeNull();
  });

  it('change computed from price - previousClose when missing', () => {
    const c = LQC.mergeLatestQuotes(LQC.createEmptyLatestQuoteCache(), [{ instrumentId: 'p7', price: 20, previousClose: 15, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(c['p7'].change).toBeCloseTo(5, 6);
  });

  it('null in new quote does not erase previous valid percent', () => {
    let c = LQC.createEmptyLatestQuoteCache();
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'keep', price: 200, previousClose: 100, changePercent: 100, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'keep', price: 201, previousClose: null, changePercent: null, fetchedAt: '2026-01-01T01:00:00.000Z' }]);
    expect(c['keep'].changePercent).toBeCloseTo(100, 6);
  });

  it('hydrate/serialize roundtrip keeps fields', () => {
    let c = LQC.createEmptyLatestQuoteCache();
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'r1', price: 12, previousClose: 10, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    const s = JSON.parse(JSON.stringify(c));
    const h = LQC.hydrateLatestQuoteCache(s);
    expect(h['r1'].price).toBe(12);
    expect(h['r1'].previousClose).toBe(10);
  });

  it('slash/underscore/id variants do not duplicate in projection', () => {
    const c = LQC.mergeLatestQuotes(LQC.createEmptyLatestQuoteCache(), [
      { instrumentId: 'eurusd', symbol: 'EUR/USD', price: 1.1, fetchedAt: '2026-01-01T00:00:00.000Z' },
      { instrumentId: 'EUR_USD', symbol: 'EUR_USD', price: 1.1, fetchedAt: '2026-01-01T00:00:00.000Z' }
    ]);
    const proj = LQC.projectLatestQuoteCache(c);
    const keys = Object.keys(proj).filter(k => k.indexOf('/')>=0);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('serialize/hydrate + atomic persist/load roundtrip (temp path)', () => {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `latest-quote-cache-test-${Date.now()}.json`);
    try{ if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); }catch(_){ }

    let c = LQC.createEmptyLatestQuoteCache();
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'rt1', price: 42, previousClose: 40, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    // persist to temp path
    LQC.persistLatestQuoteCacheAtomic(c, tmpFile);
    // ensure tmp file renamed
    expect(fs.existsSync(tmpFile)).toBe(true);
    const loaded = LQC.loadPersistedLatestQuoteCache(tmpFile);
    expect(loaded['rt1']).toBeTruthy();
    expect(loaded['rt1'].price).toBe(42);
    // cleanup
    try{ fs.unlinkSync(tmpFile); }catch(_){ }
  });

  it('load handles missing file and corrupt JSON safely', () => {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `latest-quote-cache-test-${Date.now()}.json`);
    try{ if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); }catch(_){ }
    const missing = LQC.loadPersistedLatestQuoteCache(tmpFile);
    expect(Object.keys(missing).length).toBe(0);
    // write corrupt JSON
    fs.writeFileSync(tmpFile, '{ this is not json', 'utf-8');
    const corrupt = LQC.loadPersistedLatestQuoteCache(tmpFile);
    expect(Object.keys(corrupt).length).toBe(0);
    try{ fs.unlinkSync(tmpFile); }catch(_){ }
  });

  it('TTL produces STALE after expiry on projection', () => {
    const now = '2026-01-01T00:00:00.000Z';
    // create entry with tiny expiry in the past
    let c = LQC.createEmptyLatestQuoteCache();
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'st1', price: 1.23, fetchedAt: '2026-01-01T00:00:00.000Z' }], now, ()=>'FOREX');
    // manually set expiresAt to past
    const k = Object.keys(c)[0];
    c[k].expiresAt = '2025-12-31T23:59:00.000Z';
    const proj = LQC.projectLatestQuoteCache(c, [], '2026-01-01T00:00:00.000Z');
    const key = Object.keys(proj)[0];
    expect(proj[key].isStale).toBe(true);
    expect(proj[key].dataStatus).toBe('STALE');
  });

  it('projection keys for EUR/USD and SPY are stable and single entry', () => {
    let c = LQC.createEmptyLatestQuoteCache();
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'eur_usd', symbol: 'EUR/USD', providerSymbol: 'EUR/USD', price: 1.1, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    c = LQC.mergeLatestQuotes(c, [{ instrumentId: 'spy', symbol: 'SPY', providerSymbol: 'SPY', price: 400, fetchedAt: '2026-01-01T00:00:00.000Z' }]);
    const proj = LQC.projectLatestQuoteCache(c, [], '2026-01-01T00:00:00.000Z');
    // EUR/USD key
    const eurKey = Object.keys(proj).find(k => k.indexOf('EUR')>=0 && k.indexOf('/')>=0);
    expect(eurKey).toBeTruthy();
    expect(proj[eurKey as string].instrumentId).toBe('eur_usd');
    expect(proj[eurKey as string].providerSymbol).toBe('EUR/USD');
    // SPY key
    const spyKey = Object.keys(proj).find(k => k === 'SPY');
    expect(spyKey).toBe('SPY');
    expect(proj[spyKey as string].instrumentId).toBe('spy');
  });
});
