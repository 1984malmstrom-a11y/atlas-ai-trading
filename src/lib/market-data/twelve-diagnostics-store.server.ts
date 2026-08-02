import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'path';

export async function appendTwelveDiagnostic(diag: unknown): Promise<void> {
  const outPath = path.join(process.cwd(), 'src', 'data', 'twelve-diagnostics.json');
  let cur: unknown[] = [];
  try {
    const raw = await fs.readFile(outPath, 'utf8');
    try { const parsed = JSON.parse(raw || '[]'); if (Array.isArray(parsed)) cur = parsed; else cur = []; } catch { cur = []; }
  } catch (e) {
    // if file does not exist, start fresh
    cur = [];
  }
  // push diagnostic and keep at most 200 entries
  cur.push(diag);
  const toWrite = JSON.stringify(cur.slice(-200), null, 2);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, toWrite, 'utf8');
}
