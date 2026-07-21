import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Atlas Alpha',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>
        <div className="min-h-screen py-6 px-8">
          {children}
        </div>
      </body>
    </html>
  );
}
