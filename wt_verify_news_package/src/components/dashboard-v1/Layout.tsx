import React from 'react';
import LeftSidebar from './LeftSidebar';
import MainArea from './MainArea';
import bg from '../../../design/locked/background.png';

export default function DashboardLayout(){
  return (
    <div style={{ position: 'fixed', inset: 0, width: 'auto', height: 'auto', overflow: 'hidden', boxSizing: 'border-box', display: 'flex' }}>
      <LeftSidebar />
      <main style={{ marginLeft: 240, flex: '1 1 0%', minWidth: 0, minHeight: 0, height: '100%', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 'calc(50% + 40px)', top: '50%', width: '107%', height: '107%', transform: 'translate(-50%, -50%)', backgroundImage: `url(${(bg as any).src || bg})`, backgroundSize: '107% auto', backgroundRepeat: 'no-repeat', backgroundPosition: '35% center' }} />
        </div>

        <div style={{ position: 'relative', zIndex: 2, minWidth: 0, minHeight: 0 }}>
          <MainArea />
        </div>
      </main>
    </div>
  );
}
