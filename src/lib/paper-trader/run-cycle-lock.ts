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

    if (!url || !token) return { status: 'UNAVAILABLE' };
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
    try {
      data = await res.json();
    } catch (e) {
      return { status: 'UNAVAILABLE' };
    }

    if (data && data.result === "OK") return { status: 'ACQUIRED', ownerToken: owner };
    if (data && data.result === null) return { status: 'DUPLICATE' };
    return { status: 'UNAVAILABLE' };
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
    if (!url || !token) return false;
    if (!keyId || !ownerToken) return false;

    const key = `atlas:paper-trader:run-cycle:${keyId}`;
    // Lua script: if get(KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
    const lua = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
    const body = ["EVAL", lua, 1, key, ownerToken];

    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res || !res.ok) return false;
    let data: any;
    try{ data = await res.json(); }catch(_){ return false; }
    // Upstash EVAL typically returns integer reply; treat 1 as deleted
    const result = data && (data.result !== undefined ? data.result : data);
    if (result === 1 || result === '1') return true;
    return false;
  }catch(_){ return false; }
}

export default acquireRunCycleLock;
