// Types
export type RecommendationMemory = {
  id: string;
  symbol: string;
  recommendation: string;
  overallScore: number;
  confidence: number;
  reasoningSummary?: string;
  createdAt: string;
  outcomeStatus: 'Pending'|'Correct'|'Incorrect'|'Neutral';
  outcomeNote?: string;
  evaluatedAt?: string | null;
};

export type VictorMemory = {
  userId?: string;
  analyzedSymbols: { symbol: string; count: number }[];
  frequentlyViewedSymbols: string[];
  preferredSectors: string[];
  avoidedSectors: string[];
  averageRiskPreference?: number;
  recommendationHistory: RecommendationMemory[];
  decisionAccuracy: { total: number; correct: number; incorrect: number };
  recurringPatterns: string[];
  lastUpdatedAt?: string;
};

export type VictorMemoryContext = {
  symbolAnalysisCount?: number;
  previousRecommendation?: string | null;
  previousOverallScore?: number | null;
  previousConfidence?: number | null;
  scoreChange?: number | null;
  recommendationChanged?: boolean;
  knownUserPatterns?: string[];
  relevantPastOutcomes?: { id: string; outcomeStatus: string; createdAt: string }[];
  memorySummary?: string;
};

// Store interface
export type VictorMemoryStore = {
  load: (userId?: string)=> Promise<VictorMemory | null>;
  save: (mem: VictorMemory)=> Promise<void>;
  clear: ()=> Promise<void>;
};

// LocalStorage-based store (client-only)
// LocalStorage store moved to client-only file: src/client/memory/local-storage-victor-memory-store.ts

// Engine functions (pure, defensive)
export function createEmptyMemory(userId?: string): VictorMemory{
  return {
    userId,
    analyzedSymbols: [],
    frequentlyViewedSymbols: [],
    preferredSectors: [],
    avoidedSectors: [],
    averageRiskPreference: undefined,
    recommendationHistory: [],
    decisionAccuracy: { total: 0, correct: 0, incorrect: 0 },
    recurringPatterns: [],
    lastUpdatedAt: new Date().toISOString(),
  };
}

function ensure(mem?: VictorMemory | null): VictorMemory{
  if (mem && typeof mem === 'object'){
    const base = createEmptyMemory();
    const merged: VictorMemory = { ...base, ...mem };
    if (!Array.isArray(merged.recommendationHistory)) merged.recommendationHistory = [];
    return merged;
  }
  return createEmptyMemory();
}

export function addAnalysis(mem: VictorMemory | null, symbol: string, rec?: Partial<RecommendationMemory>, maxHistory=200): VictorMemory{
  const m = ensure(mem);
  const now = new Date().toISOString();
  // update analyzedSymbols count
  const idx = m.analyzedSymbols.findIndex(s=> s.symbol === symbol);
  if (idx === -1) m.analyzedSymbols.push({ symbol, count: 1 }); else m.analyzedSymbols[idx].count += 1;
  // create recommendation entry if provided
  if (rec){
    const id = rec.id || `rm-${Date.now()}-${Math.floor(Math.random()*10000)}`;
    let outcomeStatus: RecommendationMemory['outcomeStatus'] = 'Pending';
    if (rec.outcomeStatus === 'Correct' || rec.outcomeStatus === 'Incorrect' || rec.outcomeStatus === 'Neutral' || rec.outcomeStatus === 'Pending') outcomeStatus = rec.outcomeStatus as RecommendationMemory['outcomeStatus'];

    const entry: RecommendationMemory = {
      id,
      symbol,
      recommendation: rec.recommendation || String(rec.recommendation || 'Unknown'),
      overallScore: rec.overallScore || 0,
      confidence: rec.confidence || 0,
      reasoningSummary: rec.reasoningSummary || '',
      createdAt: rec.createdAt || now,
      outcomeStatus,
      outcomeNote: rec.outcomeNote,
      evaluatedAt: rec.evaluatedAt || null,
    };
    m.recommendationHistory.unshift(entry);
  }
  // trim history
  if (m.recommendationHistory.length > maxHistory) m.recommendationHistory.length = maxHistory;
  m.lastUpdatedAt = now;
  return m;
}

export function updateFrequentSymbols(mem: VictorMemory, topN=5){
  const m = ensure(mem);
  const sorted = m.analyzedSymbols.slice().sort((a,b)=> b.count - a.count).map(s=> s.symbol).slice(0, topN);
  m.frequentlyViewedSymbols = sorted;
  m.lastUpdatedAt = new Date().toISOString();
  return m;
}

export function saveRecommendation(mem: VictorMemory | null, rec: RecommendationMemory, maxHistory=200){
  const m = ensure(mem);
  m.recommendationHistory.unshift(rec);
  if (m.recommendationHistory.length > maxHistory) m.recommendationHistory.length = maxHistory;
  m.lastUpdatedAt = new Date().toISOString();
  return m;
}

export function readMemoryContext(mem: VictorMemory | null, symbol: string): VictorMemoryContext{
  const m = ensure(mem);
  const symbolEntry = m.analyzedSymbols.find(s=> s.symbol === symbol);
  const historyForSymbol = m.recommendationHistory.filter(r=> r.symbol === symbol);
  const previous = historyForSymbol[0] || null;
  const prevScore = previous ? previous.overallScore : null;
  const prevConfidence = previous ? previous.confidence : null;
  const count = symbolEntry ? symbolEntry.count : 0;
  const relevantPastOutcomes = historyForSymbol.slice(0,5).map(h=> ({ id: h.id, outcomeStatus: h.outcomeStatus, createdAt: h.createdAt }));
  const summary = `Analysed ${count} times; last: ${previous ? previous.recommendation : 'none'}`;
  return {
    symbolAnalysisCount: count,
    previousRecommendation: previous ? previous.recommendation : null,
    previousOverallScore: prevScore,
    previousConfidence: prevConfidence,
    scoreChange: null,
    recommendationChanged: false,
    knownUserPatterns: m.recurringPatterns || [],
    relevantPastOutcomes,
    memorySummary: summary,
  };
}

export function markOutcome(mem: VictorMemory | null, recommendationId: string, status: 'Correct'|'Incorrect'|'Neutral', note?: string){
  const m = ensure(mem);
  const rec = m.recommendationHistory.find(r=> r.id === recommendationId);
  if (!rec) return m;
  rec.outcomeStatus = status;
  rec.outcomeNote = note;
  rec.evaluatedAt = new Date().toISOString();
  // update accuracy counters
  m.decisionAccuracy.total = (m.decisionAccuracy.total||0) + 1;
  if (status === 'Correct') m.decisionAccuracy.correct = (m.decisionAccuracy.correct||0) + 1;
  if (status === 'Incorrect') m.decisionAccuracy.incorrect = (m.decisionAccuracy.incorrect||0) + 1;
  m.lastUpdatedAt = new Date().toISOString();
  return m;
}

export function calculateAccuracy(mem: VictorMemory | null){
  const m = ensure(mem);
  const total = m.decisionAccuracy.total || 0;
  const correct = m.decisionAccuracy.correct || 0;
  if (total === 0) return null;
  return Math.round((correct / total) * 100);
}

const engine = {
  createEmptyMemory,
  addAnalysis,
  updateFrequentSymbols,
  saveRecommendation,
  readMemoryContext,
  markOutcome,
  calculateAccuracy,
};

export default engine;
