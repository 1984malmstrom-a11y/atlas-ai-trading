import { ForexReadinessState } from './forex-readiness';
import { ForexLaunchControlState } from './forex-launch-control';

export type ChecklistItem = { id: string; label: string; status: 'PASS' | 'FAIL' | 'WARNING'; reason?: string };

export function buildForexLaunchChecklist(opts: { readiness?: ForexReadinessState | null; launchControl?: ForexLaunchControlState | null; tradesToday?: number; maxTradesPerDay?: number; dailyLossSek?: number; dailyLossLimitSek?: number; runtimeInitialized?: boolean; previousCycleHealthy?: boolean }): { ready: boolean; items: ChecklistItem[] }{
  const r = opts.readiness || null;
  const lc = opts.launchControl || null;
  const tradesToday = typeof opts.tradesToday === 'number' ? opts.tradesToday : 0;
  const maxTradesPerDay = typeof opts.maxTradesPerDay === 'number' ? opts.maxTradesPerDay : 9999;
  const dailyLossSek = typeof opts.dailyLossSek === 'number' ? opts.dailyLossSek : 0;
  const dailyLossLimitSek = typeof opts.dailyLossLimitSek === 'number' ? opts.dailyLossLimitSek : Number.POSITIVE_INFINITY;
  const runtimeInitialized = !!opts.runtimeInitialized;
  const previousCycleHealthy = opts.previousCycleHealthy === undefined ? true : !!opts.previousCycleHealthy;

  const items: ChecklistItem[] = [];
  // 1 SESSION_OPEN
  const sessionOpen = lc ? lc.sessionStatus === 'OPEN' : (r ? r.sessionStatus === 'OPEN' : false);
  items.push({ id: 'SESSION_OPEN', label: 'Session Open', status: sessionOpen ? 'PASS' : 'FAIL', reason: sessionOpen ? undefined : 'FOREX_SESSION_CLOSED_OR_INVALID' });
  // 2 START_PAIRS_CONFIGURED
  const startPairs = lc ? lc.tradingEnabledPairCount : (r ? r.tradingEnabledPairCount : 0);
  items.push({ id: 'START_PAIRS_CONFIGURED', label: 'Start Pairs Configured', status: startPairs > 0 ? 'PASS' : 'FAIL', reason: startPairs > 0 ? undefined : 'NO_TRADING_ENABLED_PAIRS' });
  // 3 EXECUTION_READY_PAIR
  const execReady = lc ? lc.executionReadyCount : (r ? r.executionReadyCount : 0);
  items.push({ id: 'EXECUTION_READY_PAIR', label: 'Execution Ready Pair', status: execReady > 0 ? 'PASS' : 'FAIL', reason: execReady > 0 ? undefined : 'NO_EXECUTION_READY_PAIRS' });
  // 4 CONVERSION_READY
  const convReady = lc ? lc.conversionReadyCount : (r ? r.conversionReadyCount : 0);
  items.push({ id: 'CONVERSION_READY', label: 'Conversion Ready', status: convReady > 0 ? 'PASS' : 'FAIL', reason: convReady > 0 ? undefined : 'CONVERSION_UNAVAILABLE' });
  // 5 FRESH_QUOTES
  const quoteReady = lc ? lc.quoteReadyCount : (r ? r.quoteReadyCount : 0);
  items.push({ id: 'FRESH_QUOTES', label: 'Fresh Quotes', status: quoteReady > 0 ? 'PASS' : 'FAIL', reason: quoteReady > 0 ? undefined : 'NO_FRESH_QUOTES' });
  // 6 NOTIONAL_MODEL
  const notionalModel = r ? r.notionalModel : 'UNAVAILABLE';
  items.push({ id: 'NOTIONAL_MODEL', label: 'Notional Model Verified', status: notionalModel === 'VERIFIED_CONVERSION' ? 'PASS' : 'FAIL', reason: notionalModel === 'VERIFIED_CONVERSION' ? undefined : 'NOTIONAL_MODEL_INCOMPLETE' });
  // 7 AUTONOMOUS_ENABLED
  const autoEnabled = lc ? lc.autonomousEnabled : false;
  items.push({ id: 'AUTONOMOUS_ENABLED', label: 'Autonomous Enabled', status: autoEnabled ? 'PASS' : 'FAIL', reason: autoEnabled ? undefined : 'AUTONOMOUS_TRADING_DISABLED' });
  // 8 SCHEDULER_ENABLED
  const schedulerEnabled = lc ? lc.schedulerEnabled : false;
  items.push({ id: 'SCHEDULER_ENABLED', label: 'Scheduler Enabled', status: schedulerEnabled ? 'PASS' : 'FAIL', reason: schedulerEnabled ? undefined : 'SCHEDULER_DISABLED' });
  // 9 FOREX_ARMED
  const armed = lc ? lc.forexAutonomyArmed : false;
  items.push({ id: 'FOREX_ARMED', label: 'Forex Armed', status: armed ? 'PASS' : 'FAIL', reason: armed ? undefined : 'FOREX_AUTONOMY_NOT_ARMED' });
  // 10 CYCLE_UNLOCKED
  const cycleUnlocked = lc ? !lc.cycleLocked : true;
  items.push({ id: 'CYCLE_UNLOCKED', label: 'Cycle Unlocked', status: cycleUnlocked ? 'PASS' : 'FAIL', reason: cycleUnlocked ? undefined : 'CYCLE_LOCKED' });
  // 11 DAILY_TRADE_LIMIT
  const dailyTradeOk = tradesToday < maxTradesPerDay;
  items.push({ id: 'DAILY_TRADE_LIMIT', label: 'Daily Trade Limit', status: dailyTradeOk ? 'PASS' : 'FAIL', reason: dailyTradeOk ? undefined : 'DAILY_TRADE_LIMIT_REACHED' });
  // 12 DAILY_LOSS_LIMIT
  const dailyLossOk = dailyLossSek < dailyLossLimitSek;
  items.push({ id: 'DAILY_LOSS_LIMIT', label: 'Daily Loss Limit', status: dailyLossOk ? 'PASS' : 'FAIL', reason: dailyLossOk ? undefined : 'DAILY_LOSS_LIMIT_REACHED' });
  // 13 RUNTIME_INITIALIZED
  items.push({ id: 'RUNTIME_INITIALIZED', label: 'Runtime Initialized', status: runtimeInitialized ? 'PASS' : 'FAIL', reason: runtimeInitialized ? undefined : 'RUNTIME_NOT_READY' });
  // 14 PREVIOUS_CYCLE_HEALTHY
  items.push({ id: 'PREVIOUS_CYCLE_HEALTHY', label: 'Previous Cycle Healthy', status: previousCycleHealthy ? 'PASS' : 'WARNING', reason: previousCycleHealthy ? undefined : 'PREVIOUS_CYCLE_ISSUES' });

  // overall ready: no FAIL entries
  const ready = items.every(i => i.status !== 'FAIL');
  return { ready, items };
}

export default { buildForexLaunchChecklist };
