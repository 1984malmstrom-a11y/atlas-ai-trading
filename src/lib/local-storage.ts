// Minimal localStorage helpers for Atlas demo data
const PORTFOLIO_KEY = 'atlas:portfolio';
const TRADES_KEY = 'atlas:executedTrades';
const LASTRUN_KEY = 'atlas:lastRun';
const PREV_RUN_KEY = 'atlas:prevLastRun';
const DECISION_STATUS_KEY = 'atlas:decisionStatuses';
const VICTOR_MEMORY_KEY = 'atlas:victorMemory';
const INVESTOR_PROFILE_KEY = 'atlas:investorProfile';

export function loadPortfolio(){
  try{
    const v = localStorage.getItem(PORTFOLIO_KEY);
    return v ? JSON.parse(v) : null;
  }catch(e){ return null; }
}

export function savePortfolio(portfolio: any){
  try{ localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(portfolio)); }catch(e){}
}

export function loadExecutedTrades(){
  try{ const v = localStorage.getItem(TRADES_KEY); return v ? JSON.parse(v) : null; }catch(e){ return null; }
}

export function saveExecutedTrades(trades: any[]){
  try{ localStorage.setItem(TRADES_KEY, JSON.stringify(trades)); }catch(e){}
}

export function loadLastRun(){
  try{ const v = localStorage.getItem(LASTRUN_KEY); return v ? JSON.parse(v) : null; }catch(e){ return null; }
}

export function saveLastRun(obj: any){
  try{ localStorage.setItem(LASTRUN_KEY, JSON.stringify(obj)); }catch(e){}
}

export function loadPrevLastRun(){
  try{ const v = localStorage.getItem(PREV_RUN_KEY); return v ? JSON.parse(v) : null; }catch(e){ return null; }
}

export function savePrevLastRun(obj: any){
  try{ localStorage.setItem(PREV_RUN_KEY, JSON.stringify(obj)); }catch(e){}
}

export function clearPrevLastRun(){
  try{ localStorage.removeItem(PREV_RUN_KEY); }catch(e){}
}

export function loadDecisionStatuses(){
  try{ const v = localStorage.getItem(DECISION_STATUS_KEY); return v ? JSON.parse(v) : {}; }catch(e){ return {}; }
}

export function saveDecisionStatuses(obj: any){
  try{ localStorage.setItem(DECISION_STATUS_KEY, JSON.stringify(obj)); }catch(e){}
}

export function loadVictorMemory(){
  try{ const v = localStorage.getItem(VICTOR_MEMORY_KEY); return v ? JSON.parse(v) : null; }catch(e){ return null; }
}

export function saveVictorMemory(obj: any){
  try{ localStorage.setItem(VICTOR_MEMORY_KEY, JSON.stringify(obj)); }catch(e){}
}

export function loadInvestorProfile(){
  try{ const v = localStorage.getItem(INVESTOR_PROFILE_KEY); return v ? JSON.parse(v) : null; }catch(e){ return null; }
}

export function saveInvestorProfile(obj: any){
  try{ localStorage.setItem(INVESTOR_PROFILE_KEY, JSON.stringify(obj)); }catch(e){}
}

export function clearAll(){
  try{ localStorage.removeItem(PORTFOLIO_KEY); localStorage.removeItem(TRADES_KEY); localStorage.removeItem(LASTRUN_KEY); localStorage.removeItem(PREV_RUN_KEY);}catch(e){}
}

const storage = { loadPortfolio, savePortfolio, loadExecutedTrades, saveExecutedTrades, loadLastRun, saveLastRun, loadPrevLastRun, savePrevLastRun, clearPrevLastRun, loadDecisionStatuses, saveDecisionStatuses, loadInvestorProfile, saveInvestorProfile, loadVictorMemory, saveVictorMemory, clearAll };
export default storage;
