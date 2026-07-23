import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileAuditStore } from '../src/lib/paper-trader/demo-runtime';

describe('FileAuditStore persistence', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-audit-'));
    filePath = path.join(tmpDir, 'audit.json');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  it('starts empty, persists append, and reads back across instances', async () => {
    const s1 = new FileAuditStore(filePath);
    const list1 = await s1.list();
    expect(list1).toHaveLength(0);

    const now = new Date().toISOString();
    const entry = {
      id: 'a1', timestamp: now, kind: 'RECEIVED',
      decision: { id: 'd1', symbol: 'NVDA', action: 'BUY', confidence: 80, referencePrice: 200, generatedAt: now }
    } as any;

    await s1.append(entry);

    // New instance should read it
    const s2 = new FileAuditStore(filePath);
    const list2 = await s2.list();
    expect(list2.length).toBe(1);
    expect(list2[0].summary.decisionId).toBe('d1');

    // Append another and verify both exist
    const entry2 = {
      id: 'a2', timestamp: new Date().toISOString(), kind: 'RECEIVED',
      decision: { id: 'd2', symbol: 'MSFT', action: 'BUY', confidence: 85, referencePrice: 100, generatedAt: new Date().toISOString() }
    } as any;

    await s2.append(entry2);
    const s3 = new FileAuditStore(filePath);
    const list3 = await s3.list();
    expect(list3.length).toBe(2);
    const ids = list3.map((x:any)=> x.summary.decisionId).sort();
    expect(ids).toEqual(['d1','d2']);
  });
});
