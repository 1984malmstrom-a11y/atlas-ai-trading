import { describe, it, expect } from 'vitest';
import { classifyQuoteStatus } from './route';

// Helper to build ISO dates in America/New_York by constructing via UTC offset
function nyDateISO(y:number,m:number,d:number,h:number,min:number){
  // construct a date in NY by using locale formatting to get the corresponding UTC instant
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(Date.UTC(y,m-1,d,h,min,0)));
  // fallback: construct direct UTC date
  return new Date(Date.UTC(y,m-1,d,h,min,0)).toISOString();
}

describe('classifyQuoteStatus — US market weekend/close cases', () => {
  const STALE = 'STALE';
  const DELAYED = 'DELAYED';
  const LIVE = 'LIVE';
  const UNAVAILABLE = 'UNAVAILABLE';

  it('Friday after close + Friday close -> DELAYED', () => {
    const fridayClose = '2026-07-17T20:00:00.000Z'; // example close instant
    const now = '2026-07-18T12:00:00.000Z'; // Saturday
    const res = classifyQuoteStatus({ currentTime: now, marketTimestamp: fridayClose, hasValidPrice: true, provider: { is_market_open: false } });
    expect(res.dataStatus).toBe(DELAYED);
    expect(res.isStale).toBe(false);
  });

  it('Saturday + Friday close -> DELAYED', () => {
    const fridayClose = '2026-07-17T20:00:00.000Z';
    const now = '2026-07-18T15:00:00.000Z';
    const res = classifyQuoteStatus({ currentTime: now, marketTimestamp: fridayClose, hasValidPrice: true });
    expect(res.dataStatus).toBe(DELAYED);
    expect(res.isStale).toBe(false);
  });

  it('Sunday + Friday close -> DELAYED', () => {
    const fridayClose = '2026-07-17T20:00:00.000Z';
    const now = '2026-07-19T10:00:00.000Z';
    const res = classifyQuoteStatus({ currentTime: now, marketTimestamp: fridayClose, hasValidPrice: true });
    expect(res.dataStatus).toBe(DELAYED);
    expect(res.isStale).toBe(false);
  });

  it('Monday before 09:30 NY + Friday close -> DELAYED', () => {
    const fridayClose = '2026-07-17T20:00:00.000Z';
    const now = '2026-07-20T12:00:00.000Z'; // Monday before NY open
    const res = classifyQuoteStatus({ currentTime: now, marketTimestamp: fridayClose, hasValidPrice: true });
    expect(res.dataStatus).toBe(DELAYED);
    expect(res.isStale).toBe(false);
  });

  it('Monday during active trading + old Friday data -> STALE', () => {
    const fridayClose = '2026-07-17T20:00:00.000Z';
    const now = '2026-07-20T15:00:00.000Z'; // Monday during trading
    const res = classifyQuoteStatus({ currentTime: now, marketTimestamp: fridayClose, hasValidPrice: true, provider: { is_market_open: true } });
    // During open, old friday timestamp should be considered stale
    expect(res.dataStatus).toBe(STALE);
    expect(res.isStale).toBe(true);
  });

  it('Active trading + fresh data within threshold -> LIVE', () => {
    const now = new Date().toISOString();
    const recent = new Date(Date.now() - 30_000).toISOString();
    const res = classifyQuoteStatus({ currentTime: now, marketTimestamp: recent, hasValidPrice: true, provider: { is_market_open: true } });
    expect(res.dataStatus).toBe(LIVE);
    expect(res.isStale).toBe(false);
  });

  it('Missing valid price -> UNAVAILABLE', () => {
    const now = new Date().toISOString();
    const recent = new Date().toISOString();
    const res = classifyQuoteStatus({ currentTime: now, marketTimestamp: recent, hasValidPrice: false });
    expect(res.dataStatus).toBe(UNAVAILABLE);
  });

  it('Invalid timestamp -> STALE or UNAVAILABLE', () => {
    const now = new Date().toISOString();
    const invalidTs:any = 'not-a-date';
    const res = classifyQuoteStatus({ currentTime: now, marketTimestamp: invalidTs, hasValidPrice: true });
    // invalid timestamp treated as old -> STALE
    expect(['STALE','UNAVAILABLE']).toContain(res.dataStatus);
  });
});
