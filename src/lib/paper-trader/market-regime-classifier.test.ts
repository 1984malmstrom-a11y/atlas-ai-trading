import { expect, it } from 'vitest';
import classifyMarketRegime from './market-regime-classifier';

it('classifies strong uptrend', ()=>{
  const r = classifyMarketRegime({ trendStrength: 0.8, momentum: 6, volatility: 0.2, priceVsMovingAverage: 0.03 });
  expect(r.regime).toBe('STRONG_UPTREND');
  expect(r.confidence).toBeGreaterThanOrEqual(60);
  expect(r.reasons.length).toBeGreaterThan(0);
});

it('classifies weak uptrend', ()=>{
  const r = classifyMarketRegime({ trendStrength: 0.4, momentum: 2, volatility: 0.1, priceVsMovingAverage: 0.01 });
  expect(r.regime).toBe('WEAK_UPTREND');
  expect(r.confidence).toBeGreaterThanOrEqual(40);
});

it('classifies strong downtrend', ()=>{
  const r = classifyMarketRegime({ trendStrength: -0.9, momentum: -8, volatility: 0.2, priceVsMovingAverage: -0.03 });
  expect(r.regime).toBe('STRONG_DOWNTREND');
  expect(r.confidence).toBeGreaterThanOrEqual(60);
});

it('classifies weak downtrend', ()=>{
  const r = classifyMarketRegime({ trendStrength: -0.4, momentum: -2, volatility: 0.1, priceVsMovingAverage: -0.01 });
  expect(r.regime).toBe('WEAK_DOWNTREND');
  expect(r.confidence).toBeGreaterThanOrEqual(40);
});

it('classifies range-bound', ()=>{
  const r = classifyMarketRegime({ trendStrength: 0.1, momentum: 0.2, volatility: 0.05, priceVsMovingAverage: 0.001 });
  expect(r.regime).toBe('RANGE_BOUND');
});

it('HIGH_VOLATILITY takes priority', ()=>{
  const r = classifyMarketRegime({ trendStrength: 0.9, momentum: 10, volatility: 0.8, priceVsMovingAverage: 0.05 });
  expect(r.regime).toBe('HIGH_VOLATILITY');
});

it('contradictory signals -> UNCERTAIN', ()=>{
  const r = classifyMarketRegime({ trendStrength: 0.8, momentum: -6, volatility: 0.2, priceVsMovingAverage: 0.03 });
  expect(r.regime).toBe('UNCERTAIN');
});

it('missing inputs -> UNCERTAIN', ()=>{
  const r = classifyMarketRegime({});
  expect(r.regime).toBe('UNCERTAIN');
  expect(r.confidence).toBe(0);
});
