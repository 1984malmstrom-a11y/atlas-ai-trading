import fs from 'fs';
import { describe, it, expect } from 'vitest';

describe('analyze route code hygiene', ()=>{
  it('does not use as any or @ts-ignore in analyze route', async ()=>{
    const src = fs.readFileSync('src/app/api/victor/analyze/route.ts', 'utf8');
    expect(src.includes('as any')).toBe(false);
    expect(src.includes('@ts-ignore')).toBe(false);
  });
});
