"use client";
import React from 'react';
import { usePathname } from 'next/navigation';
import BackButton from './BackButton';

export default function BackButtonWrapper(){
  const pathname = usePathname() || '/';
  // Render BackButton only on client pages that are NOT the dashboard root
  if (pathname === '/' || pathname === '/dashboard-v1') return null;
  return <BackButton />;
}
