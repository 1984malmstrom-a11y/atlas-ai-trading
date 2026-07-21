import React from 'react';
import logo from '../../../design/locked/logo.png';
import { SIDEBAR_WIDTH, SIDEBAR_HEIGHT, SIDEBAR_MIN_HEIGHT, SIDEBAR_BG } from './layoutConstants';

const menu = [
  'Victor idag',
  'Min portfölj',
  'Analysera',
  'Bevakning',
  'Marknaden',
  'Historik',
  'Inställningar',
];

function LineIcon({ className = '' }: { className?: string }){
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M4 12h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LeftSidebar(){
  return (
    <aside style={{ position: 'fixed', left: 0, top: 0, height: SIDEBAR_HEIGHT, minHeight: SIDEBAR_MIN_HEIGHT, width: SIDEBAR_WIDTH, boxSizing: 'border-box', overflow: 'hidden', alignSelf: 'stretch', background: SIDEBAR_BG }}>
      <div style={{ transform: 'translateY(-70px)' }}>
        <div style={{ padding: '12px 12px 6px 12px' }}>
          <div aria-hidden style={{ width: 210, height: 210, overflow: 'hidden', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
            <img src={(logo as any).src || logo} alt="ATLAS logo" style={{ height: '115%', width: 'auto', objectFit: 'contain', display: 'block', transform: 'translateY(-12px)' }} />
          </div>
        </div>

        <div style={{ transform: 'translateY(-65px)' }}>
        <nav className="px-3 mt-3 flex-1">
        {menu.map((m, idx)=>{
          const active = idx === 0; // Victor idag active
          return (
            <div key={m} style={{ marginTop: 2.5, marginBottom: 2.5 }} className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${active ? 'bg-[#0b3350] rounded-full mx-2' : 'rounded-md hover:bg-[#071a26]'}`}>
              <div className={`${active ? 'text-[#D4AF37]' : 'text-white/90'} w-9 h-9 flex items-center justify-center`}> 
                <LineIcon className={`${active ? 'text-[#D4AF37]' : 'text-white'}`} />
              </div>
              <div className={`${active ? 'text-[#D4AF37]' : 'text-white/90'} text-sm font-medium`}>{m}</div>
            </div>
          );
        })}
      </nav>
      
        <div style={{ padding: '12px' }}>
          <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: '#071725', color: '#E5E7EB', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: '#34D399', display: 'inline-block' }} />
              <div style={{ fontWeight: 600 }}>Victor arbetar</div>
            </div>
            <div style={{ color: '#D1D5DB', fontSize: 12 }}>Analyserar marknaden</div>
            <div style={{ color: '#D1D5DB', fontSize: 12 }}>Uppdaterar riskbild</div>
            <div style={{ color: '#9CA3AF', fontSize: 12, marginTop: 6 }}>Senast uppdaterad 07:42</div>
          </div>

          <div style={{ marginTop: 10, color: '#D4AF37', fontSize: 14 }}>“</div>
          <div style={{ marginTop: 6, color: '#D1D5DB', fontSize: 12 }}>Jag hjälper dig att fatta bättre investeringsbeslut – varje dag.</div>
          <div style={{ color: '#9CA3AF', fontSize: 12, marginTop: 6 }}>/ Victor</div>
        </div>
        </div>
      </div>
    </aside>
  );
}
