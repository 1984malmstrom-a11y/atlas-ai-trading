"use client";

import React, { useState, useEffect } from 'react';
import CompanyLogo from '../../components/CompanyLogo';
import LeftSidebar from '../../components/dashboard-v1/LeftSidebar';
import DashboardV1Header from '../../components/dashboard-v1/DashboardV1Header';
// Import detailed Victor panels for the full-analysis modal (used when link clicked)
import VictorsAnalysisPanel from '../../components/atlas/VictorsAnalysisPanel';
import VictorsInvestmentReportPanel from '../../components/atlas/VictorsInvestmentReportPanel';
import VictorTradingControl from '../../components/atlas/VictorTradingControl';
import { CARD_PADDING, CARD_BORDER_RADIUS, BG_LIGHT, BG_DARK, CARD_HEADING_FONT_SIZE, CARD_HEADING_FONT_WEIGHT, CARD_SECONDARY_FONT_SIZE, SEPARATOR_LIGHT, STATUS_COLORS, GLOW, PAGE_BG, CARD_BG, CARD_ALT_BG, CARD_BORDER } from '../../components/dashboard-v1/cardStyles';
import { SIDEBAR_WIDTH } from '../../components/dashboard-v1/layoutConstants';

function ActionIcon({ type }: { type: 'up' | 'down' | 'eye' | 'check' | 'x' }){
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as any;
  if (type === 'up') return (
    <svg {...common} aria-hidden>
      <path d="M12 19V6" />
      <path d="M5 13l7-7 7 7" />
    </svg>
  );
  if (type === 'down') return (
    <svg {...common} aria-hidden>
      <path d="M12 5v14" />
      <path d="M19 11l-7 7-7-7" />
    </svg>
  );
  if (type === 'eye') return (
    <svg {...common} aria-hidden>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
  if (type === 'x') return (
    <svg {...common} aria-hidden>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
  // check
  return (
    <svg {...common} aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

const holdings = [
  { id: 'investor', name: 'Investor', qty: 120, gav: '150.00', now: '172.50', change: '+15.0%', today: '+0,8 %', todayKr: '+1 560 kr', value: '20 700', victor: 'Behåll', victorStatus: 'Behåll', victorHoverInsight: 'Jag hade ökat innehavet.', spark: [3,4,5,6,5,6,7] },
  { id: 'microsoft', name: 'Microsoft', qty: 30, gav: '250.00', now: '289.00', change: '+15.6%', today: '+0,6 %', todayKr: '+520 kr', value: '8 670', victor: 'Köp', victorStatus: 'Köp', victorHoverInsight: 'Jag ser ingen anledning att förändra innehavet.', spark: [6,7,8,9,8,10,11] },
  { id: 'atlas-copco', name: 'Atlas Copco', qty: 80, gav: '120.00', now: '132.00', change: '+10.0%', today: '+0,2 %', todayKr: '+120 kr', value: '10 560', victor: 'Bevaka', victorStatus: 'Bevaka', victorHoverInsight: 'Jag hade bevakat utvecklingen.', spark: [4,4,5,5,6,6,6] },
  { id: 'nvidia', name: 'NVIDIA', qty: 10, gav: '450.00', now: '520.00', change: '+15.6%', today: '+1,1 %', todayKr: '+570 kr', value: '5 200', victor: 'Bevaka', victorStatus: 'Bevaka', victorHoverInsight: 'Jag hade minskat exponeringen.', spark: [7,8,9,10,12,11,13] },
  { id: 'kronan', name: 'Kronan', qty: 500, gav: '10.00', now: '10.50', change: '+5.0%', today: '+0,1 %', todayKr: '+50 kr', value: '5 250', victor: 'Behåll', victorStatus: 'Behåll', victorHoverInsight: 'Ingen kortsiktig förändring rekommenderas.', spark: [1,1,1,2,1,1,1] },
  { id: 'telia', name: 'Telia', qty: 200, gav: '30.00', now: '32.00', change: '+6.7%', today: '+0,3 %', todayKr: '+240 kr', value: '6 400', victor: 'Bevaka', victorStatus: 'Bevaka', victorHoverInsight: 'Jag hade bevakat utvecklingen.', spark: [2,2,3,3,4,3,4] },
  { id: 'handelsbanken', name: 'Handelsbanken', qty: 150, gav: '40.00', now: '41.50', change: '+3.8%', today: '+0,0 %', todayKr: '+0 kr', value: '6 225', victor: 'Behåll', victorStatus: 'Behåll', victorHoverInsight: 'Jag hade avvaktat.', spark: [3,3,3,3,3,3,3] },
  { id: 'ericsson', name: 'Ericsson', qty: 90, gav: '60.00', now: '66.00', change: '+10.0%', today: '+0,4 %', todayKr: '+240 kr', value: '5 940', victor: 'Bevaka', victorStatus: 'Bevaka', victorHoverInsight: 'Jag ser bättre möjligheter på annat håll.', spark: [5,5,6,6,6,5,6] },
  { id: 'novo-nordisk', name: 'Novo Nordisk', qty: 20, gav: '550.00', now: '530.00', change: '-3.6%', today: '-0,8 %', todayKr: '-320 kr', value: '10 600', victor: 'Sälj', victorStatus: 'Sälj', victorHoverInsight: 'Jag rekommenderar att ta hem vinst.', spark: [12,11,10,11,10,9,8] },
];

// Page-level mock fields for easy future dynamic wiring
const pageMocks = {
  dailyVictorGreeting: 'God morgon Peter.',
  dailyFocusItems: [
    { text: 'Fed lämnar räntebesked imorgon.', tag: 'Hög prioritet' },
    { text: 'NVIDIA rapporterar nästa vecka.', tag: 'Bevaka' }
  ],
  portfolioHealthComment: 'Portföljen är välbalanserad men teknikandelen är fortfarande något hög.'
};

const VICTOR_STATUS_COLORS: Record<string,string> = {
  'Behåll': STATUS_COLORS.green,
  'Köp': '#0B84A5',
  'Bevaka': '#D4AF37',
  'Sälj': '#DC2626'
};

// Detailed Victor priorities (shared mock data used by MinaInnehav and inline expanded rows)
const victorPriorities = [
  {
    id: 'investor',
    title: 'Investor',
    symbol: 'INVE-B.ST',
    company: 'Investor',
    advice: 'Jag hade ökat mitt innehav i Investor.',
    conclusion: 'Rapporten och den stabila tillväxten väger enligt mig tyngre än den något höga värderingen.',
    workCompleted: [
      'Analyserat de senaste 30 handelsdagarna',
      'Läst bolagets senaste rapport',
      'Jämfört värderingen med 5-årssnittet'
    ],
    keyFactors: ['Stark rapport ++', 'Positivt nyhetsflöde +', 'Hög värdering -'],
    reasoning: 'Den starka rapporten och förbättrade kassaflöden väger enligt mig tyngre än den något höga värderingen.',
    counterSignals: ['Värderingen är hög', 'Kortsiktig volatilitet kan öka'],
    changeTriggers: ['Tillväxtprognosen sänks nästa kvartal', 'Marginalpress i kommande rapport'],
    confidence: 92,
    analyzedAt: 'för 4 minuter sedan',
    changesSincePrevious: ['Rapporten överträffade förväntningarna', 'Två analytiker höjde prognoser'],
    sourcesCount: 12,
    isPriority: true,
    hasChangedOpinion: true,
    previousAdvice: 'Jag hade avvaktat.',
    currentAdvice: 'Jag hade ökat mitt innehav i Investor.',
    action: 'KÖP',
    currentValue: 20700,
    suggestedValue: 25000,
    currentWeight: 8.8,
    suggestedWeight: 10.6,
    suggestedChangePercent: 20
  },
  {
    id: 'nvidia',
    title: 'NVIDIA',
    symbol: 'NVDA',
    company: 'NVIDIA',
    advice: 'Jag hade minskat exponeringen mot NVIDIA just nu.',
    conclusion: 'Den tekniska nedgången och den höga värderingen gör risk/reward mindre attraktiv på kort sikt.',
    workCompleted: [
      'Analyserat de senaste 30 handelsdagarna',
      'Granskat 42 relevanta nyhetsartiklar',
      'Jämfört pris/multiplar mot historiskt snitt'
    ],
    keyFactors: ['Svagare momentum -', 'Hög värdering -', 'Stark långsiktig efterfrågan +'],
    reasoning: 'Tekniska svagheter och nyhetsbilden väger tyngre just nu; dock finns långsiktiga positiva faktorer.',
    counterSignals: ['Starkt fundament på längre sikt'],
    changeTriggers: ['Klar nedgång i efterfrågan eller positiva intäktssiffror vid nästa kvartal'],
    confidence: 81,
    analyzedAt: 'för 12 minuter sedan',
    changesSincePrevious: ['Ökad volatilitet', 'Negativa kortsiktiga signaler i teknisk analys'],
    sourcesCount: 42,
    isPriority: false,
    hasChangedOpinion: false,
    previousAdvice: 'Jag rekommenderade tidigare att behålla.',
    currentAdvice: 'Jag hade minskat exponeringen mot NVIDIA just nu.',
    action: 'SÄLJ',
    currentValue: 5200,
    currentWeight: 7.4,
    suggestedWeight: 6.3,
    suggestedChangePercent: -15
  }
];

// Mapping from stable holding id -> analysis object (for reliable lookup)
const analysisByHoldingId: Record<string, any> = {};
victorPriorities.forEach(p => { if (p.id) analysisByHoldingId[p.id] = p; });

// Ensure a complete, consistent analysis object for the five focus holdings.
// Use existing mock values where available, otherwise derive sensible mock fields
['investor','novo-nordisk','atlas-copco','microsoft','telia'].forEach(id => {
  const h = holdings.find(hh => hh.id === id);
  if(!h) return;
  const gavNum = parseFloat(String(h.gav || '0').replace(',', '.')) || 0;
  const qty = Number(h.qty || 0) || 0;
  const acquisitionValue = Math.round(gavNum * qty);
  const totalValue = parseInt((h.value || '0').toString().replace(/\s+/g, ''), 10) || 0;
  const valueChange = totalValue - acquisitionValue;
  // Try to derive percent change from existing fields, fallback to computed percent
  let percent = 0;
  try{
    const raw = String(h.change || '').replace('%','').replace(',','.').trim();
    percent = raw.length ? parseFloat(raw) : (acquisitionValue ? Math.round((valueChange / acquisitionValue) * 1000) / 10 : 0);
  }catch(e){ percent = acquisitionValue ? Math.round((valueChange / acquisitionValue) * 1000) / 10 : 0; }

  analysisByHoldingId[id] = {
    actionNow: String(h.victor || h.victorStatus || 'Ingen rekommendation'),
    acquisitionValue: acquisitionValue,
    valueChange: valueChange,
    totalValue: totalValue,
    percentChange: percent,
    fullAnalysis: {
      summary: `Victor: kort sammanfattning för ${h.name}.`,
      opportunity: 'Identifierade möjligheter att förbättra positionen.',
      risk: 'Kortsiktig volatilitet och värderingsrisk.'
    }
  };
});

export default function MinPortfoljPage(){
  // Measure actual sidebar width on mount and expose as CSS variable
  useEffect(()=>{
    const aside = document.querySelector('aside');
    if(!aside) return;
    const setVar = ()=>{
      try{
        const w = Math.round(aside.getBoundingClientRect().width);
        document.documentElement.style.setProperty('--atlas-sidebar-width', w + 'px');
      }catch(e){/* ignore */}
    };
    setVar();
    // observe resizes if sidebar might change (responsive)
    const ro = new ResizeObserver(setVar);
    ro.observe(aside as Element);
    return ()=> ro.disconnect();
  }, []);

  const topHoldings = React.useMemo(()=>{
    return [...holdings]
      .map(h=> ({ ...h, valueNum: parseInt((h.value||'0').toString().replace(/\s+/g,''),10) || 0 }))
      .sort((a,b)=> b.valueNum - a.valueNum)
      .slice(0,6);
  }, []);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [canHover, setCanHover] = useState<boolean>(false);
  const [fullAnalysisOpen, setFullAnalysisOpen] = useState<boolean>(false);
  const [fullAnalysisReport, setFullAnalysisReport] = useState<any>(null);

  // Live quotes state and refresh logic (minimal, safe, client-side only)
  const [quotesById, setQuotesById] = useState<Record<string, any>>({});
  const [quoteStatus, setQuoteStatus] = useState<'idle'|'loading'|'success'|'error'>('idle');
  const isFetchingRef = React.useRef(false);
  const REFRESH_MS = 60 * 1000; // at most once per 60s

  const formatPercent = (v: number | null | undefined) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '';
    const n = Number(v);
    const sign = n > 0 ? '+' : (n < 0 ? '−' : '');
    const abs = Math.abs(n).toFixed(1).replace('.', ',');
    return `${sign}${abs} %`;
  };

  const formatCurrency = (amt: number | null | undefined, currency = 'SEK') => {
    if (amt === null || amt === undefined || Number.isNaN(Number(amt))) return '';
    try{
      // show without decimals for portfolio totals
      return new Intl.NumberFormat('sv-SE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amt));
    }catch(e){
      return `${Math.round(Number(amt)).toLocaleString('sv-SE')} ${currency}`;
    }
  };

  async function fetchQuotesOnce(){
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setQuoteStatus('loading');
    try{
      const resp = await fetch('/api/market-data/quotes');
      if (!resp.ok) throw new Error('Quote fetch failed');
      const data = await resp.json();
      const map: Record<string, any> = {};
      if (Array.isArray(data?.quotes)){
        data.quotes.forEach((q:any)=>{ if (q && q.instrumentId) map[q.instrumentId] = q; });
      }
      setQuotesById(map);
      setQuoteStatus('success');
    }catch(e){
      setQuoteStatus('error');
    }finally{
      isFetchingRef.current = false;
    }
  }

  useEffect(()=>{
    // initial fetch and periodic refresh
    fetchQuotesOnce();
    const iv = setInterval(()=>{ fetchQuotesOnce(); }, REFRESH_MS);
    return ()=>{ clearInterval(iv); };
  }, []);

  function openFullAnalysis(holding: any){
    // stable lookup using holding.id
    const analysis = analysisByHoldingId[holding.id];
    // Build a sanitized report object expected by the full panels to avoid N/A or Invalid Date
    const rpt = analysis && analysis.fullAnalysis ? {
      overallRating: analysis.actionNow || holding.victor || 'Ingen rekommendation',
      overallScore: (analysis.overallScore !== undefined && analysis.overallScore !== null) ? analysis.overallScore : 'Ingen data',
      confidence: (analysis.confidence !== undefined && analysis.confidence !== null) ? `${analysis.confidence} %` : '0 %',
      portfolioFit: (analysis.portfolioFit !== undefined && analysis.portfolioFit !== null) ? analysis.portfolioFit : '—',
      investorFit: (analysis.investorFit !== undefined && analysis.investorFit !== null) ? analysis.investorFit : '—',
      timeHorizon: analysis.timeHorizon || 'Odefinierad',
      nextReviewDate: new Date().toISOString(),
      opportunities: analysis.fullAnalysis.opportunity ? [analysis.fullAnalysis.opportunity] : [],
      risks: analysis.fullAnalysis.risk ? [analysis.fullAnalysis.risk] : [],
      modulesUsed: [],
      collectedAt: new Date().toISOString(),
      sourcesCount: analysis.sourcesCount || 0,
      summary: analysis.fullAnalysis.summary || `Full analys för ${holding.name}.`,
    } : {
      overallRating: holding.victor || 'Ingen rekommendation',
      overallScore: 'Ingen data',
      confidence: '0 %',
      portfolioFit: '—',
      investorFit: '—',
      timeHorizon: 'Odefinierad',
      nextReviewDate: new Date().toISOString(),
      opportunities: [],
      risks: [],
      modulesUsed: [],
      collectedAt: new Date().toISOString(),
      sourcesCount: 0,
      summary: `Mockanalys för ${holding.name}.`,
    };
    setFullAnalysisReport(rpt);
    setFullAnalysisOpen(true);
  }
  useEffect(()=>{
    try{ setCanHover(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches); }catch(e){ setCanHover(false); }
  }, []);

  // Focused display holdings (explicit order)
  const displayHoldings = React.useMemo(()=>{
    const focusNames = ['Investor','Novo Nordisk','Atlas Copco','Microsoft','Telia'];
    const map = new Map(holdings.map(h=>[h.name,h]));
    return focusNames.map(n=> map.get(n)).filter(Boolean) as typeof holdings;
  }, []);

  return (
    <div>
      <LeftSidebar />
      <DashboardV1Header />

      <main style={{ marginLeft: 'var(--atlas-sidebar-width)', padding: '40px', minHeight: '100vh', boxSizing: 'border-box', background: PAGE_BG, width: 'auto', maxWidth: '100%', minWidth: 0 }}>
        <style>{`
          .mp-grid { display: grid; grid-template-columns: minmax(0,1fr) clamp(260px,18vw,320px); gap: 28px; width:100%; max-width:100%; min-width:0; box-sizing:border-box; }
          .mp-left, .mp-right { min-width: 0; }
          .mp-card-full { width:100%; max-width:100%; min-width:0; box-sizing:border-box; }
          .mp-table { table-layout: fixed; width:100%; }
          .mp-table td, .mp-table th { word-break: break-word; overflow-wrap: anywhere; }
          /* Constrain absolute/sticky header so it does not span the sidebar */
          div[aria-hidden][style*="position:absolute"] {
            background: #F7F4ED !important;
            border-bottom: none !important;
            box-shadow: none !important;
            left: var(--atlas-sidebar-width) !important;
            right: 0 !important;
            width: auto !important;
            inset-inline-start: var(--atlas-sidebar-width) !important;
            inset-inline-end: 0 !important;
            box-sizing: border-box !important;
          }
          /* Also adjust pseudo elements if present */
          div[aria-hidden][style*="position:absolute"]::before,
          div[aria-hidden][style*="position:absolute"]::after {
            left: var(--atlas-sidebar-width) !important;
            right: 0 !important;
            box-sizing: border-box !important;
          }
          /* Ensure search control uses the darker translucent style */
          div[aria-hidden][style*="position:absolute"] div[style*="width: 260"] { background: rgba(16,42,67,0.08) !important; border: 1px solid rgba(16,42,67,0.06) !important; }
          /* Force unified light card styling for this page (override global rules) */
          /* Left main cards: primary, almost white */
          .mp-left .mp-card-full, .mp-card-full.portfolio-card, .mp-card-full.holdings-card { background: ${CARD_BG} !important; border: ${CARD_BORDER} !important; box-shadow: ${GLOW} !important; color: #142438 !important; }
          /* Right column cards: secondary, slightly cooler */
          .mp-right > .action-card, .mp-right > .health-card, .mp-right > .risk-card, .mp-right > .mp-card-full { background: ${CARD_ALT_BG} !important; border: ${CARD_BORDER} !important; box-shadow: 0 6px 18px rgba(16,42,67,0.03) !important; color: #142438 !important; }
          @media (max-width:1500px){ main { padding: 28px; } .mp-grid{ gap:24px; } }
          @media (max-width:1250px){ .mp-grid{ grid-template-columns: 1fr; } }
          /* Recent events compact 2-column grid (more compact: ~35% lower height) */
          .recent-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px; }
          .recent-event { display: flex; gap: 12px; align-items: center; padding: 6px; border-radius: 8px; transition: background 120ms; min-height: 40px; box-sizing: border-box; }
          .recent-event .icon { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 14px; border-radius: 9999px; background: rgba(16,42,67,0.03); box-sizing: border-box; }
          .recent-event .meta { font-size: 10px; color: #626761; }
          .recent-event .title { font-size: 12px; font-weight: 700; color: #142438; line-height: 1.05; }
          .recent-event .desc { font-size: 11px; color: #626761; margin-top: 3px; line-height: 1.05; }
          .recent-footer { display: flex; justify-content: flex-end; margin-top: 6px; }
          @media (max-width: 1000px){ .recent-grid { grid-template-columns: 1fr; } }
          /* Compact holdings table for right column - refined visual */
          .compact-holdings table { width:100%; border-collapse: collapse; font-size:13px; table-layout: fixed; }
          .compact-holdings thead th { font-size:11px; color: rgba(16,42,67,0.7); text-align:left; padding:8px 6px; font-weight:700; letter-spacing:0.4px; }
          .compact-holdings tbody td { padding:8px 6px; vertical-align: middle; }
          .compact-holdings tbody tr { cursor: pointer; transition: background 140ms, transform 100ms, box-shadow 100ms; }
          .compact-holdings tbody tr:hover { background: rgba(16,42,67,0.02); transform: translateY(-1px); box-shadow: 0 6px 18px rgba(16,42,67,0.03); }
          .holding-name { font-size:13px; font-weight:700; color:#142438; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .holding-value { font-size:13px; font-weight:700; color:#102A43; text-align:right; white-space:nowrap; }
          .holding-change { font-size:12px; color:#39495B; display:flex; flex-direction:column; align-items:flex-end; }
          .holding-change .today { font-size:11px; color:#6b7280; opacity:0.95; white-space:nowrap; }
          /* Removed permanent 'Totalt' display from normal view; kept styles for possible expanded panel */
          .holding-change .total { font-size:12px; font-weight:700; white-space:nowrap; }
          .holding-change.positive .total { color: ${STATUS_COLORS.green}; }
          .holding-change.negative .total { color: #DC2626; }
          .holding-row { height:56px; }
          .hold-logo { width:32px; height:32px; border-radius:8px; background: rgba(16,42,67,0.03); display:flex; align-items:center; justify-content:center; }
          /* Victor badges removed from holdings view to avoid repetition */
          .view-all-link { font-size:13px; color:#102A43; cursor:pointer; font-weight:700; letter-spacing:0.2px; }
          /* Hover insight and expanded inline panel */
          @media (hover: hover) {
            .compact-holdings tbody tr.holding-row { transition: background 180ms ease, transform 180ms ease, box-shadow 180ms ease; }
            .compact-holdings tbody tr.holding-row:hover { background: rgba(250,244,236,0.6); transform: translateY(-1px); }
            .compact-holdings .insight-row td { background: rgba(250,244,236,0.85); transition: opacity 180ms ease, transform 180ms ease; }
            .compact-holdings .insight-content { font-size:12px; color:#5b4631; opacity:1; }
          }
          @media (hover: none) {
            .compact-holdings tbody tr.holding-row:hover { background: transparent; transform: none; box-shadow: none; }
            .compact-holdings .insight-row { display: none; }
          }
          .expanded-row td { background: rgba(255,250,240,0.9); }
          .expanded-panel { background: #fffaf2; border-radius:8px; padding:8px 10px; }
          .expanded-panel .title { font-weight:700; color:#102A43; font-size:13px; }
          .expanded-panel .insight-content { font-size:13px; color:#39495B; margin-top:6px; }
          /* Victor recommendations compact cards */
          .reco-list { display: flex; flex-direction: column; gap: 12px; }
          /* All recommendation cards use white background; keep layout unchanged */
          .reco-card { position: relative; display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; background: #ffffff; border: 1px solid rgba(94,82,58,0.06); box-sizing: border-box; transition: transform 140ms ease, box-shadow 140ms ease; min-height: 48px; }
          .reco-card:hover { transform: translateY(-4px); box-shadow: 0 10px 20px rgba(62,50,31,0.06); }
          /* Primary card: 2px Atlas-gold border and subtle glow */
          .reco-card.primary { border: 2px solid #D4AF37; background: #ffffff; box-shadow: 0 8px 30px rgba(212,175,55,0.08); }
          .reco-card.secondary { border: 1px solid rgba(16,42,67,0.08); }
          .reco-card.tertiary { border: 1px solid rgba(94,82,58,0.06); }
          .reco-left { display: flex; gap: 14px; align-items: flex-start; flex: 1; padding-left: 8px; min-width: 0; }
          .reco-right { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; width: 120px; margin-left: 6px; box-sizing: border-box; }
          /* logo container on right */
          /* slightly smaller logo container (10-15% reduction), lighter bg and shadow */
          .logo-wrap { width: 88px; height: 88px; border-radius: 10px; display:flex; align-items:center; justify-content:center; background: rgba(16,42,67,0.02); box-shadow: 0 1px 4px rgba(2,12,20,0.02); }
          .logo-wrap img, .logo-wrap svg { border-radius: 14px; width: 80px; height: 80px; object-fit: contain; }
          .reco-left .meta { display:flex; flex-direction:column; }
          /* analysis overview styles removed */
          .reco-left .title { font-size: 15px; font-weight: 600; color: #142438; line-height: 1.05; max-width: calc(100% - 140px); }
          .advice-text { font-size:22px; font-weight:600; color:#102A43; margin-top:6px; }
          .conclusion { font-size:13px; color:#39495B; line-height:1.25; max-width:68ch; margin-top:6px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
          .changed-box { background: #F3E8D0; border: 1px solid rgba(212,175,55,0.22); border-radius: 10px; padding: 6px 12px; display: inline-flex; gap: 8px; align-items: center; font-weight: 600; font-size: 12px; color: #6B7280; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
          .changed-box .icon { width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; border-radius:6px; background: #D4AF37; color: #fff; font-size:12px; flex: 0 0 auto; }
          @media (max-width:520px){ .changed-box{ white-space: normal; overflow-wrap: anywhere; } }
          .reco-left .fact { font-size: 11px; color: #626761; margin-top:4px; opacity: 0.9; line-height:1; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
          .reco-left .ai-tools { font-size: 11px; color: #8a8f94; margin-top:6px; white-space: pre-line; line-height:1.15; }
          .reco-badge { display:inline-block; padding:6px 10px; border-radius:9999px; background: rgba(16,42,67,0.06); color: rgba(16,42,67,0.95); font-weight:700; font-size:12px; }
          .reco-action { font-size:13px; font-weight:700; color:#142438; }
          /* Prominent action badges */
          :root{ --reco-action-width:160px; }
          /* New AI decision card (no button look) */
            /* Right decision column: no box, only separator and typography */
            .separator { width:1px; height:64px; background: rgba(16,42,67,0.06); margin-right:12px; }
            .ai-right { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; width:128px; height:110px; padding:0 6px; box-sizing:border-box; }
            .decision-header { font-size:11px; color: rgba(16,42,67,0.6); text-align:center; margin-bottom:2px; }
            .decision-icon { font-size:36px; line-height:1; }
            .decision-action { font-size:22px; font-weight:600; color:#142438; text-align:center; }
            .decision-label { font-size:11px; color:#9AA3A8; text-align:center; margin-top:2px; }
            .decision-percent { font-size:18px; font-weight:700; color:#142438; text-align:center; }
            .decision-status { font-size:12px; color: rgba(16,42,67,0.5); text-align:center; margin-top:4px; }
            .analysis-chips { display:flex; gap:6px; flex-wrap:wrap; justify-content:center; margin-top:6px; }
            .analysis-chip { font-size:11px; color:#39495B; background: rgba(16,42,67,0.04); padding:4px 6px; border-radius:9999px; }
            .last-analyzed { font-size:11px; color: rgba(16,42,67,0.6); margin-top:6px; }
            .meta-row { display:flex; align-items:center; gap:8px; }
            .meta-badge { font-size:12px; color:#102A43; background: rgba(16,42,67,0.04); padding:4px 8px; border-radius:9999px; font-weight:700; }
            details summary { list-style:none; cursor:pointer; color:#6B7280; font-size:12px; }
            details[open] { padding-top:12px; }
            /* color variants for icon/action text */
            .dec-buy .decision-action, .dec-buy .decision-icon { color: #0B3A1E; }
            .dec-strong-buy .decision-action, .dec-strong-buy .decision-icon { color: #0B6A2F; }
            .dec-consider-buy .decision-action, .dec-consider-buy .decision-icon { color: #5b8bd6; }
            .dec-hold .decision-action, .dec-hold .decision-icon { color: #083063; }
            .dec-watch .decision-action, .dec-watch .decision-icon { color: #D4AF37; }
            .dec-consider-sell .decision-action, .dec-consider-sell .decision-icon { color: #ff9f43; }
            .dec-sell .decision-action, .dec-sell .decision-icon { color: #DC2626; }
            .dec-strong-sell .decision-action, .dec-strong-sell .decision-icon { color: #a11a1a; }
          /* AI badge reduced and muted */
          .reco-badge.small{ font-size:11px; opacity:0.7; padding:4px 8px; border-radius:9999px; }
          .safety-badge { width: var(--reco-action-width); height: 20px; display:flex; align-items:center; justify-content:center; border-radius:8px; font-size:12px; font-weight:700; box-sizing:border-box; }
          .safety-high{ background: #DFF6E8; color: #0B3A1E; border: 1px solid rgba(11,58,30,0.14); }
          .safety-mid{ background: #FFF9DB; color: #665800; border: 1px solid rgba(102,88,0,0.12); }
          .safety-low{ background: #FFEDED; color: #661414; border: 1px solid rgba(102,20,20,0.12); }
          /* (removed) previously used small prioritized badge */
          /* Why badges */
          .why-badge { display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:9999px; background: rgba(16,42,67,0.04); color: #39495B; font-size:11px; font-weight:600; margin-right:6px; }
          @media (max-width:1000px){ .reco-right{ border-left: none; padding-left: 0; min-width: 90px; } .reco-card{ min-height:48px; } }
          @media (max-width:900px){ .reco-card{ flex-direction: column; } .reco-right{ width:100%; margin-left:0; order:2; padding-top:8px; } .reco-left .title{ max-width:100%; } }
        `}</style>
        <div style={{ width: '100%', maxWidth: '100%', margin: '0 auto', color: '#102A43' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 12px', color: '#102A43' }}>Min portfölj</h1>

          <div className="mp-grid">
            {/* Left column */}
            <div className="mp-left">
              {/* Portfolio value card */}
              <div className="mp-card-full portfolio-card" style={{ background: CARD_BG, borderRadius: CARD_BORDER_RADIUS, padding: 14, boxShadow: GLOW, border: CARD_BORDER, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#5E625F' }}>PORTFÖLJVÄRDE</div>
                    <div style={{ fontSize: 36, fontWeight: 700, marginTop: 6, color: '#102A43' }}>2 354 200 kr</div>
                    <div style={{ marginTop: 8, fontSize: 14, color: '#39495B' }}><span className="portfolio-change" style={{ color: STATUS_COLORS.green }}>+18 420 kr idag</span> · <span className="portfolio-total">+14,8 % totalt</span></div>
                  </div>

                  {/* Period selector */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {['1D','1V','1M','1Å','ALL'].map((p)=> (
                      <div key={p} className={`period-button ${p==='1Å'?'active':''}`} style={{ fontSize: 12, padding: '6px 8px', borderRadius: 8, color: '#39495B', background: p==='1Å' ? '#E9E1D2' : 'transparent' }}>{p}</div>
                    ))}
                  </div>
                </div>

                {/* Line chart (simple SVG) */}
                <div style={{ marginTop: 10 }}>
                  <PortfolioLineChart width={880} height={102} />
                </div>
              </div>

              {/* Allocation + holdings */}
              {/* New section: MINA INNEHAV inserted directly under the portföljgraf */}
              <MinaInnehav />

              <div style={{ display: 'flex', gap: 12 }}>
                <div className="mp-card-full" style={{ flex: 1, background: BG_LIGHT, borderRadius: CARD_BORDER_RADIUS, padding: CARD_PADDING }}>
                  <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, marginBottom: 8 }}>PORTFÖLJFÖRDELNING</div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <DonutDistribution size={160} segments={[{label:'Aktier', pct:68, color: STATUS_COLORS.green},{label:'ETF', pct:22, color: STATUS_COLORS.yellow},{label:'Likvida medel', pct:8, color: 'rgba(0,0,0,0.12)'},{label:'Övrigt', pct:2, color: 'rgba(0,0,0,0.06)'}]} total={2354200} />
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <LegendRow color={STATUS_COLORS.green} label="Aktier" pct={68} amount={1600856} />
                                <LegendRow color={STATUS_COLORS.yellow} label="ETF" pct={22} amount={517924} />
                                <LegendRow color={'rgba(0,0,0,0.12)'} label="Likvida medel" pct={8} amount={188336} />
                                <LegendRow color={'rgba(0,0,0,0.06)'} label="Övrigt" pct={2} amount={47084} />
                              </div>
                            </div>
                          </div>
                </div>

                {/* Large holdings card removed from left column; moved to right column under Risköversikt */}
              </div>
            </div>

            {/* Right column */}
            <div className="mp-right" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Victor top card */}
              <div style={{ background: 'linear-gradient(180deg,#0B243D 0%, #071827 100%)', borderRadius: CARD_BORDER_RADIUS, padding: 12, color: '#FFFDF8', boxSizing: 'border-box', boxShadow: '0 6px 16px rgba(2,12,20,0.18)', border: '1px solid rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 9999, background: '#071827', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, color: '#D4AF37' }}>V</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#D4AF37', marginBottom: 2, letterSpacing: 0.6 }}>VICTOR</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#FFFDF8', marginTop: 4 }}>{pageMocks.dailyVictorGreeting}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#E4EAF0', lineHeight: 1.36, marginBottom: 8, maxWidth: 320 }}>
                  Jag har redan gått igenom marknaden, nyhetsflödet och din portfölj. Det finns två saker jag tycker att du bör prioritera idag.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 9999, background: STATUS_COLORS.green, display: 'inline-block' }} />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Analys uppdaterad 07:42</div>
                </div>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pageMocks.dailyFocusItems.map((it, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 4px', borderRadius: 6 }} onMouseEnter={(e)=> (e.currentTarget.style.background='rgba(255,255,255,0.02)')} onMouseLeave={(e)=> (e.currentTarget.style.background='transparent')}>
                        <div style={{ display:'flex', gap:10, alignItems:'flex-start', minWidth:0 }}>
                          <div style={{ width:8, height:8, borderRadius:9999, background: it.tag === 'Hög prioritet' ? '#FF6B4C' : '#F2C94C', marginTop:6 }} />
                          <div style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
                            <div style={{ fontSize:10, textTransform:'uppercase', color:'rgba(255,255,255,0.7)', letterSpacing:0.6 }}>{it.tag}</div>
                            <div style={{ fontSize:13, color: 'rgba(255,255,255,0.92)', whiteSpace:'normal' }}>{it.text}</div>
                          </div>
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize:13 }}>→</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button style={{ background: '#D4AF37', color: '#071025', border: 'none', padding: '4px 8px', borderRadius: 6, fontWeight:700, fontSize:13, cursor:'pointer' }}>Visa Victors analys →</button>
                  </div>
                </div>
                <VictorTradingControl />
              </div>

              {/* Action items removed per request: replaced by Victor recommendations in left column */}

              {/* PORTFÖLJHÄLSA — finjusterad per krav: centrerad score, grid 96px, tunn ring, premium faktorer, footer */}
              <div className="mp-card-full" style={{ background: CARD_ALT_BG, borderRadius: CARD_BORDER_RADIUS, padding: 18, color: '#142438', boxSizing: 'border-box', border: CARD_BORDER, boxShadow: '0 6px 14px rgba(16,42,67,0.06)', overflow: 'hidden' }}>
                <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, marginBottom: 8 }}>PORTFÖLJHÄLSA</div>

                {/* Compact score row: grid 92px + text, align-items start to keep circle top-left */}
                <div style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', gap: 20, alignItems: 'start', minWidth: 0 }}>
                  <div style={{ width: 88, height: 88, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                    <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
                      <defs>
                        <linearGradient id="pfGrad" x1="0%" x2="100%">
                          <stop offset="0%" stopColor="#10A37F" />
                          <stop offset="100%" stopColor="#0B6A2F" />
                        </linearGradient>
                      </defs>
                      <circle cx="44" cy="44" r="40" fill="#FFFFFF" stroke="rgba(16,42,67,0.04)" strokeWidth="1" />
                      <circle cx="44" cy="44" r="34" fill="none" stroke="rgba(16,42,67,0.06)" strokeWidth="8" strokeLinecap="round" />
                      <circle cx="44" cy="44" r="34" fill="none" stroke="url(#pfGrad)" strokeWidth="8" strokeLinecap="round" strokeDasharray="213.628" strokeDashoffset="16.2904" transform="rotate(-90 44 44)" />
                      <text x="44" y="40" textAnchor="middle" fontSize="26" fontWeight="800" fill="#102A43">92</text>
                      <text x="44" y="56" textAnchor="middle" fontSize="11" fill="#5E625F" fontWeight="600">/100</text>
                    </svg>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight:700, color:'#102A43', marginBottom:6 }}>Mycket god</div>
                    <div style={{ marginTop:0, fontSize:13, color:'#626761', lineHeight:1.55, textAlign:'left', maxWidth:'100%', minWidth:0 }}>
                      Victor bedömer portföljen som välbalanserad. Teknikandelen står fortfarande för den största delen av risken.
                    </div>
                  </div>
                </div>

                {/* Faktorrader: grid per row to prevent truncation; no ellipsis */}
                <div style={{ display:'flex', flexDirection:'column', gap:16, marginTop:8, minWidth:0 }}>
                  {[
                    { label: 'Diversifiering', status: 'Mycket bra', pct: 92, color: STATUS_COLORS.green },
                    { label: 'Risk', status: 'Medel', pct: 62, color: '#F2994A' },
                    { label: 'Likviditet', status: 'Bra', pct: 78, color: STATUS_COLORS.green }
                  ].map((f, i) => (
                    <div key={i} style={{ display:'grid', gridTemplateColumns: 'minmax(0, 1fr) auto 38px', columnGap:10, alignItems:'center', gap:8, minWidth:0 }}>
                      <div style={{ fontSize:13, color:'#39495B' }}>{f.label}</div>
                      <div style={{ fontSize:13, fontWeight:600, color:'#102A43', textAlign:'right' }}>{f.status}</div>
                      <div style={{ fontSize:12, color:'#5E625F', textAlign:'right' }}>{f.pct}%</div>
                      <div style={{ gridColumn: '1 / -1', width:'100%', height:8, background:'#F3F6F8', borderRadius:9999, overflow:'hidden' }}>
                        <div style={{ width:`${f.pct}%`, height:'100%', background: f.color, borderRadius:9999 }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Footer removed per request; card ends after last progress row */}
              </div>
              {/* Compact holdings placed under Risköversikt (show top 6) */}
              <div className="mp-card-full compact-holdings" style={{ background: CARD_ALT_BG, borderRadius: CARD_BORDER_RADIUS, padding: 10, boxSizing: 'border-box', border: CARD_BORDER, boxShadow: '0 6px 12px rgba(16,42,67,0.03)' }}>
                <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, marginBottom: 8 }}>Dina innehav</div>

                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  {displayHoldings.map((h, idx) => {
                    const isHovered = canHover && hoverIdx === idx;
                    const isExpanded = expandedIdx === idx;
                    const analysis = analysisByHoldingId[h.id];
                    const q = quotesById[h.id];
                    const currentPrice = (q && q.price !== null && q.price !== undefined) ? Number(q.price) : (h.now ? Number(String(h.now).replace(',','.')) : null);
                    const currency = (q && q.currency) ? String(q.currency) : 'SEK';
                    const marketValueNum = (currentPrice !== null && currentPrice !== undefined && Number.isFinite(Number(currentPrice))) ? Math.round(currentPrice * Number(h.qty) * 100) / 100 : (parseInt((h.value || '0').toString().replace(/\s+/g, ''), 10) || 0);
                    const pctRaw = (q && (q.changePercent !== null && q.changePercent !== undefined)) ? Number(q.changePercent) : null;
                    const displayPct = (quoteStatus === 'loading' && !q) ? 'Hämtar kurs...' : (pctRaw !== null ? formatPercent(pctRaw) : (String(h.today || '').trim() || '0,0 %'));
                    const pctColor = (pctRaw !== null) ? (pctRaw > 0 ? STATUS_COLORS.green : pctRaw < 0 ? '#DC2626' : '#6B7280') : '#6B7280';
                    const displayMarketValue = (q && currency === 'SEK') ? formatCurrency(marketValueNum, currency) : (q ? (formatCurrency(marketValueNum, currency) + (currency !== 'SEK' ? ` (${currency})` : '')) : (h.value ? h.value + ' kr' : formatCurrency(marketValueNum, 'SEK')));

                    return (
                      <div key={h.name} style={{ padding: '8px 0', boxSizing: 'border-box', borderBottom: idx === displayHoldings.length - 1 ? 'none' : SEPARATOR_LIGHT, minHeight: 58 }}>
                        <div
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e)=>{ if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedIdx(prev => prev === idx ? null : idx); } }}
                          onClick={() => setExpandedIdx(prev => prev === idx ? null : idx)}
                          onMouseEnter={() => { if(canHover) setHoverIdx(idx); }}
                          onMouseLeave={() => { if(canHover) setHoverIdx(null); }}
                          style={{ display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr) auto 18px', columnGap: 10, alignItems: 'center', minWidth:0, cursor: 'pointer', transition: 'background 160ms ease, box-shadow 160ms ease', padding: '8px 4px', borderRadius: 4, background: isHovered ? 'rgba(250,244,236,0.45)' : 'transparent' }}
                        >
                          <div style={{ width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center' }}>
                            <CompanyLogo symbol={h.name==='Microsoft' ? 'MSFT' : h.name==='Investor' ? 'INVE-B.ST' : h.name==='Atlas Copco' ? 'ATCO-A.ST' : h.name==='Novo Nordisk' ? 'NOVO-B' : h.name==='Telia' ? 'TELIA.ST' : ''} name={h.name} size={34} innerPadding={6} />
                          </div>

                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:14, fontWeight:600, color:'#142438', lineHeight:1.05 }}>{h.name}</div>
                            <div style={{ marginTop:4, fontSize:13, color:'#6B7280', lineHeight:1, display:'flex', gap:8, alignItems:'center' }}>
                              <div>Idag:</div>
                              <div style={{ color: pctColor, fontWeight:700 }}>{displayPct}</div>
                            </div>
                          </div>

                          <div style={{ textAlign:'right', fontSize:15, fontWeight:600, color:'#102A43', whiteSpace:'nowrap' }}>{displayMarketValue}</div>

                          <div style={{ display:'flex', justifyContent:'center', alignItems:'center' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </div>
                        </div>

                        {/* Expanded detail panel: prefer existing detailed mock if available */}
                        {isExpanded ? (
                          <div style={{ marginTop:8, marginLeft: 46, minWidth: 0, overflowX: 'hidden', overflowY: 'visible' }}>
                            <div className="expanded-panel" style={{ padding: '16px 16px 18px', height: 'auto', overflowX: 'hidden', overflowY: 'visible', minWidth: 0, borderTop: SEPARATOR_LIGHT }}>
                                <div style={{ fontSize:14, fontWeight:700, color:'#102A43' }}>Victors analys av {h.name}</div>

                                <div style={{ marginTop:8, fontSize:13, fontWeight:700, color:'#142438', lineHeight:1.3 }}>{(analysis?.actionNow || h.victorHoverInsight || 'Victor har ingen ytterligare kommentar.')}</div>

                                <div style={{ marginTop:12, display:'grid', gridTemplateColumns: '1fr auto', rowGap:10, columnGap:10 }}>
                                  <div style={{ fontSize:12, color:'#626761' }}>Anskaffningsvärde</div>
                                  <div style={{ fontSize:14, fontWeight:700, textAlign:'right' }}>{(analysis?.acquisitionValue || 0).toLocaleString('sv-SE')} kr</div>

                                  <div style={{ fontSize:12, color:'#626761' }}>Värdeutveckling</div>
                                  <div style={{ fontSize:14, fontWeight:700, textAlign:'right', color: (analysis?.valueChange || 0) >= 0 ? STATUS_COLORS.green : '#DC2626' }}>{((analysis?.valueChange || 0) >= 0 ? '+' : '-') + Math.abs(analysis?.valueChange || 0).toLocaleString('sv-SE') + ' kr'}</div>

                                  <div style={{ fontSize:12, color:'#626761' }}>Totalt värde</div>
                                  <div style={{ fontSize:14, fontWeight:700, textAlign:'right' }}>{(analysis?.totalValue || 0).toLocaleString('sv-SE')} kr</div>

                                  <div style={{ fontSize:12, color:'#626761' }}>Förändring</div>
                                  <div style={{ fontSize:14, fontWeight:700, textAlign:'right', color: (analysis?.percentChange || 0) < 0 ? '#DC2626' : STATUS_COLORS.green }}>{((analysis?.percentChange || 0) >= 0 ? '+' : '-') + Math.abs((analysis?.percentChange || 0)).toString().replace('.',',') + ' %'}</div>
                                </div>

                                <div style={{ marginTop: 14 }}>
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); openFullAnalysis(h); }}
                                    onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); openFullAnalysis(h); } }}
                                    style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1.4, paddingBottom: 2, whiteSpace: 'nowrap', fontSize:13, color:'#102A43', cursor:'pointer' }}
                                  >Öppna hela analysen →</div>
                                </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  <div style={{ display:'flex', justifyContent:'center', marginTop:12 }}>
                    <div className="view-all-link" style={{ color:'#6B7280', fontWeight:600 }}>Visa alla innehav →</div>
                  </div>
                </div>
              </div>
              {/* VARFÖR IDAG? card */}
              <div className="mp-card-full" style={{ background: CARD_BG, borderRadius: CARD_BORDER_RADIUS, padding: 10, boxSizing: 'border-box', border: CARD_BORDER, boxShadow: GLOW, marginTop: 12 }}>
                <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, marginBottom: 6 }}>VARFÖR IDAG?</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#102A43', marginBottom: 8 }}>+18 420 kr idag</div>

                {/* Top 3 contributions (mock), more compact */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    { name: 'Microsoft', symbol: 'MSFT', amt: 4200 },
                    { name: 'Investor', symbol: 'INVE-B.ST', amt: 3100 },
                    { name: 'Ericsson', symbol: 'ERIC-B.ST', amt: -1400 },
                  ].map((c)=> (
                    <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 2px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <CompanyLogo symbol={c.symbol} name={c.name} size={30} className="contrib-logo" />
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#142438' }}>{c.name}</div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: c.amt >= 0 ? STATUS_COLORS.green : '#DC2626' }}>{(c.amt >=0 ? '+' : '-') + Math.abs(c.amt).toLocaleString('sv-SE') + ' kr'}</div>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: SEPARATOR_LIGHT, marginTop: 8, paddingTop: 8 }}>
                  <div style={{ padding: 2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#142438' }}>🤖 Victors slutsats</div>
                      <div style={{ fontSize: 12, padding: '4px 8px', borderRadius: 9999, background: 'rgba(16,42,67,0.06)', fontWeight:700 }}>AI‑konfidens 92 %</div>
                    </div>
                    <div style={{ fontSize: 12, color: '#626761', marginTop: 8, lineHeight: 1.3 }}>
                      <div><strong>78 %</strong> av dagens uppgång förklaras av ett fåtal innehav.</div>
                      <div style={{ marginTop: 6 }}>Marknaden är koncentrerad till <strong>Microsoft</strong> och <strong>Investor</strong>.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Full analysis modal (reused for all holdings) */}
          {fullAnalysisOpen && (
            <div style={{ position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(2,6,23,0.45)', zIndex:60 }} onClick={()=> setFullAnalysisOpen(false)}>
              <div role="dialog" aria-modal style={{ width: 'min(920px, 96%)', maxHeight: '80vh', overflowY: 'auto', background: '#fff', borderRadius: 12, padding: 18 }} onClick={(e)=> e.stopPropagation()}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
                  <div style={{ fontSize:16, fontWeight:800 }}>Victors fulla analys</div>
                  <div style={{ cursor:'pointer', color:'#6B7280', fontWeight:700 }} onClick={()=> setFullAnalysisOpen(false)}>Stäng</div>
                </div>
                <div style={{ marginTop:12 }}>
                  <VictorsInvestmentReportPanel report={fullAnalysisReport} />
                  <VictorsAnalysisPanel intelligence={{ overallSentiment: fullAnalysisReport?.overallRating || '', overallScore: fullAnalysisReport?.overallScore, marketConfidence: fullAnalysisReport?.confidence, opportunities: fullAnalysisReport?.opportunities || [], threats: fullAnalysisReport?.risks || [], contradictions: [], missingInformation: [] }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function PortfolioLineChart({ width = 600, height = 120 }: { width?: number; height?: number }){
  // Simple mock data points (positive trend)
  const points = [0.86,0.9,0.92,0.95,0.97,1.02,1.05,1.08,1.12,1.14,1.148];
  const max = Math.max(...points);
  const min = Math.min(...points);
  const pad = 8;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const path = points.map((v,i)=>{
    const x = pad + (i/(points.length-1))*innerW;
    const y = pad + (1 - (v-min)/(max-min))*innerH;
    return `${i===0?'M':'L'} ${x} ${y}`;
  }).join(' ');

  // discrete markers for dates (sparse)
  const labels = ['01','01','01','01','01','01','01','01','01','01','01'];

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <rect x={0} y={0} width={width} height={height} fill="transparent" />
      <path d={path} fill="none" stroke={STATUS_COLORS.green} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((v,i)=>{
        const x = pad + (i/(points.length-1))*innerW;
        const y = pad + (1 - (v-min)/(max-min))*innerH;
        return <circle key={i} cx={x} cy={y} r={2.2} fill={STATUS_COLORS.green} />;
      })}
    </svg>
  );
}

function DonutDistribution({ size = 160, segments, total }: { size?: number; segments: {label:string;pct:number;color:string}[]; total: number }){
  const radius = size/2;
  const stroke = 36; // donut thickness
  const circumference = 2 * Math.PI * (radius - stroke/2);
  let offset = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {segments.map((s, idx)=>{
          const dash = (s.pct/100) * circumference;
          const strokeDasharray = `${dash} ${circumference - dash}`;
          const transform = `rotate(-90 ${radius} ${radius})`;
          const circ = (
            <circle key={idx} cx={radius} cy={radius} r={radius - stroke/2} fill="none" stroke={s.color} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="butt" strokeDasharray={strokeDasharray} strokeDashoffset={-offset} transform={transform} />
          );
          offset += dash;
          return circ;
        })}
        <circle cx={radius} cy={radius} r={radius - stroke - 8} fill="#071725" />
        <text x={radius} y={radius-6} textAnchor="middle" fill="#fff" fontSize={20} fontWeight={700}>4</text>
      </svg>
    </div>
  );
}

function LegendRow({ color, label, pct, amount }: { color: string; label: string; pct: number; amount: number }){
  const fmt = amount.toLocaleString('sv-SE');
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ width: 12, height: 12, borderRadius: 4, background: color, display: 'inline-block' }} />
        <div style={{ fontSize: 13 }}>{label}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{pct}%</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>{fmt} kr</div>
      </div>
    </div>
  );
}
function MinaInnehav(){
  // Mock priorities using the new detailed advice structure (DEMO / MOCK)
  const priorities = [
    {
      title: 'Investor B',
      symbol: 'INVE-B.ST',
      company: 'Investor B',
      advice: 'Jag hade ökat mitt innehav i Investor.',
      conclusion: 'Rapporten och den stabila tillväxten väger enligt mig tyngre än den något höga värderingen.',
      workCompleted: [
        'Analyserat de senaste 30 handelsdagarna',
        'Läst bolagets senaste rapport',
        'Jämfört värderingen med 5-årssnittet'
      ],
      keyFactors: ['Stark rapport ++', 'Positivt nyhetsflöde +', 'Hög värdering -'],
      reasoning: 'Den starka rapporten och förbättrade kassaflöden väger enligt mig tyngre än den något höga värderingen.',
      counterSignals: ['Värderingen är hög', 'Kortsiktig volatilitet kan öka'],
      changeTriggers: ['Tillväxtprognosen sänks nästa kvartal', 'Marginalpress i kommande rapport'],
      confidence: 92,
      analyzedAt: 'för 4 minuter sedan',
      changesSincePrevious: ['Rapporten överträffade förväntningarna', 'Två analytiker höjde prognoser'],
      sourcesCount: 12,
      isPriority: true,
      hasChangedOpinion: true,
      previousAdvice: 'Jag hade avvaktat.',
      currentAdvice: 'Jag hade ökat mitt innehav i Investor.',
      action: 'KÖP',
      mockNote: 'mock',
      // portfolio-specific mock fields
      currentValue: 20700,
          suggestedValue: 25000,
      currentWeight: 8.8,
      suggestedWeight: 10.6,
      suggestedChangePercent: 20
    },
    {
      title: 'NVIDIA',
      symbol: 'NVDA',
      company: 'NVIDIA',
      advice: 'Jag hade minskat exponeringen mot NVIDIA just nu.',
      conclusion: 'Den tekniska nedgången och den höga värderingen gör risk/reward mindre attraktiv på kort sikt.',
      workCompleted: [
        'Analyserat de senaste 30 handelsdagarna',
        'Granskat 42 relevanta nyhetsartiklar',
        'Jämfört pris/multiplar mot historiskt snitt'
      ],
      keyFactors: ['Svagare momentum -', 'Hög värdering -', 'Stark långsiktig efterfrågan +'],
      reasoning: 'Tekniska svagheter och nyhetsbilden väger tyngre just nu; dock finns långsiktiga positiva faktorer.',
      counterSignals: ['Starkt fundament på längre sikt'],
      changeTriggers: ['Klar nedgång i efterfrågan eller positiva intäktssiffror vid nästa kvartal'],
      confidence: 81,
      analyzedAt: 'för 12 minuter sedan',
      changesSincePrevious: ['Ökad volatilitet', 'Negativa kortsiktiga signaler i teknisk analys'],
      sourcesCount: 42,
      isPriority: false,
      hasChangedOpinion: false,
      previousAdvice: 'Jag rekommenderade tidigare att behålla.',
      currentAdvice: 'Jag hade minskat exponeringen mot NVIDIA just nu.',
      action: 'SÄLJ',
      mockNote: 'mock',
      currentValue: 5200,
          // suggestedValue omitted intentionally to show percent-based recommendation
      currentWeight: 7.4,
      suggestedWeight: 6.3,
      suggestedChangePercent: -15
    },
    {
      title: 'Evolution',
      symbol: 'EVO.ST',
      company: 'Evolution',
      advice: 'Jag hade avvaktat tills jag såg tydligare styrka.',
      conclusion: 'Signalbilden är fortfarande blandad och jag vill se tydligare momentum innan jag agerar.',
      workCompleted: [
        'Analyserat de senaste 30 handelsdagarna',
        'Granskat kvartalsrapporten',
        'Jämfört värdering mot 5-årssnittet'
      ],
      keyFactors: ['Svagt momentum -', 'Osäker volym -', 'Något förbättrad marginal +'],
      reasoning: 'Osäker trend och svag volym talar för försiktighet; väntar på klarare signaler.',
      counterSignals: ['Svag volymstöd'],
      changeTriggers: ['Brott upp genom motstånd med ökad volym'],
      confidence: 68,
      analyzedAt: 'för 2 timmar sedan',
      changesSincePrevious: ['Ingen större förändring i data'],
      sourcesCount: 7,
      isPriority: false,
      hasChangedOpinion: false,
      previousAdvice: 'Jag rekommenderade tidigare att avvakta.',
      currentAdvice: 'Jag hade avvaktat tills jag såg tydligare styrka.',
      action: 'AVVAKTA',
      mockNote: 'mock',
      currentValue: 11200,
      suggestedValue: 11200,
      currentWeight: 3.2,
      suggestedWeight: 3.2,
      suggestedChangePercent: 0
    }
  ];
  const priorityIndex = priorities.findIndex(pr=> pr.isPriority);

  const timeline = [
    { symbol: 'MSFT', title: 'Microsoft', desc: '+3,2 % sedan igår', time: 'för 2 timmar sedan' },
    { symbol: 'INVE-B.ST', title: 'Investor', desc: 'Köper nytt innehav enligt rapport', time: 'idag 08:15' },
    { symbol: 'NVDA', title: 'NVIDIA', desc: 'AI‑score ändrad A → B', time: 'idag' },
    { symbol: 'VOLV-B.ST', title: 'Volvo', desc: 'Utdelning imorgon', time: 'imorgon' },
    { icon: '🌍', title: 'OMXS30', desc: '+1,1 % — USA stängde på plus', time: 'igår' },
    { icon: '🏛️', title: 'Fed', desc: 'Förväntningar inför mötet', time: 'igår 22:00' },
  ];

  // Victor phrasing pools (mock) — ordered from neutral -> strong
  const VICTOR_PHRASES: Record<string, string[]> = {
    BUY: [
      'Jag hade köpt.',
      'Jag hade ökat innehavet.',
      'Jag tycker aktien ser attraktiv ut.',
      'Jag ser ett bra köpläge.',
      'Det här är ett av marknadens mest attraktiva lägen just nu.'
    ],
    SELL: [
      'Jag hade sålt.',
      'Jag hade minskat innehavet.',
      'Jag tycker risken blivit för hög.',
      'Jag hade tagit hem en del vinst.',
      'Jag hade lämnat innehavet helt.'
    ],
    HOLD: [
      'Jag hade behållit.',
      'Jag hade inte gjort någon förändring.',
      'Jag tycker nuvarande exponering är rimlig.'
    ],
    WAIT: [
      'Jag hade avvaktat.',
      'Jag vill se fler signaler först.',
      'Jag tycker det är för tidigt att agera.',
      'Jag ser ännu inget tydligt övertag.'
    ]
  };

  function generateMotivation(p: any){
    if (p.ai && String(p.ai).trim().length > 0) return p.ai;
    if (p.fact && String(p.fact).trim().length > 0) return String(p.fact);
    if (p.reasons && p.reasons.length) return p.reasons.slice(0,2).join(' · ');
    return 'Victor anger inga ytterligare detaljer.';
  }

  function victorPhrase(actionRaw: string, confidence = 0, seed = 0){
    const a = actionRaw.toUpperCase();
    let pool = VICTOR_PHRASES.WAIT;
    if (a.includes('KÖP')) pool = VICTOR_PHRASES.BUY;
    else if (a.includes('SÄLJ')) pool = VICTOR_PHRASES.SELL;
    else if (a.includes('BEH')) pool = VICTOR_PHRASES.HOLD;

    // Choose phrase index based on confidence: higher confidence -> stronger phrasing
    const max = pool.length;
    let idx = 0;
    if (confidence >= 90) idx = Math.min(max - 1, 4);
    else if (confidence >= 75) idx = Math.min(max - 1, 3);
    else if (confidence >= 60) idx = Math.min(max - 1, 2);
    else idx = 0;

    // deterministic fallback using seed to vary between items with same confidence
    idx = Math.min(max - 1, (idx + Math.abs(seed)) % max);
    return pool[idx];
  }

  const ANALYSIS_POOL = ['Fundamental analys','Teknisk analys','Nyhetsflöde','Makro','Portföljrisk','Värdering'];
  function pickAnalyses(p:any, idx:number){
    const conf = p.confidence || 0;
    const count = conf >= 75 ? 4 : 3;
    const out: string[] = [];
    for(let i=0;i<count;i++) out.push(ANALYSIS_POOL[(idx + i) % ANALYSIS_POOL.length]);
    return out;
  }

  const headingColor = '#102A43';
  const textColor = '#142438';
  const secondary = '#626761';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
          <div className="mp-card-full" style={{ background: CARD_BG, borderRadius: CARD_BORDER_RADIUS, padding: CARD_PADDING, boxSizing: 'border-box', border: CARD_BORDER, boxShadow: GLOW }}>
        <div style={{ padding: 12 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: headingColor }}>SEDAN DU SENAST ÖPPNADE ATLAS</div>
            <div style={{ fontSize: 13, color: secondary, marginTop: 4 }}>Här är det viktigaste som har hänt sedan ditt senaste besök.</div>
          </div>

          <div className="recent-grid">
            {timeline.map((t, idx)=>(
              <div key={idx} className="recent-event" onMouseEnter={(e)=> (e.currentTarget.style.background = 'rgba(16,42,67,0.02)')} onMouseLeave={(e)=> (e.currentTarget.style.background = 'transparent')}>
                {t.symbol ? (
                  <CompanyLogo symbol={t.symbol} name={t.title} size={36} innerPadding={6} className="icon" />
                ) : (
                  <div className="icon">{t.icon}</div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div className="title">{t.title}</div>
                    <div className="meta">{t.time}</div>
                  </div>
                  <div className="desc">{t.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid rgba(16,42,67,0.04)', marginTop: 8, paddingTop: 8 }}>
            <div className="recent-footer"><div style={{ fontSize: 13, color: textColor, cursor: 'pointer' }}>Visa alla händelser →</div></div>
          </div>
        </div>
      </div>

      <div className="mp-card-full" style={{ background: CARD_BG, borderRadius: CARD_BORDER_RADIUS, padding: CARD_PADDING, boxSizing: 'border-box', border: CARD_BORDER, boxShadow: GLOW }}>
        <div style={{ padding: 12 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: headingColor }}>DINA VIKTIGASTE ÅTGÄRDER IDAG</div>
            <div style={{ fontSize: 13, color: secondary, marginTop: 4 }}>Victor har analyserat din portfölj och valt ut de viktigaste besluten för idag.</div>
          </div>

          <div className="reco-list" style={{ display: 'flex', gap: 12 }}>
            {priorities.map((p, idx)=>{
              const actionRaw = (p.action || 'BEHÅLL').toString().toUpperCase();
              const conf = (p.confidence || 0);
              // choose a mock phrase (use idx as seed for stability), but enforce buy/sell confidence rules
              let label = victorPhrase(actionRaw, conf, idx);
              let decClass = 'dec-watch';
              let icon = '⏳';
              if (actionRaw.includes('KÖP')) { decClass = 'dec-buy'; icon = '↑'; }
              else if (actionRaw.includes('SÄLJ')) { decClass = 'dec-sell'; icon = '↓'; }
              else if (actionRaw.includes('BEH')) { decClass = 'dec-hold'; icon = '✓'; }
              else { decClass = 'dec-watch'; icon = '⏳'; }
              // Enforce that strong buy/sell require confidence >=75 and at least 2 supporting signals
              const signals = (p.workCompleted && p.workCompleted.length) || 0;
              if ((actionRaw.includes('KÖP') || actionRaw.includes('SÄLJ')) && (conf < 75 || signals < 2)){
                // downgrade to avvaktat phrasing
                label = victorPhrase('WAIT', conf, idx);
                decClass = 'dec-watch';
                icon = '⏳';
              }
              const adviceText = p.advice || victorPhrase(actionRaw, conf, idx);
              const summaryText = p.conclusion || generateMotivation(p);
              const evidences = (p.workCompleted || []).slice(0,3);
              const moreEvidence = (p.workCompleted || []).length > 3;
              const counters = (p.counterSignals || []).slice(0,2);
              const triggers = (p.changeTriggers || []).slice(0,1);
              const factors = (p.keyFactors || []).slice(0,3);
              const analyzedAt = p.analyzedAt || 'för något sedan';
                return (
                <div key={p.title} className={`reco-card ${idx===priorityIndex ? 'primary' : idx===1? 'secondary' : 'tertiary'}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12 }}>
                {/* Middle: logo + text + AI motivation + compact why chips */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flex: 1 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize:11, color:'rgba(16,42,67,0.6)' }}>
                        { (idx===0 || idx===1) ? 'Ny analys klar' : 'Senast analyserad' } • {analyzedAt}
                      </div>

                      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
                        <div style={{ fontSize:11, color:'rgba(16,42,67,0.6)', display:'inline-flex', alignItems:'center', gap:6 }}><span style={{ width:18, height:18, borderRadius:8, display:'inline-flex', alignItems:'center', justifyContent:'center', background:'rgba(16,42,67,0.06)', color:'#102A43', fontSize:12 }}>💬</span>Victor rekommenderar</div>
                      </div>

                      <div className="advice-text" style={{ color: decClass.includes('buy') ? '#0B6A2F' : decClass.includes('sell') ? '#a11a1a' : '#083063' }}>{adviceText}</div>

                      <div className="conclusion">{summaryText}</div>

                      {/* (changed-opinion box moved lower) */}

                      {/* Concrete portfolio suggestion (approximate, mock-only) */}
                      {(p.suggestedValue !== undefined || p.suggestedChangePercent !== undefined) ? (
                        <div style={{ marginTop:6, fontSize:12, color:'#39495B', display:'flex', flexDirection:'column', gap:6 }}>
                          <div style={{ display:'flex', gap:8, alignItems:'baseline' }}>
                            <div style={{ fontSize:12, color:'#626761' }}>Mitt förslag</div>
                            <div style={{ fontSize:13, fontWeight:600, color:'#142438' }}>{p.currentValue !== undefined && p.suggestedValue !== undefined ? (
                              <>{'Öka från '}{p.currentValue.toLocaleString('sv-SE')} kr <span style={{ opacity:0.8, margin:'0 6px' }}>→</span> {'cirka ' + (Math.round((p.suggestedValue||0)/1000)*1000).toLocaleString('sv-SE') + ' kr'}</>
                            ) : p.suggestedChangePercent !== undefined && p.suggestedChangePercent !== 0 ? (
                              <>{p.suggestedChangePercent > 0 ? 'Öka' : 'Minska'} innehavet med cirka {Math.abs(p.suggestedChangePercent)} %</>
                            ) : (
                              <>Gör ingen förändring just nu</>
                            )}</div>
                          </div>

                          {p.suggestedWeight !== undefined ? (
                            <div style={{ display:'flex', gap:8, alignItems:'baseline' }}>
                              <div style={{ fontSize:12, color:'#626761' }}>Portföljvikt</div>
                              <div style={{ fontSize:13, fontWeight:600, color:'#142438' }}>{p.currentWeight.toLocaleString('sv-SE', {minimumFractionDigits:1, maximumFractionDigits:1})} % <span style={{ opacity:0.8, margin:'0 6px' }}>→</span> {p.suggestedWeight.toLocaleString('sv-SE', {minimumFractionDigits:1, maximumFractionDigits:1})} %</div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:6 }}>
                        {(p.workCompleted||[]).slice(0,2).map((w:string,i:number)=>(
                          <div key={i} style={{ fontSize:12, color:'#39495B', display:'flex', gap:8, alignItems:'center' }}><span style={{ color:'#16A34A' }}>✓</span><span>{w}</span></div>
                        ))}
                      </div>

                      {/* Change note box (only when opinion changed) - placed after analysis rows and before expand */}
                      {p.hasChangedOpinion && idx===priorityIndex ? (
                        <div className="changed-box" style={{ marginTop:8, maxWidth: '66%' }}>
                          <span className="icon">💬</span>
                          <div>Ny information gjorde att jag ändrade min rekommendation idag.</div>
                        </div>
                      ) : null}

                      <details style={{ marginTop:6 }}>
                        <summary style={{ fontSize:13, color:'#6B7280', cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>Visa hur jag resonerade <span style={{ fontSize:12 }}>▾</span></summary>
                        <div style={{ marginTop:8 }}>
                          <div style={{ fontSize:14, fontWeight:700 }}>Jag gjorde en ny analys av {p.title} {analyzedAt}. Här är det viktigaste jag kom fram till.</div>

                          <div style={{ marginTop:8 }}>
                            <div style={{ fontSize:13, fontWeight:700, marginBottom:6 }}>Därför tycker jag så</div>
                            <div style={{ fontSize:13, color:'#39495B', lineHeight:1.4 }}>{p.reasoning || p.conclusion}</div>
                          </div>

                          <div style={{ marginTop:10 }}>
                            <div style={{ fontSize:13, fontWeight:700, marginBottom:6 }}>Så här arbetade jag</div>
                            <div style={{ fontSize:13, color:'#39495B', lineHeight:1.6 }}>
                              {(p.workCompleted||[]).map((w:string,i:number)=>(<div key={i} style={{ marginTop:6 }}>{w}.</div>))}
                            </div>
                          </div>

                          <div style={{ marginTop:10 }}>
                            <div style={{ fontSize:13, fontWeight:700, marginBottom:6 }}>Det som talar emot</div>
                            <div style={{ fontSize:13, color:'#39495B' }}>{(p.counterSignals||[]).map((c:string,i:number)=>(<div key={i} style={{ marginTop:6 }}>{c}.</div>))}</div>
                          </div>

                          <div style={{ marginTop:10 }}>
                            <div style={{ fontSize:13, fontWeight:700, marginBottom:6 }}>Jag ändrar min bedömning om</div>
                            <div style={{ fontSize:13, color:'#39495B' }}>{(p.changeTriggers||[]).map((t:string,i:number)=>(<div key={i} style={{ marginTop:6 }}>{t}.</div>)) || 'Inget konkret trigger definierat.'}</div>
                          </div>

                          <div style={{ marginTop:10 }}>
                            <div style={{ fontSize:13, fontWeight:700, marginBottom:6 }}>Sedan min senaste analys</div>
                            <div style={{ fontSize:13, color:'#39495B' }}>{p.previousAdvice ? (<><div>{p.previousAdvice}</div>{(p.changesSincePrevious||[]).map((c:string,i:number)=>(<div key={i} style={{ marginTop:6 }}>{c}.</div>))}</>) : 'Ingen tidigare analys.'}</div>
                          </div>
                        </div>
                      </details>

                      {/* duplicate plain text removed (now shown only in changed-box above) */}
                    </div>
                  </div>

                {/* Right column: confidence + logo */}
                <div className="reco-right">
                  <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                      <div style={{ fontSize:18, fontWeight:700, color:'#102A43' }}>{conf} %</div>
                      <div style={{ fontSize:12, color:'rgba(16,42,67,0.6)' }}>{conf >= 90 ? 'Mycket hög säkerhet' : conf >= 75 ? 'Hög säkerhet' : conf >= 60 ? 'Medel säkerhet' : 'Låg säkerhet'}</div>
                    </div>
                  </div>
                  <div className="logo-wrap" style={{ marginTop: 8 }}>
                    <CompanyLogo symbol={p.symbol} name={p.title} size={96} innerPadding={10} />
                  </div>
                </div>
                {/* Expanded reasoning moved into left column, placed after analysis rows */}
                <div style={{ display: 'none' }} />
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
