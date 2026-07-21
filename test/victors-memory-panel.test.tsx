import { describe, it, expect } from 'vitest';
import fs from 'fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import VictorsInvestmentReportPanel from '../src/components/atlas/VictorsInvestmentReportPanel';

describe('VictorsInvestmentReportPanel rendering', ()=>{
  it('shows empty state for first analysis', ()=>{
    const report = { memorySummary: { previousAnalysisCount: 0 } };
    const html = renderToStaticMarkup(<VictorsInvestmentReportPanel report={report as any} />);
    expect(html.includes('Detta är Victors första analys')).toBe(true);
    expect(html.includes('undefined')).toBe(false);
    expect(html.includes('NaN')).toBe(false);
  });

  it('renders full memorySummary fields when present', ()=>{
    const report = { memorySummary: { previousAnalysisCount: 5, previousRecommendation: 'SELL', previousOverallScore: 40, currentOverallScore: 55, recommendationChanged: true, historicalAccuracy: 72, knownUserPatterns: ['trend-follower','dividend'] } };
    const html = renderToStaticMarkup(<VictorsInvestmentReportPanel report={report as any} />);
    expect(html.includes('Tidigare analyser: 5')).toBe(true);
    expect(html.includes('Föregående rekommendation: SELL')).toBe(true);
    expect(html.includes('→ 55')).toBe(true);
    expect(html.includes('+15') || html.includes('-15')).toBe(true);
    expect(html.includes('Historisk träffsäkerhet: 72%')).toBe(true);
    expect(html.includes('Kända investeringsmönster: trend-follower, dividend')).toBe(true);
  });

  it('hides historicalAccuracy when missing and never renders undefined', ()=>{
    const report = { memorySummary: { previousAnalysisCount: 2, previousRecommendation: 'BUY', previousOverallScore: 50, currentOverallScore: 50 } };
    const html = renderToStaticMarkup(<VictorsInvestmentReportPanel report={report as any} />);
    expect(html.includes('Historisk träffsäkerhet')).toBe(false);
    expect(html.includes('undefined')).toBe(false);
  });

  it('panel renders memorySummary from API-shaped report', ()=>{
    const report = { overallScore: 60, memorySummary: { previousAnalysisCount: 1, previousRecommendation: 'HOLD', previousOverallScore: 58, currentOverallScore: 60, recommendationChanged: false } };
    const html = renderToStaticMarkup(<VictorsInvestmentReportPanel report={report as any} />);
    expect(html.includes('Tidigare analyser: 1')).toBe(true);
    expect(html.includes('Föregående rekommendation: HOLD')).toBe(true);
  });
});
