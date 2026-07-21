import React from 'react';

const items = [
  'Victor idag',
  'Min portfölj',
  'Analysera',
  'Bevakning',
  'Marknaden',
  'Historik',
  'Inställningar',
];

function IconLine() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M4 12h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LeftNav({ active = 'Victor idag' }: { active?: string }){
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[250px] flex flex-col" style={{ background: '#051626' }}>
      <div className="px-5 py-6">
        <div className="flex items-center space-x-3">
          <div style={{ width: 36, height: 36, background: '#D4AF37' }} className="rounded-sm flex items-center justify-center">
            <div style={{ width: 0, height: 0, borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '14px solid #072233' }} />
          </div>
          <div className="text-white font-semibold text-lg">ATLAS</div>
        </div>
      </div>

      <nav className="px-2 mt-4 flex-1">
        {items.map((it)=>{
          const isActive = it === active;
          return (
            <div key={it} style={{ marginTop: 1.5, marginBottom: 1.5 }} className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer ${isActive ? 'bg-[#0b3043]' : 'hover:bg-[#071a26]'}`}>
              <div className={`${isActive ? 'text-[#D4AF37]' : 'text-white'} w-6 h-6 flex items-center justify-center`}>
                <IconLine />
              </div>
              <div className={`${isActive ? 'text-[#D4AF37]' : 'text-white'} text-sm`}>{it}</div>
            </div>
          );
        })}
      </nav>

      <div className="px-4 pb-4">
        <div className="mt-4 p-3 rounded-md bg-[#071725] text-sm text-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
            <div className="font-medium">Victor arbetar</div>
          </div>
          <div className="text-xs text-gray-300">Analyserar marknaden</div>
          <div className="text-xs text-gray-300">Uppdaterar riskbild</div>
          <div className="text-xs text-gray-400 mt-2">Senast uppdaterad 07:42</div>
        </div>

        <div className="mt-6 text-xs text-gray-300 italic">“Jag hjälper dig att fatta bättre investeringsbeslut – varje dag.”<br/>/ Victor</div>
      </div>
    </aside>
  );
}
