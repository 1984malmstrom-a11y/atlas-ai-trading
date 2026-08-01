import { AuditStore } from './types';

function toStockholmDateKey(d: Date){
  try{
    return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  }catch(_){
    const y = d.getUTCFullYear(); const m = String(d.getUTCMonth()+1).padStart(2,'0'); const day = String(d.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
}

export async function buildDailyTradingSummary(opts: { auditStore: AuditStore; now?: Date }): Promise<import('./types').DailyTradingSummary>{
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dateKey = toStockholmDateKey(now);
  const timezone = 'Europe/Stockholm' as const;
  let executedTradeCount = 0;
  let realizedPnL = 0;
  try{
    const all = Array.isArray(await opts.auditStore.list()) ? await opts.auditStore.list() : [];
    const seenExecIds = new Set<string>();
    for (const item of all){
      try{
        const raw = (item && (item as any).raw) ? (item as any).raw : item;
        if (!raw || raw.kind !== 'EXECUTION') continue;
        const ts = raw.timestamp ? new Date(raw.timestamp) : null;
        if (!ts || isNaN(ts.getTime())) continue;
        const key = toStockholmDateKey(ts);
        if (key !== dateKey) continue;
        const exec = raw.execution;
        if (!exec || !exec.id) continue;
        if (seenExecIds.has(exec.id)) continue;
        seenExecIds.add(exec.id);
        executedTradeCount++;
        // Try to compute realized PnL when portfolioBefore provides averagePrice
        try{
          const pfBefore = raw.portfolioBefore;
          if (pfBefore && Array.isArray(pfBefore.holdings) && exec && exec.side === 'SELL'){
            const sym = String(exec.symbol || '').toUpperCase();
            const found = pfBefore.holdings.find((h:any)=> String(h.symbol||'').toUpperCase() === sym);
            if (found && typeof found.averagePrice === 'number' && typeof exec.executedPrice === 'number' && typeof exec.quantity === 'number'){
              const fee = typeof exec.fee === 'number' ? exec.fee : 0;
              const pnl = (exec.executedPrice - Number(found.averagePrice)) * Number(exec.quantity) - fee;
              if (Number.isFinite(pnl)) realizedPnL += pnl;
            }
          }
        }catch(_){ }
      }catch(_){ continue; }
    }
  }catch(_){ }
  const realizedPnLSek = Math.round((Number(realizedPnL) || 0) * 100) / 100;
  const dailyLossSek = realizedPnLSek < 0 ? Math.abs(realizedPnLSek) : 0;
  return { dateKey, timezone, executedTradeCount, realizedPnLSek, dailyLossSek };
}

export default buildDailyTradingSummary;
