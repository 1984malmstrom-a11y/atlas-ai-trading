"use client";
import React from 'react';
import { usePathname, useRouter } from 'next/navigation';

export default function BackButton(){
  const router = useRouter();
  const pathname = usePathname() || '/';

  // Exclude flows where back button isn't appropriate
  const excludeRoots = ['/login','/onboarding','/splash','/auth'];
  for (const ex of excludeRoots){ if (pathname === ex || pathname.startsWith(ex + '/')) return null; }
  // Hide on Dashboard V1 root (start page)
  if (pathname === '/dashboard-v1' || pathname === '/') return null;

  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    try{
      if (typeof window !== 'undefined' && window.history && window.history.length > 1){
        router.back();
      } else {
        router.push('/dashboard-v1');
      }
    }catch(_){ router.push('/dashboard-v1'); }
  };

  return (
    <button
      onClick={handle}
      aria-label="Gå tillbaka"
      title="Gå tillbaka"
      className="absolute left-6 top-6 z-50 w-9 h-9 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center hover:bg-gray-100 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer"
    >
      <svg className="w-4 h-4 text-slate-700" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
