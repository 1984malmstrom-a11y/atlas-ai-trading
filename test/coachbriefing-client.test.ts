import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('CoachBriefing client safety checks', ()=>{
  it('does not import domain engines directly', async ()=>{
    const src = fs.readFileSync('src/components/atlas/CoachBriefing.tsx', 'utf8');
    expect(src.includes("victor-research-engine")).toBe(false);
    expect(src.includes("victor-data-hub")).toBe(false);
    expect(src.includes("victor-data-orchestrator")).toBe(false);
    expect(src.includes("riksbank-macro-provider")).toBe(false);
  });

  it('passes full investmentReport to VictorsInvestmentReportPanel', async ()=>{
    const src = fs.readFileSync('src/components/atlas/CoachBriefing.tsx', 'utf8');
    expect(src.includes('<VictorsInvestmentReportPanel report={investmentReport} />')).toBe(true);
  });
});
