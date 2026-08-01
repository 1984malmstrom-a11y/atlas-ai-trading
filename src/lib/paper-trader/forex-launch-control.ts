import { ForexReadinessState } from './forex-readiness';

export type ForexLaunchStatus = 'BLOCKED' | 'READY' | 'ARMED' | 'RUNNING';

export type ForexLaunchBlockingReason =
  | 'FOREX_SESSION_CLOSED'
  | 'FOREX_SESSION_INVALID'
  | 'NO_TRADING_ENABLED_PAIRS'
  | 'NO_FRESH_QUOTES'
  | 'CONVERSION_UNAVAILABLE'
  | 'NO_EXECUTION_READY_PAIRS'
  | 'AUTONOMOUS_TRADING_DISABLED'
  | 'SCHEDULER_DISABLED'
  | 'FOREX_AUTONOMY_NOT_ARMED'
  | 'DAILY_TRADE_LIMIT_REACHED'
  | 'DAILY_LOSS_LIMIT_REACHED'
  | 'CYCLE_LOCKED'
  | 'CYCLE_ALREADY_RUNNING'
  | 'RUNTIME_NOT_READY';

export type ForexLaunchControlState = {
  status: ForexLaunchStatus;
  checkedAt: string;
  sessionStatus: 'OPEN' | 'CLOSED' | 'INVALID_DATE';

  autonomousEnabled: boolean;
  schedulerEnabled: boolean;
  forexAutonomyArmed: boolean;
  cycleLocked: boolean;
  cycleRunning: boolean;

  tradingEnabledPairCount: number;
  quoteReadyCount: number;
  conversionReadyCount: number;
  executionReadyCount: number;

  tradesToday: number;
  maxTradesPerDay: number;
  dailyLossSek: number;
  dailyLossLimitSek: number;

  blockingReasons: ForexLaunchBlockingReason[];
  isSafeToStartCycle: boolean;
  isSafeToExecuteOrders: boolean;
};

export function buildForexLaunchControlState(opts: {
  now?: Date;
  forexReadiness?: ForexReadinessState | null;
  autonomousEnabled?: boolean;
  schedulerEnabled?: boolean;
  cycleLocked?: boolean;
  tradesToday?: number;
  maxTradesPerDay?: number;
  dailyLossSek?: number;
  dailyLossLimitSek?: number;
  isArmed?: boolean;
  cycleRunning?: boolean;
}): ForexLaunchControlState {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const fr = opts.forexReadiness || null;
  const autonomousEnabled = !!opts.autonomousEnabled;
  const schedulerEnabled = !!opts.schedulerEnabled;
  const cycleLocked = !!opts.cycleLocked;
  const tradesToday = typeof opts.tradesToday === 'number' ? opts.tradesToday : 0;
  const maxTradesPerDay = typeof opts.maxTradesPerDay === 'number' ? opts.maxTradesPerDay : 9999;
  const dailyLossSek = typeof opts.dailyLossSek === 'number' ? opts.dailyLossSek : 0;
  const dailyLossLimitSek = typeof opts.dailyLossLimitSek === 'number' ? opts.dailyLossLimitSek : Number.POSITIVE_INFINITY;
  const isArmed = !!opts.isArmed;
  const cycleRunning = !!opts.cycleRunning;

  const reasons: ForexLaunchBlockingReason[] = [];

  const session = fr ? fr.sessionStatus : 'INVALID_DATE';
  if (session === 'INVALID_DATE') reasons.push('FOREX_SESSION_INVALID');
  if (session === 'CLOSED') reasons.push('FOREX_SESSION_CLOSED');

  const tdp = fr ? fr.tradingEnabledPairCount : 0;
  if (tdp === 0) reasons.push('NO_TRADING_ENABLED_PAIRS');

  const quotesReady = fr ? fr.quoteReadyCount : 0;
  if (quotesReady === 0) reasons.push('NO_FRESH_QUOTES');

  const convReady = fr ? fr.conversionReadyCount : 0;
  if (convReady === 0) reasons.push('CONVERSION_UNAVAILABLE');

  const execReady = fr ? fr.executionReadyCount : 0;
  if (execReady === 0) reasons.push('NO_EXECUTION_READY_PAIRS');

  if (!autonomousEnabled) reasons.push('AUTONOMOUS_TRADING_DISABLED');
  if (!schedulerEnabled) reasons.push('SCHEDULER_DISABLED');
  if (cycleLocked) reasons.push('CYCLE_LOCKED');
  if (tradesToday >= maxTradesPerDay) reasons.push('DAILY_TRADE_LIMIT_REACHED');
  if (dailyLossSek >= dailyLossLimitSek) reasons.push('DAILY_LOSS_LIMIT_REACHED');

  // dedupe and stable order
  const deduped = Array.from(new Set(reasons));

  // If technical conditions are green but not armed, add not-armed as a blocker for automatic execution
  const technicalGreen = deduped.length === 0;
  if (technicalGreen && !isArmed) {
    // push into reasons and recompute deduped to ensure stable ordering
    reasons.push('FOREX_AUTONOMY_NOT_ARMED');
  }

  // recompute deduped once more after potential not-armed addition
  const finalDeduped = Array.from(new Set(reasons));

  // Determine status
  let status: ForexLaunchStatus = 'BLOCKED';
  if (finalDeduped.length === 0 && !isArmed) status = 'READY';
  if (finalDeduped.length === 0 && isArmed && !cycleRunning) status = 'ARMED';
  if (finalDeduped.length === 0 && isArmed && cycleRunning) status = 'RUNNING';

  const isSafeToStartCycle = status === 'ARMED';
  const isSafeToExecuteOrders = status === 'RUNNING' || status === 'ARMED';

  const out: ForexLaunchControlState = {
    status,
    checkedAt: now.toISOString(),
    sessionStatus: session as any,
    autonomousEnabled,
    schedulerEnabled,
    forexAutonomyArmed: isArmed,
    cycleLocked,
    cycleRunning,
    tradingEnabledPairCount: tdp,
    quoteReadyCount: quotesReady,
    conversionReadyCount: convReady,
    executionReadyCount: execReady,
    tradesToday,
    maxTradesPerDay,
    dailyLossSek,
    dailyLossLimitSek,
    blockingReasons: finalDeduped as ForexLaunchBlockingReason[],
    isSafeToStartCycle,
    isSafeToExecuteOrders,
  };

  return out;
}

export default { buildForexLaunchControlState };
