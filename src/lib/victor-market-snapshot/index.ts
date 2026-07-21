type SnapshotStatus = 'EMPTY'|'REFRESHING'|'READY'|'STALE'|'ERROR';

const TTL_MS = 5 * 60 * 1000; // 5 minutes

let currentSnapshot: any = null;
let refreshedAt: number | null = null;
let refreshPromise: Promise<any> | null = null;
let lastError: string | null = null;

function sanitizeError(e:any){
  try{
    const s = typeof e === 'string' ? e : (e && e.message) ? e.message : JSON.stringify(e);
    // redact anything that looks like a key
    return s.replace(/([A-Za-z0-9_-]{20,})/g,'[REDACTED]');
  }catch(_){ return 'unknown error'; }
}

function nowMs(){ return Date.now(); }

function getStatus(): SnapshotStatus{
  if(!currentSnapshot) return 'EMPTY';
  if(refreshPromise) return 'REFRESHING';
  if(refreshedAt === null) return 'ERROR';
  if(nowMs() - (refreshedAt || 0) > TTL_MS) return 'STALE';
  return 'READY';
}

export async function refreshMarketSnapshot(buildSnapshot: ()=> Promise<any>){
  if(refreshPromise) return refreshPromise;
  refreshPromise = (async ()=>{
    try{
      const built = await buildSnapshot();
      // If the builder provides a generatedAt, keep it as-is when it's a string
      // (tests often use short identifiers). If it's a Date-like value, normalize
      // it to ISO. Otherwise use now.
      let gen: string;
      if(built && built.generatedAt){
        if(typeof built.generatedAt === 'string') gen = built.generatedAt;
        else gen = new Date(built.generatedAt).toISOString();
      }else{
        gen = new Date().toISOString();
      }
      const now = nowMs();
      refreshedAt = now;
      currentSnapshot = {
        data: built,
        generatedAt: gen,
        refreshedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TTL_MS).toISOString(),
        status: 'READY',
        error: null,
      };
      lastError = null;
      return currentSnapshot;
    }catch(err:any){
      lastError = sanitizeError(err);
      // do not erase currentSnapshot on failure
      const now = nowMs();
      const s = {
        data: currentSnapshot ? currentSnapshot.data : null,
        generatedAt: currentSnapshot ? currentSnapshot.generatedAt : null,
        refreshedAt: currentSnapshot ? currentSnapshot.refreshedAt : null,
        expiresAt: currentSnapshot ? currentSnapshot.expiresAt : null,
        status: 'ERROR',
        error: lastError,
      };
      // keep refreshPromise resolved to s
      return s;
    }finally{
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export function getMarketSnapshot(){
  return currentSnapshot;
}

export function getMarketSnapshotStatus(){
  return getStatus();
}

// Test helper to reset internal module state between tests.
export function resetMarketSnapshotForTests(){
  currentSnapshot = null;
  refreshedAt = null;
  refreshPromise = null;
  lastError = null;
}

export default { getMarketSnapshot, refreshMarketSnapshot, getMarketSnapshotStatus };
