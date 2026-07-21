"use client";
import React, { useEffect, useState } from 'react';
import ls from '../../lib/local-storage';

export default function InvestorProfilePanel(){
  const [profile, setProfile] = useState<any>({ experience: 'Nybörjare', risk: 'Medel', horizon: '5 år', favorites: '', avoid: '' });

  useEffect(()=>{
    try{ const p = ls.loadInvestorProfile ? ls.loadInvestorProfile() : null; if (p) setTimeout(()=> setProfile(p), 0); }catch(e){}
  }, []);

  function save(){
    try{ ls.saveInvestorProfile && ls.saveInvestorProfile(profile); }catch(e){}
  }

  return (
    <section className="panel p-4">
      <h3 className="font-semibold">Profiler</h3>
      <div className="mt-2 space-y-2 text-sm">
        <div>
          <label className="block text-xs text-gray-500">Erfarenhetsnivå</label>
          <select className="mt-1 w-full p-2 border rounded" value={profile.experience} onChange={(e)=> setProfile({...profile, experience: e.target.value})}>
            <option>Nybörjare</option>
            <option>Van</option>
            <option>Avancerad</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500">Risknivå</label>
          <select className="mt-1 w-full p-2 border rounded" value={profile.risk} onChange={(e)=> setProfile({...profile, risk: e.target.value})}>
            <option>Låg</option>
            <option>Medel</option>
            <option>Hög</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500">Investeringshorisont</label>
          <input className="mt-1 w-full p-2 border rounded" value={profile.horizon} onChange={(e)=> setProfile({...profile, horizon: e.target.value})} />
        </div>

        <div>
          <label className="block text-xs text-gray-500">Favoritbranscher (komma-separerat)</label>
          <input className="mt-1 w-full p-2 border rounded" value={profile.favorites} onChange={(e)=> setProfile({...profile, favorites: e.target.value})} />
        </div>

        <div>
          <label className="block text-xs text-gray-500">Branscher att undvika (komma)</label>
          <input className="mt-1 w-full p-2 border rounded" value={profile.avoid} onChange={(e)=> setProfile({...profile, avoid: e.target.value})} />
        </div>

        <div className="flex justify-end">
          <button className="btn bg-blue-600 text-white px-3 py-1 rounded" onClick={save}>Spara profil</button>
        </div>
      </div>
    </section>
  );
}
