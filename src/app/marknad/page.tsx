"use client";

import React, { useEffect, useMemo, useState } from "react";
import LeftSidebar from '../../components/dashboard-v1/LeftSidebar';
import { getMockMarketData } from "../../lib/mock-market-monitor";
import CompanyLogo from "../../components/CompanyLogo";

type UIQuote = {
  symbol: string;
  name?: string | null;
  price: number | null;
  prevPrice: number | null;
  volume?: number;
  updatedAt?: string | null;
  dataStatus?: string | null; // LIVE|DELAYED|STALE|UNAVAILABLE|MOCK
  currency?: string | null;
  change?: number | null;
  changePercent?: number | null;
  provider?: string | null;
  marketTimestamp?: string | null;
};

  const TARGET_SYMBOLS = ["NVDA", "MSFT", "AAPL", "INVE-B.ST", "NOVO-B.CO"];

  function flagForSymbol(sym?: string) {
    if (!sym) return '';
    const s = sym.toUpperCase();
    if (s.includes('.ST')) return '🇸🇪';
    if (s.includes('.CO')) return '🇩🇰';
    if (s.includes('.US') || s.match(/^[A-Z]{1,5}$/)) return '🇺🇸';
    return '';
  }

function formatChangePct(oldVal: number | null, newVal: number | null) {
  if (oldVal === null || oldVal === 0 || newVal === null) return "0.00%";
  const pct = ((newVal - oldVal) / Math.abs(oldVal)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-medium ${className}`}>{children}</span>
  );
}

export default function MarketMonitorPage() {
  const mockInitial = useMemo(() => getMockMarketData(), []);
  const [quotes, setQuotes] = useState<UIQuote[]>(() => mockInitial.map((q) => ({ symbol: q.symbol, name: q.name, price: q.price, prevPrice: q.prevPrice, volume: q.volume, updatedAt: q.updatedAt, dataStatus: 'MOCK' })));
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [usingProvider, setUsingProvider] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);

  useEffect(() => {
    const iv = setInterval(() => setSecondsLeft((s) => (s <= 1 ? 30 : s - 1)), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function fetchOnce() {
      try {
        const res = await fetch('/api/market-data/quotes');
        if (!mounted) return;
        if (!res.ok) {
          if (process.env.NODE_ENV !== 'production') {
            setUsingProvider(false);
            const mock = getMockMarketData();
            setQuotes(mock.filter(m => TARGET_SYMBOLS.includes(m.symbol)).map(m => ({ symbol: m.symbol, name: m.name, price: m.price, prevPrice: m.prevPrice, volume: m.volume, updatedAt: m.updatedAt, dataStatus: 'MOCK' })));
            setLastFetchedAt(new Date().toISOString());
            return;
          }
          setUsingProvider(false);
          setQuotes(TARGET_SYMBOLS.map(s => ({ symbol: s, name: null, price: null, prevPrice: null, volume: 0, updatedAt: null, dataStatus: 'UNAVAILABLE' })));
          setLastFetchedAt(new Date().toISOString());
          return;
        }

        const body = await res.json();
        const fetched: any[] = Array.isArray(body?.quotes) ? body.quotes : [];
        const map = new Map<string, any>();
        for (const f of fetched) { if (f && f.symbol) map.set(String(f.symbol).toUpperCase(), f); }

        const out: UIQuote[] = TARGET_SYMBOLS.map(sym => {
          const s = map.get(sym.toUpperCase());
          if (!s) { return { symbol: sym, name: null, price: null, prevPrice: null, volume: 0, updatedAt: null, dataStatus: 'UNAVAILABLE' }; }
          return {
            symbol: s.symbol || sym,
            name: s.name || null,
            price: typeof s.price === 'number' ? s.price : (s.price ? Number(s.price) : null),
            prevPrice: (s.previousClose ?? s.previous_close ?? s.prevPrice ?? s.prev_price) ? Number(s.previousClose ?? s.previousClose ?? s.prevPrice ?? s.prev_price) : (s.previousClose ?? null),
            volume: s.volume ?? 0,
            updatedAt: s.marketTimestamp || s.fetchedAt || s.timestamp || null,
            dataStatus: s.dataStatus || s.status || null,
            currency: s.currency || null,
            change: s.change ?? null,
            changePercent: s.changePercent ?? s.change_percent ?? null,
            provider: s.provider || null,
            marketTimestamp: s.marketTimestamp || null,
          };
        });

        setQuotes(out);
        setUsingProvider(true);
        setLastFetchedAt(body?.fetchedAt || new Date().toISOString());
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          setUsingProvider(false);
          const mock = getMockMarketData();
          setQuotes(mock.filter(m => TARGET_SYMBOLS.includes(m.symbol)).map(m => ({ symbol: m.symbol, name: m.name, price: m.price, prevPrice: m.prevPrice, volume: m.volume, updatedAt: m.updatedAt, dataStatus: 'MOCK' })));
          setLastFetchedAt(new Date().toISOString());
        } else {
          setUsingProvider(false);
          setQuotes(TARGET_SYMBOLS.map(s => ({ symbol: s, name: null, price: null, prevPrice: null, volume: 0, updatedAt: null, dataStatus: 'UNAVAILABLE' })));
          setLastFetchedAt(new Date().toISOString());
        }
      }
    }

    fetchOnce();
    const iv = setInterval(() => fetchOnce(), 30_000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  // Determine market status for the top card
  const hasRealQuote = quotes.some(q => q.dataStatus === 'LIVE' || (usingProvider && q.price !== null));
  const marketCardStatus = hasRealQuote ? 'LIVE' : 'DEGRADED';

  function badgeForStatus(s?: string) {
    const st = (s || 'UNAVAILABLE').toUpperCase();
    if (st === 'LIVE') return 'bg-green-100 text-green-800 border border-green-200';
    if (st === 'DELAYED' || st === 'STALE') return 'bg-amber-100 text-amber-800 border border-amber-200';
    if (st === 'MOCK') return 'bg-sky-50 text-sky-800 border border-sky-100';
    if (st === 'UNAVAILABLE') return 'bg-rose-50 text-rose-800 border border-rose-100';
    return 'bg-gray-50 text-gray-800 border border-gray-100';
  }

  return (
    <>
      <LeftSidebar />
      <div style={{ marginLeft: 240 }} className="py-8 px-4 bg-[#F9F6F1] min-h-[200px]">
        <div className="max-w-5xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">MARKNADSÖVERVAKNING</h1>
          <p className="text-sm text-gray-600">Kurser uppdateras automatiskt från Atlas marknadsflöde.</p>
          <div className="mt-2 text-xs text-gray-500">Riktig marknadsdata där providerdata finns. Fördröjd eller otillgänglig data markeras tydligt.</div>
        </div>

        <div className="flex flex-col md:flex-row items-start gap-4 mb-6">
          <div className="grid grid-cols-4 gap-3 flex-1">
            <div className="bg-white rounded-md p-2.5 flex flex-col gap-0.5 border border-gray-100 h-16 flex justify-center">
              <div className="text-xs text-gray-500">Marknadsstatus</div>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{marketCardStatus}</div>
                <div className={`text-[10px] px-1.5 py-0.5 rounded ${marketCardStatus === 'LIVE' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>{marketCardStatus}</div>
              </div>
            </div>
            <div className="bg-white rounded-md p-2.5 flex flex-col gap-0.5 border border-gray-100 h-16 flex justify-center">
              <div className="text-xs text-gray-500">Bevakade instrument</div>
              <div className="text-sm font-semibold">{quotes.length}</div>
            </div>
            <div className="bg-white rounded-md p-2.5 flex flex-col gap-0.5 border border-gray-100 h-16 flex justify-center">
              <div className="text-xs text-gray-500">Senaste uppdatering</div>
              <div className="text-sm font-semibold">{lastFetchedAt ? new Date(lastFetchedAt).toLocaleTimeString() : '—'}</div>
            </div>
            <div className="bg-white rounded-md p-2.5 flex flex-col gap-0.5 border border-gray-100 h-16 flex justify-center">
              <div className="text-xs text-gray-500">Nästa uppdatering</div>
              <div className="text-sm font-semibold">{secondsLeft}s</div>
            </div>
          </div>

          <div className="md:w-72 w-full bg-white rounded-md p-3 border border-gray-100 flex flex-col justify-center">
            <div className="text-xs text-gray-500">VICTOR</div>
            <div className="text-sm font-semibold">Marknaden bevakas just nu.</div>
            <div className="text-xs text-gray-500 mt-1">
              {hasRealQuote ? `${quotes.filter(q=>q.dataStatus==='LIVE' || (usingProvider && q.price!==null)).length} instrument analyseras inför nästa uppdatering.` : 'Väntar på tillgänglig marknadsdata.'}
            </div>
            <div className="text-xs text-gray-400 mt-2">Senaste AI-analys: {lastFetchedAt ? new Date(lastFetchedAt).toLocaleTimeString() : '—'}</div>
          </div>
        </div>

        <div className="space-y-2">
          {quotes.map((q) => {
            const status = (q.dataStatus || 'UNAVAILABLE').toUpperCase();
            const pricePresent = q.price !== null && q.price !== undefined;
            const positive = typeof q.change === 'number' && q.change > 0;
            const negative = typeof q.change === 'number' && q.change < 0;

            return (
              <div key={q.symbol} className="bg-white rounded-md py-3 px-3 border border-transparent hover:border-blue-50 transition-colors duration-150">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0">
                      <CompanyLogo symbol={q.symbol} name={q.name || undefined} size={48} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold truncate">{q.name || q.symbol}</div>
                        <div className="text-xs text-gray-400">{flagForSymbol(q.symbol)}</div>
                      </div>
                      <div className="text-xs text-gray-500 truncate">{q.symbol}</div>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center justify-center gap-4">
                    <div className="text-xl font-semibold leading-5">
                      {pricePresent ? Number(q.price).toFixed(2) : '—'}
                      <div className="text-xs text-gray-500">{q.currency || '—'}</div>
                    </div>
                    <div className="text-right">
                      <div className={`${positive ? 'text-green-600' : negative ? 'text-rose-600' : 'text-gray-600'} font-medium text-sm`}>{q.change !== null && q.change !== undefined ? (q.change as number).toFixed(2) : '—'}</div>
                      <div className={`${positive ? 'text-green-600' : negative ? 'text-rose-600' : 'text-gray-600'} text-xs`}>{q.changePercent !== null && q.changePercent !== undefined ? `${q.changePercent.toFixed(2)}%` : '—'}</div>
                    </div>

                    <div className="w-36 flex items-center justify-center">
                      <div className="h-0.5 w-full bg-gray-300 rounded" />
                    </div>
                  </div>

                  <div className="w-44 text-right flex flex-col items-end">
                    <div className={`inline-block text-[11px] px-1.5 py-0.5 rounded ${badgeForStatus(status)}`}>{status}</div>
                    <div className="text-xs text-gray-400 mt-1">{q.updatedAt ? 'Uppdaterad ' + (new Date(q.updatedAt).toLocaleTimeString()) : (lastFetchedAt ? 'Uppdaterad ' + new Date(lastFetchedAt).toLocaleTimeString() : '—')}</div>
                  </div>
                </div>
                {(!pricePresent || status === 'UNAVAILABLE') && (
                  <div className="mt-2 text-xs text-gray-500">Ingen kursdata från aktuell provider</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 max-w-5xl mx-auto">
          <h2 className="text-sm font-semibold mb-3">MARKNADSÖVERSIKT</h2>
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-md p-3 border border-gray-100 flex items-center gap-3">
              <div className="text-lg">🇺🇸</div>
              <div>
                <div className="text-sm font-semibold">USA</div>
                <div className="text-xs text-gray-500">Nasdaq — BEVAKAS</div>
              </div>
            </div>
            <div className="bg-white rounded-md p-3 border border-gray-100 flex items-center gap-3">
              <div className="text-lg">🇸🇪</div>
              <div>
                <div className="text-sm font-semibold">Sverige</div>
                <div className="text-xs text-gray-500">OMXS30 — BEVAKAS</div>
              </div>
            </div>
            <div className="bg-white rounded-md p-3 border border-gray-100 flex items-center gap-3">
              <div className="text-lg">🇩🇰</div>
              <div>
                <div className="text-sm font-semibold">Danmark</div>
                <div className="text-xs text-gray-500">C25 — BEVAKAS</div>
              </div>
            </div>
            <div className="text-xs text-gray-400 ml-4">Indexdata kopplas in senare.</div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
