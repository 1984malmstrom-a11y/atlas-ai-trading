import { describe, it, expect } from 'vitest';
import { buildMarketOverviewViewModel } from './market-overview-view-model';
import { TRADABLE_INSTRUMENTS } from './instruments';

describe('market overview view model', ()=>{
  it('includes all registered instruments and marks missing quotes UNAVAILABLE', ()=>{
    const someInst = TRADABLE_INSTRUMENTS.slice(0,3);
    const snapshot:any = {
      latestQuoteSnapshotBySymbol: {
        // only include first instrument providerSymbol
        [(someInst[0].providerSymbol || someInst[0].id).toString().toUpperCase()]: { price: 10, dataStatus: 'LIVE', changePercent: 1.2 }
      },
      latestDecisionIntelligenceBySymbol: {},
      latestSignalBuildDiagnosticsBySymbol: {},
      latestCycle: { decisionSummary: { analyzedSymbols: [] } },
    };
    const vm = buildMarketOverviewViewModel(snapshot as any);
    // all registered instruments present
    expect(vm.rows.length).toBe(TRADABLE_INSTRUMENTS.length);
    // the instrument with no quote should be UNAVAILABLE
    const missing = vm.rows.find(r => r.symbol === ((someInst[1].providerSymbol || someInst[1].id).toString().toUpperCase()));
    if (missing) expect(missing.dataStatus).toBe('UNAVAILABLE');
  });

  it('maps LIVE, DELAYED, STALE correctly and preserves null confidence', ()=>{
    const inst = TRADABLE_INSTRUMENTS[0];
    const sym = (inst.providerSymbol || inst.id).toString().toUpperCase();
    const snapshot:any = {
      latestQuoteSnapshotBySymbol: {
        [sym]: { price: 5, dataStatus: 'DELAYED', change_percent: 0.5 }
      },
      latestDecisionIntelligenceBySymbol: {
        [sym]: { action: 'BUY', confidence: null, generatedAt: new Date().toISOString() }
      },
      latestSignalBuildDiagnosticsBySymbol: {},
      latestCycle: { decisionSummary: { analyzedSymbols: [] } },
    };
    const vm = buildMarketOverviewViewModel(snapshot as any);
    const row = vm.rows.find(r=>r.symbol===sym)!;
    expect(row.dataStatus).toBe('DELAYED');
    expect(row.hasDecisionIntelligence).toBe(true);
    expect(row.analyzedInLatestCycle).toBe(false);
    expect(row.confidence).toBeNull();
  });

  it('analyzedInLatestCycle only uses canonical cycle list', ()=>{
    const inst = TRADABLE_INSTRUMENTS[0];
    const sym = (inst.providerSymbol || inst.id).toString().toUpperCase();
    const snapshot:any = {
      latestQuoteSnapshotBySymbol: {},
      latestDecisionIntelligenceBySymbol: {},
      latestSignalBuildDiagnosticsBySymbol: {},
      latestCycle: { decisionSummary: { analyzedSymbols: [sym] } },
    };
    const vm = buildMarketOverviewViewModel(snapshot as any);
    const row = vm.rows.find(r=>r.symbol===sym)!;
    expect(row.analyzedInLatestCycle).toBe(true);
  });

  it('schedulerRunning vs cycleInProgress mapping and snapshotGeneratedAt', ()=>{
    const inst = TRADABLE_INSTRUMENTS[0];
    const sym = (inst.providerSymbol || inst.id).toString().toUpperCase();
    const snapshot:any = {
      latestQuoteSnapshotBySymbol: {},
      latestDecisionIntelligenceBySymbol: {},
      latestSignalBuildDiagnosticsBySymbol: {},
      latestCycle: { decisionSummary: { analyzedSymbols: [] } },
      schedulerRunning: true,
      cycleInProgress: false,
      snapshotGeneratedAt: '2020-01-01T00:00:00.000Z'
    };
    const vm = buildMarketOverviewViewModel(snapshot as any);
    expect(vm.health.scheduler.running).toBe(true);
    expect(vm.health.scheduler.cycleInProgress).toBe(false);
    expect(vm.generatedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('forex variant matching for quotes and DI', ()=>{
    // find EUR/USD instrument
    const eur = TRADABLE_INSTRUMENTS.find(i => i.id === 'EUR_USD');
    expect(eur).toBeDefined();
    const sym = (eur!.providerSymbol || eur!.id).toString().toUpperCase();
    const snapshot:any = {
      latestQuoteSnapshotBySymbol: {
        // provider may send EUR_USD key
        ['EUR_USD']: { price: 9.99, dataStatus: 'LIVE', fetchedAt: '2020-01-01T00:00:00Z' }
      },
      latestDecisionIntelligenceBySymbol: {
        // DI might be keyed as EURUSD
        ['EURUSD']: { action: 'SELL', confidence: 42 }
      },
      latestMultiTimeframeTechnicalIntelligenceBySymbol: {
        // MTTI might be keyed as EUR/USD
        ['EUR/USD']: { trend: 'DOWN' }
      },
      latestSignalBuildDiagnosticsBySymbol: {},
      latestCycle: { decisionSummary: { analyzedSymbols: [] } },
    };
    const vm = buildMarketOverviewViewModel(snapshot as any);
    const row = vm.rows.find(r => r.instrumentId === eur!.id);
    expect(row).toBeDefined();
    expect(row!.price).toBe(9.99);
    expect(row!.hasDecisionIntelligence).toBe(true);
    expect(row!.hasMTTI).toBe(true);
    expect(row!.victorAction).toBe('SELL');
  });

  it('does not produce duplicate instrumentIds', ()=>{
    const vm = buildMarketOverviewViewModel({} as any);
    const ids = vm.rows.map(r=>r.instrumentId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('forex variants GBP and USD/JPY match across variants', ()=>{
    const gbp = TRADABLE_INSTRUMENTS.find(i => i.id === 'GBP_USD');
    const jpy = TRADABLE_INSTRUMENTS.find(i => i.id === 'USD_JPY');
    expect(gbp).toBeDefined(); expect(jpy).toBeDefined();
    const snapshot:any = {
      latestQuoteSnapshotBySymbol: {
        ['GBP_USD']: { price: 1.23, dataStatus: 'LIVE' },
        ['USD_JPY']: { price: 110.5, dataStatus: 'LIVE' }
      },
      latestDecisionIntelligenceBySymbol: {
        ['GBPUSD']: { action: 'BUY', confidence: 11 },
        ['USDJPY']: { action: 'SELL', confidence: 22 }
      },
      latestMultiTimeframeTechnicalIntelligenceBySymbol: {
        ['GBP/USD']: { trend: 'UP' },
        ['USD/JPY']: { trend: 'DOWN' }
      },
      latestSignalBuildDiagnosticsBySymbol: {},
      latestCycle: { decisionSummary: { analyzedSymbols: [] } },
    };
    const vm = buildMarketOverviewViewModel(snapshot as any);
    const rG = vm.rows.find(r=> r.instrumentId === gbp!.id);
    const rJ = vm.rows.find(r=> r.instrumentId === jpy!.id);
    expect(rG).toBeDefined(); expect(rJ).toBeDefined();
    expect(rG!.price).toBe(1.23); expect(rG!.hasDecisionIntelligence).toBe(true); expect(rG!.hasMTTI).toBe(true);
    expect(rJ!.price).toBe(110.5); expect(rJ!.hasDecisionIntelligence).toBe(true); expect(rJ!.hasMTTI).toBe(true);
  });

  it('stock instruments SPY, QQQ, NVDA present and match', ()=>{
    const spy = TRADABLE_INSTRUMENTS.find(i=> i.id === 'spy');
    const qqq = TRADABLE_INSTRUMENTS.find(i=> i.id === 'qqq');
    const nv = TRADABLE_INSTRUMENTS.find(i=> i.providerSymbol === 'NVDA');
    expect(spy).toBeDefined(); expect(qqq).toBeDefined(); expect(nv).toBeDefined();
    const snapshot:any = {
      latestQuoteSnapshotBySymbol: {
        ['SPY']: { price: 400, dataStatus: 'LIVE' },
        ['QQQ']: { price: 300, dataStatus: 'LIVE' },
        ['NVDA']: { price: 600, dataStatus: 'LIVE' },
      },
      latestDecisionIntelligenceBySymbol: {},
      latestSignalBuildDiagnosticsBySymbol: {},
      latestCycle: { decisionSummary: { analyzedSymbols: [] } },
    };
    const vm = buildMarketOverviewViewModel(snapshot as any);
    expect(vm.rows.find(r=> r.instrumentId === spy!.id)!.price).toBe(400);
    expect(vm.rows.find(r=> r.instrumentId === qqq!.id)!.price).toBe(300);
    // NVDA instrument id is 'nvidia' in registry
    expect(vm.rows.find(r=> r.instrumentId === nv!.id)!.price).toBe(600);
  });
});
