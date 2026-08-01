export type RunCycleLockStatus = "ACQUIRED" | "DUPLICATE" | "UNAVAILABLE";

export type AcquireRunCycleResult =
  | { status: "ACQUIRED"; ownerToken: string }
  | { status: "DUPLICATE" }
  | { status: "UNAVAILABLE" };

function makeOwnerToken(){
  try{ if (typeof (global as any).crypto !== 'undefined' && typeof (global as any).crypto.randomUUID === 'function') return (global as any).crypto.randomUUID(); }catch(_){ }
  // fallback
  return `t_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
}

/**
 * New API: returns status and ownerToken when acquired.
 */
export async function acquireRunCycleLockWithOwner(
  idempotencyKey: string,
  ttlSeconds = 900
): Promise<AcquireRunCycleResult> {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    // If Upstash is configured, use it (unchanged behaviour)
    if (url && token){
      if (!idempotencyKey || typeof idempotencyKey !== 'string') return { status: 'UNAVAILABLE' };
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return { status: 'UNAVAILABLE' };
      const key = `atlas:paper-trader:run-cycle:${idempotencyKey}`;
      const owner = makeOwnerToken();
      const body = [
        "SET",
        key,
        owner,
        "NX",
        "EX",
        ttlSeconds,
      ];

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res || !res.ok) return { status: 'UNAVAILABLE' };

      let data: any;
      try { data = await res.json(); } catch (e) { return { status: 'UNAVAILABLE' }; }
      if (data && data.result === "OK") return { status: 'ACQUIRED', ownerToken: owner };
      if (data && data.result === null) return { status: 'DUPLICATE' };
      return { status: 'UNAVAILABLE' };
    }

    // Upstash not configured: consider a process-local fallback but only in safe dev/in_memory mode
    const allowLocalFallback = (process.env.PAPER_TRADER_SCHEDULER_MODE === 'in_memory') && (process.env.NODE_ENV !== 'production');
    if (!allowLocalFallback) return { status: 'UNAVAILABLE' };

    // Use process-local in-memory lock map. This ensures a single active run per process.
    if (!((global as any).__ATLAS_LOCAL_RUN_CYCLE_LOCKS__ && typeof (global as any).__ATLAS_LOCAL_RUN_CYCLE_LOCKS__ === 'object')){
      try{ (global as any).__ATLAS_LOCAL_RUN_CYCLE_LOCKS__ = {}; }catch(_){ /* ignore */ }
    }
    const store = (global as any).__ATLAS_LOCAL_RUN_CYCLE_LOCKS__ as Record<string, any>;
    if (!idempotencyKey || typeof idempotencyKey !== 'string') return { status: 'UNAVAILABLE' };
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return { status: 'UNAVAILABLE' };
    const owner = makeOwnerToken();
    const now = Date.now();
    const expiresAt = now + Math.floor(Number(ttlSeconds)) * 1000;
    const key = `atlas:paper-trader:run-cycle:${idempotencyKey}`;
    const existing = store[key];
    if (!existing || (existing && typeof existing.expiresAt === 'number' && existing.expiresAt <= now)){
      // acquire
      store[key] = { owner, expiresAt };
      return { status: 'ACQUIRED', ownerToken: owner };
    }
    // still held
    return { status: 'DUPLICATE' };
  } catch (e) {
    return { status: 'UNAVAILABLE' };
  }
}

/**
 * Backwards-compatible wrapper: returns simple status string as before.
 */
export async function acquireRunCycleLock(
  idempotencyKey: string,
  ttlSeconds = 900
): Promise<RunCycleLockStatus> {
  const r = await acquireRunCycleLockWithOwner(idempotencyKey, ttlSeconds);
  return r.status;
}

/**
 * Release the lock only if ownerToken matches. Uses atomic EVAL compare-and-delete.
 * Returns true when deleted, false when not deleted, or throws/returns false on errors.
 */
export async function releaseRunCycleLock(keyId: string, ownerToken: string): Promise<boolean> {
  try{
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token){
      if (!keyId || !ownerToken) return false;
      const key = `atlas:paper-trader:run-cycle:${keyId}`;
      const lua = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
      const body = ["EVAL", lua, 1, key, ownerToken];
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res || !res.ok) return false;
      let data: any; try{ data = await res.json(); }catch(_){ return false; }
      const result = data && (data.result !== undefined ? data.result : data);
      if (result === 1 || result === '1') return true;
      return false;
    }

    // Upstash not configured -> allow local fallback only in non-production in_memory mode
    const allowLocalFallback = (process.env.PAPER_TRADER_SCHEDULER_MODE === 'in_memory') && (process.env.NODE_ENV !== 'production');
    if (!allowLocalFallback) return false;
    if (!((global as any).__ATLAS_LOCAL_RUN_CYCLE_LOCKS__ && typeof (global as any).__ATLAS_LOCAL_RUN_CYCLE_LOCKS__ === 'object')) return false;
    const store = (global as any).__ATLAS_LOCAL_RUN_CYCLE_LOCKS__ as Record<string, any>;
    const fullKey = `atlas:paper-trader:run-cycle:${keyId}`;
    const existing = store[fullKey];
    if (!existing) return false;
    if (existing.owner && existing.owner === ownerToken){
      delete store[fullKey];
      return true;
    }
    // cannot release if owner mismatch
    return false;
  }catch(_){ return false; }
}

export default acquireRunCycleLock;
