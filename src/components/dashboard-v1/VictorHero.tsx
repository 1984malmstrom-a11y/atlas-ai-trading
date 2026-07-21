import React from 'react';

export default function VictorHero(){
  return (
    <section aria-hidden style={{ padding: '18px 24px', boxSizing: 'border-box', minWidth: 0 }}>
      <div style={{ height: 330, display: 'flex', alignItems: 'center', background: 'transparent', borderRadius: 0, overflow: 'visible' }}>
        <div style={{ padding: 24, flex: '0 0 55%', minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#D4AF37', marginBottom: 2 }}>VICTOR</div>
          <div style={{ color: '#FFFDF8', fontSize: 20, fontWeight: 700, marginBottom: 6 }}>God morgon, Peter.</div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ background: 'rgba(255,255,255,0.06)', padding: '6px 10px', borderRadius: 9999, color: '#D1D5DB', fontSize: 12 }}>Senaste uppdatering: 08:30</div>
            <div style={{ background: 'rgba(255,255,255,0.06)', padding: '6px 10px', borderRadius: 9999, color: '#D1D5DB', fontSize: 12 }}>Risk: Låg</div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ background: '#08203a', color: '#fff', padding: 12, borderRadius: 8, minWidth: 120 }}>
              <div style={{ fontSize: 12, opacity: 0.9 }}>MARKNADEN</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>+0,7%</div>
            </div>
            <div style={{ background: '#071725', color: '#fff', padding: 12, borderRadius: 8, minWidth: 120 }}>
              <div style={{ fontSize: 12, opacity: 0.9 }}>PORTFÖLJ</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>+2,34%</div>
            </div>
            <div style={{ background: '#0b3350', color: '#fff', padding: 12, borderRadius: 8, minWidth: 120 }}>
              <div style={{ fontSize: 12, opacity: 0.9 }}>BEVAKNINGAR</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>12</div>
            </div>
          </div>

          <div style={{ background: '#fff', color: '#0b243d', padding: 12, borderRadius: 10, maxWidth: 520 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#D4AF37', marginBottom: 6 }}>VICTORS REKOMMENDATION</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Köp mer Investor</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.7)', marginTop: 6 }}>Stark fundamental utveckling och kortsiktigt momentum.</div>
            <div style={{ marginTop: 10 }}><a href="#" style={{ color: '#0b3350', fontWeight: 700 }}>Visa analys →</a></div>
          </div>
        </div>
      </div>
    </section>
  );
}
