import React from 'react';

export default function DashboardV1Header(){
  return (
    <div aria-hidden style={{ position: 'absolute', top: 24, left: 0, right: 0, height: 48, display: 'flex', alignItems: 'center', padding: '6px 24px', boxSizing: 'border-box', pointerEvents: 'auto' }}>
      <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginRight: 32 }}>
          {/* Notification */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M15 17H9" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 3C9.23858 3 7 5.23858 7 8V11C7 11.7956 6.68392 12.5587 6.12132 13.1213L5 14.2426V15H19V14.2426L17.8787 13.1213C17.3161 12.5587 17 11.7956 17 11V8C17 5.23858 14.7614 3 12 3Z" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ position: 'absolute', top: 2, right: 6, width: 8, height: 8, borderRadius: 9999, background: '#F59E0B', boxShadow: '0 0 0 2px rgba(245,158,11,0.12)' }} />
          </div>

          {/* Search */}
          <div style={{ width: 260, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.08)', padding: '6px 10px', borderRadius: 9999 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M21 21l-4.35-4.35" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="11" cy="11" r="6" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
            </svg>
            <input placeholder="Sök aktier, ETF:er, fonder eller index..." readOnly style={{ outline: 'none', border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.9)', fontSize: 13, width: '100%', padding: 0 }} />
          </div>

          {/* Profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9999, background: '#0B3D91', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>P</div>
            <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 14, fontWeight: 600 }}>Peter</div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M6 9l6 6 6-6" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
