"use client";

import React, { useState } from 'react';

type Props = {
  // Backwards-compatible props
  symbol?: string;
  name?: string;

  // Preferred new props
  companyName?: string;
  domain?: string;

  size?: number;
  innerPadding?: number;
  className?: string;
};

export default function CompanyLogo({ symbol, name, companyName, domain, size = 56, innerPadding, className }: Props){
  const [failed, setFailed] = useState(false);

  const displayName = companyName || name || symbol || '';
  const displayLetter = (displayName || ' ').trim().charAt(0).toUpperCase();

  const key = typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_LOGO_DEV_KEY || '') : '';

  // Mapping of known symbols/names to logo.dev domains
  const domainMap: { [k: string]: string } = {
    'MSFT': 'microsoft.com',
    'AAPL': 'apple.com',
    'NVDA': 'nvidia.com',
    'AMZN': 'amazon.com',
    'GOOGL': 'google.com',
    'INVESTOR': 'investorab.com',
    'INVE': 'investorab.com',
    'NOVO': 'novonordisk.com',
    'NOVO-B': 'novonordisk.com',
    'ATCO': 'atlascopcogroup.com',
    'ATCO-A': 'atlascopcogroup.com',
    'TELIA': 'teliacompany.com'
  };

  const normalize = (s?: string) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9\-]/g, '');

  let domainToUse = domain || '';
  if (!domainToUse) {
    // Try symbol-based mapping
    const sym = normalize(symbol);
    if (sym && domainMap[sym]) domainToUse = domainMap[sym];
  }
  if (!domainToUse) {
    // Try name-based heuristics
    const nm = normalize(name || companyName);
    if (nm) {
      for (const keyName of Object.keys(domainMap)){
        if (nm.includes(keyName)) { domainToUse = domainMap[keyName]; break; }
      }
    }
  }

  // Build logo.dev URL using domain when available
  const encodedDomain = domainToUse ? encodeURIComponent(domainToUse) : '';
  const src = encodedDomain && key ? `https://img.logo.dev/${encodedDomain}?token=${key}&size=${Math.max(32, size)}&format=png` : '';

  const sizePx = `${size}px`;
  const CONTENT_SCALE = 0.7;
  const contentSize = Math.round(size * CONTENT_SCALE);
  const contentPx = `${contentSize}px`;

  const shouldShowImage = !!encodedDomain && !!key && !failed;

  return (
    <div
      className={className}
      style={{
        width: sizePx,
        height: sizePx,
        borderRadius: 9999,
        overflow: 'hidden',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        flex: '0 0 auto',
        boxSizing: 'border-box',
      }}
    >
      {shouldShowImage ? (
        <img
          src={src}
          alt={displayName}
          style={{ width: contentPx, height: contentPx, objectFit: 'contain', display: 'block', background: 'transparent' }}
          onError={()=> setFailed(true)}
          draggable={false}
        />
      ) : (
        <div style={{ width: contentPx, height: contentPx, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#142438', fontSize: Math.max(12, Math.round(contentSize/2.6)) }}>{displayLetter}</div>
      )}
    </div>
  );
}
