"use client";
import React from 'react';
import LeftSidebar from '../../components/dashboard-v1/LeftSidebar';

export default function Page(){
  const activities = [
    { txt: 'Läste Teslas rapport', t: '08:31', kind: 'done' },
    { txt: 'Bearbetade Bloomberg News', t: '08:29', kind: 'done' },
    { txt: 'Identifierade köpsignal NVIDIA', t: '08:28', kind: 'done' },
    { txt: 'Analyserar NVIDIA:s rapport', t: '08:18', kind: 'active' },
    { txt: 'Bearbetar makrodata och räntesignal', t: '08:15', kind: 'pending' },
    { txt: 'Uppdaterade portföljens riskbild', t: '08:12', kind: 'done' },
  ];

  const queue = ['Microsoft: kvartalsanalys', 'NVIDIA: kvartalsrapport', 'Tesla: årsredovisning'];

  return (
    <>
      <LeftSidebar />
      <div style={{ marginLeft: 240 }} className="min-h-[80vh] bg-[#F9F6F1] p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-2xl font-bold">Victors Analyscentral</h1>
              <p className="mt-1 text-sm text-gray-700 max-w-2xl">Kontrollrum för Victors AI‑motor — visar aktuell aktivitet, produktion och systemstatus.</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Victor arbetar nu */}
            <div className="bg-white rounded-xl p-4 shadow-sm border col-span-1 lg:col-span-1">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, background: '#34D399', borderRadius: 9999, display: 'inline-block' }} />
                <div className="text-sm font-semibold">Victor arbetar</div>
              </div>

              <div className="mt-4">
                <div className="text-xs text-gray-500 font-semibold">Just nu</div>
                <div className="mt-2 text-base font-semibold text-gray-900">Analyserar NVIDIA:s kvartalsrapport.</div>
                <div className="mt-1 text-sm text-gray-600">Hämtar data, modellerar tillväxt och risk.</div>
              </div>

              <div style={{ height: 1, background: 'rgba(15,23,42,0.04)', margin: '12px 0' }} />

              <div>
                <div className="text-xs text-gray-500 font-semibold">Senaste aktiviteter</div>
                <div className="mt-3 space-y-2">
                  {activities.slice(0,6).map((a,i)=> (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {a.kind === 'done' ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#10B981" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        ) : a.kind === 'active' ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2v6" stroke="#2563EB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="#2563EB" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="5" fill="#FBBF24"/></svg>
                        )}
                        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.85)' }}>{a.txt}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>{a.t}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ height: 1, background: 'rgba(15,23,42,0.04)', margin: '12px 0' }} />

              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.85)' }}>Nästa bevakning</div>
                <div className="mt-2 text-sm text-gray-700">Federal Reserve-uttalande — 14:30</div>
              </div>

              <div className="mt-3 text-xs text-gray-500">Senast uppdaterad 08:30</div>
            </div>

            {/* Middle: Dagens produktion */}
            <div className="bg-white rounded-xl p-4 shadow-sm border col-span-1 lg:col-span-1">
              <div className="text-sm font-semibold">Dagens produktion</div>
              <div className="mt-3 grid grid-cols-2 gap-4 text-sm text-gray-700">
                <div>Nyheter analyserade</div><div className="font-semibold text-gray-900">128</div>
                <div>Rapporter lästa</div><div className="font-semibold text-gray-900">14</div>
                <div>SEC-filings</div><div className="font-semibold text-gray-900">2</div>
                <div>Dokument analyserade</div><div className="font-semibold text-gray-900">6</div>
                <div>Bolag analyserade</div><div className="font-semibold text-gray-900">12</div>
                <div>Köpsignaler</div><div className="font-semibold text-gray-900">2</div>
                <div>Sell-signaler</div><div className="font-semibold text-gray-900">0</div>
                <div>Pågående analyser</div><div className="font-semibold text-gray-900">3</div>
              </div>
            </div>

            {/* Right: Systemstatus & kö */}
            <div className="col-span-1 lg:col-span-1 space-y-4">
              <div className="bg-white rounded-xl p-4 shadow-sm border">
                <div className="text-sm font-semibold">Aktivitetslogg</div>
                <div className="mt-3 text-sm text-gray-800 space-y-2">
                  {activities.slice(0,10).map((a,i)=> (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ color: 'rgba(0,0,0,0.8)' }}>{a.t} {a.txt}</div>
                      <div style={{ color: 'rgba(0,0,0,0.5)' }}>{a.t}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm border">
                <div className="text-sm font-semibold">Analyskö</div>
                <div className="mt-3 text-sm text-gray-800">
                  {queue.map((q,i)=> (<div key={i} className="py-1">• {q}</div>))}
                </div>
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm border">
                <div className="text-sm font-semibold">Systemstatus</div>
                <div className="mt-3 text-sm text-gray-800 space-y-2">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><div>Finnhub</div><div className="text-green-600 font-semibold">OK</div></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><div>OpenAI</div><div className="text-green-600 font-semibold">OK</div></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><div>News Engine</div><div className="text-green-600 font-semibold">OK</div></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><div>Signal Engine</div><div className="text-green-600 font-semibold">OK</div></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><div>Scheduler</div><div className="text-green-600 font-semibold">OK</div></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><div>Databas</div><div className="text-green-600 font-semibold">OK</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
