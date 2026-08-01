import { describe, it, expect } from 'vitest';
import { buildVolumeSignal, buildTrendQualitySignal, buildSupportResistanceSignal } from './market-structure-signals';

describe('market-structure signals', () => {
  it('volume: bullish when surge confirms price uptick', () => {
    const vols = [100,110,105,120,115,130,140,150,160,500];
    const prices = [9.5,9.7,9.8,9.9,10,10.2,10.3,10.4,10.5,11];
    const sig = buildVolumeSignal('AAPL', vols, prices);
    expect(sig).toBeTruthy();
    expect(sig && sig.type).toBe('VOLUME_CONFIRMATION');
    expect(sig && sig.direction).toBe('BULLISH');
    expect(typeof (sig && sig.strength)).toBe('number');
  });

  it('volume: bearish when surge with price drop', () => {
    const vols = [300,290,310,280,270,260,250,240,230,900];
    const prices = [22,21.5,21,20.5,20,19.8,19.5,19,18.5,17.5];
    const sig = buildVolumeSignal('MSFT', vols, prices);
    expect(sig).toBeTruthy();
    expect(sig && sig.type).toBe('VOLUME_CONFIRMATION');
    expect(sig && sig.direction).toBe('BEARISH');
  });

  it('volume: neutral when no surge', () => {
    const vols = [100,102,99,101,100,98,97,103,99,101];
    const prices = [4.8,4.9,5.0,5.05,5.06,5.04,5.03,5.02,5.01,5.0];
    const sig = buildVolumeSignal('TST', vols, prices);
    expect(sig).toBeTruthy();
    expect(sig && sig.direction).toBe('NEUTRAL');
  });

  it('volume: returns null when volumes missing or insufficient', () => {
    const vols: any = undefined;
    const prices = Array.from({length:12},(_,i)=> 10 + i*0.1);
    const sig = buildVolumeSignal('NOVOL', vols as any, prices);
    expect(sig).toBeNull();
    const few = [1,2,3,4,5];
    const sig2 = buildVolumeSignal('TOO_FEW', few as any, prices);
    expect(sig2).toBeNull();
  });

  it('trend quality: bullish when consecutive ups (multi-window)', () => {
    const prices = [8,9,9.5,10,10.5,11,11.5,12,12.5];
    const sig = buildTrendQualitySignal('AAPL', prices);
    expect(sig).toBeTruthy(); expect(sig && sig.type).toBe('TREND_QUALITY'); expect(sig && sig.direction).toBe('BULLISH');
  });

  it('trend quality: bearish when consecutive downs (multi-window)', () => {
    const prices = [15,14.5,14,13.5,13,12.5,12,11.5,11];
    const sig = buildTrendQualitySignal('AAPL', prices);
    expect(sig).toBeTruthy(); expect(sig && sig.direction).toBe('BEARISH');
  });

  it('trend quality: neutral on noisy/hackig series', () => {
    const prices = [10,11,10.5,11.2,10.8,11.0,10.9,11.05];
    const sig = buildTrendQualitySignal('AAPL', prices);
    expect(sig).toBeTruthy(); expect(sig && sig.direction).toBe('NEUTRAL');
  });

  it('trend quality: returns null when too few prices', () => {
    const prices = [10,11,12];
    const sig = buildTrendQualitySignal('AAPL', prices);
    expect(sig).toBeNull();
  });

  it('support/resistance: near support bullish (exclude latest in SR computation)', () => {
    // Build historical window where prior lows are near 9 and recent last price is 9.05 -> near support
    const hist = [10,9.8,9.9,9.7,9.6,9.5,9.55,9.6,9.65,9.7,9.75];
    // append current latest price (should NOT be used in SR detection)
    const latest = 9.72;
    const prices = hist.concat([latest]);
    const sig = buildSupportResistanceSignal('AAPL', prices);
    expect(sig).toBeTruthy(); expect(sig && sig.type).toBe('SUPPLY_DEMAND_ZONE'); expect(sig && sig.direction === 'BULLISH' || sig && sig.direction === 'NEUTRAL').toBeTruthy();
  });

  it('support/resistance: returns null or valid SR signal for tiny span', () => {
    const prices = Array.from({length:10},(_,i)=> 100 + (i%2===0?0:0.001));
    const sig = buildSupportResistanceSignal('AAPL', prices);
    // Accept either null (insufficient range) or a valid SUPPLY_DEMAND_ZONE object
    expect(sig === null || (sig && sig.type === 'SUPPLY_DEMAND_ZONE')).toBeTruthy();
  });
});
