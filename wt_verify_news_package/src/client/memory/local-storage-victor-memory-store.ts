import storage from '../../lib/local-storage';
import type { VictorMemory, VictorMemoryStore } from '../../domain/memory/victor-memory-engine';

// Client-only localStorage-backed store. SSR-safe by guarding window.
export const LocalStorageVictorMemoryStore = (): VictorMemoryStore => {
  function isClient(){ return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'; }

  async function load(userId?: string){
    try{
      if (!isClient()) return null;
      const v = storage.loadVictorMemory();
      return v as VictorMemory | null;
    }catch(e){ return null; }
  }
  async function save(mem: VictorMemory){
    try{ if (!isClient()) return; storage.saveVictorMemory(mem); }catch(e){}
  }
  async function clear(){ try{ if (!isClient()) return; storage.saveVictorMemory(null); }catch(e){} }
  return { load, save, clear };
};

export default LocalStorageVictorMemoryStore;
