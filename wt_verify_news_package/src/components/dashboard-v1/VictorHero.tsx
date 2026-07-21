import React from 'react';

export default function VictorHero(){
  return (
    <section aria-hidden style={{ padding: '18px 24px', boxSizing: 'border-box', minWidth: 0 }}>
      <div style={{ height: 330, display: 'flex', alignItems: 'center', background: 'transparent', borderRadius: 0, overflow: 'visible' }}>
        <div style={{ padding: 24, flex: '0 0 55%', minWidth: 0 }}>
          <h2 className="text-2xl font-semibold" style={{ margin: 0 }}>Victor idag</h2>
          <div style={{ height: 16 }} />
          <p className="text-sm text-gray-600" style={{ margin: 0, maxWidth: 460 }}>Översikt av dagens analys och portföljprestanda (mockdata)</p>
          <div style={{ height: 24 }} />
          <div style={{ color: '#F8F4EE', fontSize: 28, lineHeight: '36px', fontWeight: 700, letterSpacing: '-0.01em', maxWidth: 520 }}>Öka exponeringen mot kvalitetsaktier</div>
          <div style={{ height: 8 }} />
          <div className="text-sm text-gray-500" style={{ maxWidth: 480 }}>Motivering: Stark marknadsmomentum och förbättrade makroindikatorer som ökar sannolikheten för stabil uppgång i kvalitetsbolag.</div>
          <div style={{ height: 18 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
            <div className="text-xs text-gray-400">Dagens briefing: klar</div>
          </div>
        </div>
      </div>
    </section>
  );
}
