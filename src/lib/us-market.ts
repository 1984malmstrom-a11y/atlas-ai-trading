// Deterministic helpers for US market session (09:30-16:00 America/New_York)
// Exports functions used by UI and tests.

export type USMarketStatus = { open: true } | { open: false; nextOpenInstant: Date };

function getNYParts(d: Date) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  const parts = f.formatToParts(d).reduce((acc: any, p: Intl.DateTimeFormatPart) => { acc[p.type] = p.value; return acc; }, {} as Record<string,string>);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: String(parts.weekday),
  };
}

// Find the epoch (ms) for a given local wall-clock in America/New_York by searching nearby UTC range.
// This is deterministic and avoids making assumptions about DST offsets.
function epochForNYLocal(year:number, month:number, day:number, hour:number, minute:number){
  // Start with an initial UTC guess at the same Y-M-D H:M (will be wrong zone), then search +/- 12h
  const guessUtc = Date.UTC(year, month-1, day, hour, minute, 0);
  const windowMs = 24 * 60 * 60 * 1000; // search +/-24h to be safe
  const step = 60 * 1000; // 1 minute steps
  const start = guessUtc - windowMs/2;
  const end = guessUtc + windowMs/2;
  for (let t = start; t <= end; t += step){
    const parts = getNYParts(new Date(t));
    if (parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute){
      return new Date(t);
    }
  }
  return null;
}

export function getNextNYOpenInstant(nowInput?: string | Date): USMarketStatus {
  const now = nowInput ? new Date(nowInput) : new Date();
  const et = getNYParts(now);
  const minutesNow = et.hour * 60 + et.minute;
  const openM = 9*60 + 30;
  const closeM = 16*60;

  const isWeekday = !['Sat','Sun'].includes(et.weekday);
  if (isWeekday && minutesNow >= openM && minutesNow < closeM) return { open: true };

  // Find next weekday (Mon-Fri) where market opens. Iterate up to 14 days to be safe.
  for (let i = 0; i < 14; i++){
    const cand = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const p = getNYParts(cand);
    if (['Sat','Sun'].includes(p.weekday)) continue;
    // same day: only accept if open time is later than now in NY
    if (i === 0){
      const nowM = minutesNow;
      if (openM > nowM){
        const inst = epochForNYLocal(p.year, p.month, p.day, 9, 30);
        if (inst) return { open: false, nextOpenInstant: inst };
        continue;
      }
      // else already past open for today
      continue;
    }
    // future weekday -> return that day's 09:30 NY instant
    const inst = epochForNYLocal(p.year, p.month, p.day, 9, 30);
    if (inst) return { open: false, nextOpenInstant: inst };
  }
  // fallback: compute next day's 09:30 in NY using naive approach
  const fallback = new Date(now.getTime() + 2*24*60*60*1000);
  const p = getNYParts(fallback);
  const inst = epochForNYLocal(p.year, p.month, p.day, 9, 30) || new Date(Date.now() + 24*60*60*1000);
  return { open: false, nextOpenInstant: inst };
}

export function computeUSMarketStatus(nowInput?: string | Date){
  const s = getNextNYOpenInstant(nowInput);
  if (s.open) return 'Öppen';
  const next = s.nextOpenInstant;
  // Format in Stockholm local time
  const dayLabel = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', weekday: 'long' }).format(next);
  const refDate = nowInput ? new Date(nowInput) : new Date();
  const isToday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', day: '2-digit' }).format(refDate) === new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', day: '2-digit' }).format(next);
  const dayText = isToday ? 'idag' : dayLabel;
  const timeLabel = next.toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour12:false, hour: '2-digit', minute: '2-digit' });
  return `Öppnar ${dayText} ${timeLabel}`;
}
