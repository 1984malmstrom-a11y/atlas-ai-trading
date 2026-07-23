import './globals.css';
import React from 'react';
import MarketPollingClient from '../components/dashboard-v1/MarketPollingClient';

export const metadata = {
  title: 'Atlas Alpha',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>
        <div className="min-h-screen py-6 px-8 relative">
          {/* Central market poller mounted once for the app */}
          <div aria-hidden style={{ display: 'none' }}>
            <MarketPollingClient />
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
