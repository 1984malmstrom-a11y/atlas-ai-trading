import { expect, it } from 'vitest';
import buildMarketContextAdvice from './market-context-advisor';

it('strong uptrend -> favorable long', ()=>{
  const adv = buildMarketContextAdvice({ marketRegime: { regime: 'STRONG_UPTREND', confidence: 80, reasons: ['Bullish signals'] } });
  expect(adv.outlook).toBe('FAVORABLE_LONG');
  expect(adv.confidence).toBeGreaterThanOrEqual(0);
  expect(adv.supportingReasons.length).toBeGreaterThan(0);
});

it('strong downtrend -> favorable short', ()=>{
  const adv = buildMarketContextAdvice({ marketRegime: { regime: 'STRONG_DOWNTREND', confidence: 85, reasons: ['Bearish signals'] } });
  expect(adv.outlook).toBe('FAVORABLE_SHORT');
});

it('range bound -> neutral', ()=>{
  const adv = buildMarketContextAdvice({ marketRegime: { regime: 'RANGE_BOUND', confidence: 30, reasons: ['Low trend'] } });
  expect(adv.outlook).toBe('NEUTRAL');
});

it('high volatility -> high risk unless strong directional', ()=>{
  const adv1 = buildMarketContextAdvice({ marketRegime: { regime: 'HIGH_VOLATILITY', confidence: 70, reasons: ['volatility 0.7 >= 0.6'] } });
  expect(['HIGH_RISK','CAUTION']).toContain(adv1.outlook);
  // strong directional despite volatility
  const adv2 = buildMarketContextAdvice({ marketRegime: { regime: 'HIGH_VOLATILITY', confidence: 70, reasons: ['volatility 0.8 >= 0.6'] }, technicalScore: 85 });
  expect(adv2.outlook).toBe('CAUTION');
});

it('uncertain or missing -> insufficient data', ()=>{
  const adv = buildMarketContextAdvice({ marketRegime: { regime: 'UNCERTAIN', confidence: 10, reasons: ['Signals disagree'] } });
  expect(adv.outlook).toBe('INSUFFICIENT_DATA');
  const adv2 = buildMarketContextAdvice({ marketRegime: null });
  expect(adv2.outlook).toBe('INSUFFICIENT_DATA');
});

it('confidence clamping and deterministic', ()=>{
  const adv = buildMarketContextAdvice({ marketRegime: { regime: 'STRONG_UPTREND', confidence: 999, reasons: ['x'] } });
  expect(adv.confidence).toBeLessThanOrEqual(100);
  const advA = buildMarketContextAdvice({ marketRegime: { regime: 'RANGE_BOUND', confidence: 20, reasons: ['x'] } });
  const advB = buildMarketContextAdvice({ marketRegime: { regime: 'RANGE_BOUND', confidence: 20, reasons: ['x'] } });
  expect(JSON.stringify(advA)).toBe(JSON.stringify(advB));
});
