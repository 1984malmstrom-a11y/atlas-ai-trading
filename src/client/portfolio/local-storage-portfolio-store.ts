export default function LocalStoragePortfolioStore(){
  const key = 'atlas:portfolio';
  function safeParse(v:string | null){
    if (!v) return null;
    try{ return JSON.parse(v); }catch(e){ return null; }
  }

  function isClient(){ return typeof window !== 'undefined' && typeof localStorage !== 'undefined'; }

  return {
    load(): any | null {
      if (!isClient()) return null;
      try{ const raw = localStorage.getItem(key); return safeParse(raw); }catch(e){ return null; }
    },
    save(snapshot:any){ if (!isClient()) return; try{ localStorage.setItem(key, JSON.stringify(snapshot)); }catch(e){} },
    updateHolding(symbol:string, patch:any){ if (!isClient()) return; try{ const cur = safeParse(localStorage.getItem(key)) || { holdings: [] }; const holdings = cur.holdings || []; const idx = holdings.findIndex((h:any)=> h.symbol===symbol); if (idx>=0){ holdings[idx] = { ...holdings[idx], ...patch }; } else { holdings.push({ symbol, ...patch }); } cur.holdings = holdings; localStorage.setItem(key, JSON.stringify(cur)); }catch(e){} },
    removeHolding(symbol:string){ if (!isClient()) return; try{ const cur = safeParse(localStorage.getItem(key)) || { holdings: [] }; cur.holdings = (cur.holdings || []).filter((h:any)=> h.symbol !== symbol); localStorage.setItem(key, JSON.stringify(cur)); }catch(e){} },
  };
}
