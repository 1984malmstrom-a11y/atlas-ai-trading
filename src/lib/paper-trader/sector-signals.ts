// Sector strength summaries and signals (conservative, local mapping)
import { TRADABLE_INSTRUMENTS } from '../market-data/instruments';

export type SectorDirection = 'BULLISH'|'BEARISH'|'NEUTRAL';

export type SectorStrengthSummary = {
  sector: string;
  instrumentCount: number;
  averageChangePercent: number;
  advancingCount: number;
  decliningCount: number;
  direction: SectorDirection;
  strength: number; // 0..1 conservative
  symbols?: string[];
};

export type SectorStrengthSignal = {
  id: string;
  type: 'SECTOR_STRENGTH';
  origin: 'SECTOR_QUOTES_AGGREGATE';
  direction: SectorDirection;
  strength: number;
  sector: string;
  symbols: string[];
  generatedAt: string;
  evidence: {
    instrumentCount: number;
    averageChangePercent: number;
    advancingCount: number;
    decliningCount: number;
  };
};

// Minimal internal mapping for current US development universe when instrument metadata lacks sector
const INTERNAL_SECTOR_MAP: Record<string,string> = {
  'MSFT': 'Technology',
  'AAPL': 'Technology',
  'NVDA': 'Technology',
  'AMZN': 'Consumer Discretionary',
  'GOOGL': 'Communication Services',
  'META': 'Communication Services',
  'TSLA': 'Consumer Discretionary',
  'AMD': 'Technology',
  'NFLX': 'Communication Services',
  'AVGO': 'Technology'
};

function normalizeSymbol(s: any){ try{ return String(s||'').toUpperCase(); }catch(_){ return ''; } }

// Build sector strength summaries from instruments/quotes array.
// instruments: array of objects with at least { symbol?, providerSymbol?, changePercent?, dataStatus?, isStale? }
export function buildSectorStrengthSummaries(instruments: any[] | undefined, generatedAt?: string): SectorStrengthSummary[] {
  if (!Array.isArray(instruments) || instruments.length === 0) return [];
  const bySector = new Map<string, { symbols: string[]; vals: number[]; adv: number; dec: number }>();
  for (const inst of instruments){
    try{
      if (!inst) continue;
      if (inst.dataStatus === 'UNAVAILABLE') continue;
      if (inst.isStale === true) continue;
      const cp = inst.changePercent;
      if (cp === null || cp === undefined) continue;
      const num = Number(cp);
      if (!Number.isFinite(num)) continue;
      const sym = normalizeSymbol(inst.symbol || inst.providerSymbol || inst.instrumentId || inst.id);
      if (!sym) continue;
      // Determine sector from instrument metadata first, then internal map
      const foundInstr = TRADABLE_INSTRUMENTS.find(i => (i.providerSymbol && String(i.providerSymbol).toUpperCase() === sym) || String(i.id).toUpperCase() === sym);
      const sector = (foundInstr && (foundInstr as any).sector) ? (foundInstr as any).sector : (INTERNAL_SECTOR_MAP[sym] || undefined);
      if (!sector) continue; // unknown sector -> omit
      const cur = bySector.get(sector) || { symbols: [], vals: [], adv: 0, dec: 0 };
      cur.symbols.push(sym);
      cur.vals.push(num);
      if (num > 0) cur.adv++; else if (num < 0) cur.dec++;
      bySector.set(sector, cur);
    }catch(_){ continue; }
  }
  const res: SectorStrengthSummary[] = [];
  for (const [sector, v] of bySector.entries()){
    const count = v.vals.length;
    if (count < 2) continue; // require at least 2 valid instruments
    const avg = v.vals.reduce((s,n)=> s + n, 0) / count;
    // Direction rules
    let direction: SectorDirection = 'NEUTRAL';
    if (avg >= 0.75) direction = 'BULLISH';
    else if (avg <= -0.75) direction = 'BEARISH';
    // Strength: conservative composite of abs(avg) and participation
    const participation = Math.max(0, Math.min(1, (v.adv + v.dec) / Math.max(1, count)));
    const absAvg = Math.min(10, Math.abs(avg)) / 10; // scale assuming percents could be >1
    const raw = Math.min(1, (absAvg * 0.6) + (participation * 0.4));
    const strength = Math.max(0, Math.min(1, raw));
    res.push({ sector, instrumentCount: count, averageChangePercent: Number(Number(avg).toFixed(2)), advancingCount: v.adv, decliningCount: v.dec, direction, strength, symbols: v.symbols });
  }
  return res;
}

export function createSectorStrengthSignalForInstrument(instrument: any, summaries: SectorStrengthSummary[] | undefined, generatedAt?: string): SectorStrengthSignal | undefined {
  try{
    if (!instrument || !Array.isArray(summaries) || summaries.length === 0) return undefined;
    const sym = normalizeSymbol(instrument.symbol || instrument.providerSymbol || instrument.instrumentId || instrument.id);
    if (!sym) return undefined;
    // Find sector from TRADABLE_INSTRUMENTS or internal map
    const foundInstr = TRADABLE_INSTRUMENTS.find(i => (i.providerSymbol && String(i.providerSymbol).toUpperCase() === sym) || String(i.id).toUpperCase() === sym);
    const sector = (foundInstr && (foundInstr as any).sector) ? (foundInstr as any).sector : (INTERNAL_SECTOR_MAP[sym] || undefined);
    if (!sector) return undefined;
    const sum = summaries.find(s => s.sector === sector);
    if (!sum) return undefined;
    // require at least 2 instruments in summary (already enforced when building)
    if (sum.instrumentCount < 2) return undefined;
    const id = `sector_strength_${String(sector||'').toLowerCase().replace(/[^a-z0-9]+/g,'_')}`;
    const now = generatedAt || new Date().toISOString();
    const sig: SectorStrengthSignal = {
      id,
      type: 'SECTOR_STRENGTH',
      origin: 'SECTOR_QUOTES_AGGREGATE',
      direction: sum.direction,
      strength: Number(Number(sum.strength).toFixed(2)),
      sector: sum.sector,
      symbols: Array.isArray(sum && (sum as any).symbols) ? (sum as any).symbols : [],
      generatedAt: now,
      evidence: { instrumentCount: sum.instrumentCount, averageChangePercent: sum.averageChangePercent, advancingCount: sum.advancingCount, decliningCount: sum.decliningCount }
    };
    return sig;
  }catch(_){ return undefined; }
}

export default { buildSectorStrengthSummaries, createSectorStrengthSignalForInstrument };
