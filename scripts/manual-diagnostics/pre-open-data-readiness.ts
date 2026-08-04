import { loadEnvConfig } from '@next/env';

// This is a manual diagnostics script moved from the Vitest test harness.
// It performs live provider readiness checks and prints a sanitized summary.
// USAGE: run manually on a machine with appropriate env vars set (do not run in CI).

(async function main(){
  try{
    try{ loadEnvConfig(process.cwd()); }catch(_){ }

    // Try safest fallback to read .env.local without logging secrets
    if (!process.env.TWELVE_DATA_API_KEY || !process.env.FINNHUB_API_KEY){
      try{
        const fs = await import('fs');
        const path = await import('path');
        const p = path.join(process.cwd(), '.env.local');
        if (fs.existsSync(p)){
          const content = fs.readFileSync(p,'utf8');
          const lines = content.split(/\r?\n/);
          for (const line of lines){
            const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('#')) continue;
            const mTd = trimmed.match(/^TWELVE_DATA_API_KEY\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#]*?))(?:\s*(?:#.*)?)?$/);
            if (mTd && !process.env.TWELVE_DATA_API_KEY){ const v = mTd[1] ?? mTd[2] ?? mTd[3] ?? ''; if (v && String(v).trim()) process.env.TWELVE_DATA_API_KEY = String(v).trim(); }
            const mFn = trimmed.match(/^FINNHUB_API_KEY\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#]*?))(?:\s*(?:#.*)?)?$/);
            if (mFn && !process.env.FINNHUB_API_KEY){ const v = mFn[1] ?? mFn[2] ?? mFn[3] ?? ''; if (v && String(v).trim()) process.env.FINNHUB_API_KEY = String(v).trim(); }
          }
        }
      }catch(_){ /* ignore */ }
    }

    // Import provider helpers after env config
    const { getMarketDataProvider } = await import('../../src/lib/market-data');
    const td = await import('../../src/lib/market-data/twelve-data');
    const { fetchFinnhubCompanyNews } = await import('../../src/lib/news-providers/finnhub');
    const { fetchFinnhubEconomicCalendar } = await import('../../src/lib/news-providers/finnhub-economic-calendar');

    const generatedAt = new Date().toISOString();
    const report: any = { generatedAt, overallStatus: 'BLOCKED', capabilities: [], readyCount: 0, limitedCount: 0, blockedCount: 0, topBlockingReasons: [] };

    function push(cap: any){ report.capabilities.push(cap); if (cap.status === 'READY') report.readyCount++; else if (cap.status === 'LIMITED') report.limitedCount++; else report.blockedCount++; if (cap.blockerCode) report.topBlockingReasons.push(cap.blockerCode); }

    // 1) Quotes
    try{
      const provider = getMarketDataProvider();
      let quotes: any[] = [];
      try{ quotes = await (provider as any).getQuotes(['apple','microsoft','EUR_USD']); }catch(e:any){ throw e; }
      const symbolsChecked = (quotes || []).map(q => q.providerSymbol || q.symbol).slice(0,10);
      push({ capability: 'QUOTES', provider: 'TWELVE_DATA', status: 'READY', symbolsChecked, isFresh: symbolsChecked.length>0, observationCount: (quotes||[]).length, blockerCode: null, liveRequestCount: 1 });
    }catch(e:any){ const code = String(e && e.message ? e.message : e).toUpperCase().includes('TWELVE_DATA_API_KEY') ? 'PROVIDER_KEY_MISSING' : 'PROVIDER_ERROR'; push({ capability: 'QUOTES', provider: 'TWELVE_DATA', status: 'BLOCKED', symbolsChecked: [], isFresh: false, observationCount: 0, blockerCode: code, liveRequestCount: 0 }); }

    // 2) Intraday
    try{
      const provider = getMarketDataProvider();
      const intraday5 = await (provider as any).getIntradayCandles('AAPL','5min').catch(()=>null);
      const intraday15 = await (provider as any).getIntradayCandles('AAPL','15min').catch(()=>null);
      const ok = !!(intraday5 && Array.isArray(intraday5.candles) && intraday5.candles.length>0) && !!(intraday15 && Array.isArray(intraday15.candles) && intraday15.candles.length>0);
      push({ capability: 'INTRADAY', provider: 'TWELVE_DATA', status: ok ? 'READY' : 'LIMITED', symbolsChecked: ['AAPL'], isFresh: ok, observationCount: (intraday15?.candles?.length||0) + (intraday5?.candles?.length||0), blockerCode: ok ? null : 'INTRADAY_PARTIAL', liveRequestCount: 2 });
    }catch(e:any){ push({ capability: 'INTRADAY', provider: 'TWELVE_DATA', status: 'BLOCKED', symbolsChecked: [], isFresh: false, observationCount: 0, blockerCode: 'PROVIDER_ERROR', liveRequestCount: 0 }); }

    // 3) Historical
    try{
      const provider = getMarketDataProvider();
      const hist = await (provider as any).getHistoricalDailyCloses('MSFT', 60).catch(()=>null);
      if (hist && Array.isArray(hist.closes) && hist.closes.length >= 20){ push({ capability: 'HISTORICAL', provider: 'TWELVE_DATA', status: 'READY', symbolsChecked: ['MSFT'], isFresh: true, observationCount: hist.closes.length, blockerCode: null, liveRequestCount: 1 }); }
      else { push({ capability: 'HISTORICAL', provider: 'TWELVE_DATA', status: 'LIMITED', symbolsChecked: ['MSFT'], isFresh: false, observationCount: hist ? hist.closes.length : 0, blockerCode: 'INSUFFICIENT_HISTORY', liveRequestCount: 1 }); }
    }catch(e:any){ push({ capability: 'HISTORICAL', provider: 'TWELVE_DATA', status: 'BLOCKED', symbolsChecked: [], isFresh: false, observationCount: 0, blockerCode: 'PROVIDER_ERROR', liveRequestCount: 0 }); }

    // 4) Company News (Finnhub)
    try{
      const items = await fetchFinnhubCompanyNews({ symbols: ['AAPL'], fetchImpl: (globalThis as any).fetch } as any).catch((e:any)=>{ throw e; });
      push({ capability: 'COMPANY_NEWS', provider: 'FINNHUB', status: Array.isArray(items) && items.length>0 ? 'READY' : 'LIMITED', symbolsChecked: ['AAPL'], isFresh: items && items.length>0, observationCount: items ? items.length : 0, blockerCode: null, liveRequestCount: 1 });
    }catch(e:any){ const bc = e && e.code ? e.code : 'PROVIDER_ERROR'; push({ capability: 'COMPANY_NEWS', provider: 'FINNHUB', status: 'BLOCKED', symbolsChecked: [], isFresh: false, observationCount: 0, blockerCode: bc, liveRequestCount: 0 }); }

    // 5) Earnings
    try{
      const eps = await td.fetchEarnings('AAPL').catch(()=>null);
      push({ capability: 'EARNINGS', provider: 'TWELVE_DATA', status: eps && Array.isArray(eps) && eps.length>0 ? 'READY' : 'LIMITED', symbolsChecked: ['AAPL'], isFresh: !!(eps && eps.length>0), observationCount: eps ? eps.length : 0, blockerCode: null, liveRequestCount: 1 });
    }catch(e:any){ push({ capability: 'EARNINGS', provider: 'TWELVE_DATA', status: 'BLOCKED', symbolsChecked: [], isFresh: false, observationCount: 0, blockerCode: 'PROVIDER_ERROR', liveRequestCount: 0 }); }

    // 6) Fundamentals
    try{
      const caps = await td.detectFundamentalCapabilities('AAPL').catch(()=>null);
      if (caps && caps.profile === 'AVAILABLE'){ push({ capability: 'FINANCIALS', provider: 'TWELVE_DATA', status: 'READY', symbolsChecked: ['AAPL'], isFresh: true, observationCount: 1, blockerCode: null, liveRequestCount: 1 }); }
      else if (caps){ push({ capability: 'FINANCIALS', provider: 'TWELVE_DATA', status: 'LIMITED', symbolsChecked: ['AAPL'], isFresh: false, observationCount: 0, blockerCode: 'PLAN_RESTRICTED', liveRequestCount: 1 }); }
      else{ push({ capability: 'FINANCIALS', provider: 'TWELVE_DATA', status: 'BLOCKED', symbolsChecked: [], isFresh: false, observationCount: 0, blockerCode: 'PROVIDER_ERROR', liveRequestCount: 0 }); }
    }catch(e:any){ push({ capability: 'FINANCIALS', provider: 'TWELVE_DATA', status: 'BLOCKED', symbolsChecked: [], isFresh: false, observationCount: 0, blockerCode: 'PROVIDER_ERROR', liveRequestCount: 0 }); }

    // 7) Economic Calendar
    try{
      const cal = await fetchFinnhubEconomicCalendar({ fetchImpl: (globalThis as any).fetch } as any).catch((e:any)=>{ throw e; });
      push({ capability: 'MACRO_CALENDAR', provider: 'FINNHUB', status: Array.isArray(cal) && cal.length>0 ? 'READY' : 'LIMITED', symbolsChecked: [], isFresh: !!(cal && cal.length>0), observationCount: cal ? cal.length : 0, blockerCode: null, liveRequestCount: 1 });
    }catch(e:any){ const code = e && e.code ? e.code : 'MACRO_CALENDAR_PROVIDER_ERROR'; push({ capability: 'MACRO_CALENDAR', provider: 'FINNHUB', status: 'BLOCKED', symbolsChecked: [], isFresh: false, observationCount: 0, blockerCode: code, liveRequestCount: 0 }); }

    push({ capability: 'ANALYST_DATA', provider: 'NONE', status: 'BLOCKED', symbolsChecked: [], isFresh: false, observationCount: 0, blockerCode: 'NO_ADAPTER', liveRequestCount: 0 });

    const coreOk = report.capabilities.find((c:any)=>c.capability==='QUOTES')?.status === 'READY' && report.capabilities.find((c:any)=>c.capability==='INTRADAY')?.status === 'READY' && report.capabilities.find((c:any)=>c.capability==='HISTORICAL')?.status === 'READY';
    report.overallStatus = coreOk ? (report.blockedCount > 0 ? 'LIMITED' : 'READY') : 'BLOCKED';

    // sanitized summary
    try{ const safe = JSON.parse(JSON.stringify(report)); console.log('\nPRE-OPEN READINESS SUMMARY:\n', JSON.stringify(safe, null, 2)); }catch(e){ console.log('PRE-OPEN READINESS: (unable to stringify)'); }

    process.exit(0);
  }catch(e){ console.error('Manual diagnostics script failed:', e && e.message ? e.message : String(e)); process.exit(1); }
})();
