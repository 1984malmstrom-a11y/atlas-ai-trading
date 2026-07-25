export type RunCycleLockResult =
  | "ACQUIRED"
  | "DUPLICATE"
  | "UNAVAILABLE";

export async function acquireRunCycleLock(
  idempotencyKey: string,
  ttlSeconds = 900
): Promise<RunCycleLockResult> {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) return "UNAVAILABLE";
    if (!idempotencyKey || typeof idempotencyKey !== "string") return "UNAVAILABLE";
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return "UNAVAILABLE";

    const key = `atlas:paper-trader:run-cycle:${idempotencyKey}`;
    const body = [
      "SET",
      key,
      new Date().toISOString(),
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

    if (!res || !res.ok) return "UNAVAILABLE";

    let data: any;
    try {
      data = await res.json();
    } catch (e) {
      return "UNAVAILABLE";
    }

    if (data && data.result === "OK") return "ACQUIRED";
    if (data && data.result === null) return "DUPLICATE";
    return "UNAVAILABLE";
  } catch (e) {
    return "UNAVAILABLE";
  }
}

export default acquireRunCycleLock;
