"use client";
import React, { useEffect, useState } from 'react';
import ls from '../../lib/local-storage';
import LeftSidebar from '../../components/dashboard-v1/LeftSidebar';

export default function OrderCenterPage(){
  const [pending, setPending] = useState<any[]>([]);
  const [approved, setApproved] = useState<any[]>([]);
  const [declined, setDeclined] = useState<any[]>([]);

  useEffect(()=>{
    try{
      const statuses = ls.loadDecisionStatuses ? ls.loadDecisionStatuses() : {};
      const executed = ls.loadExecutedTrades() || [];
      const lastRun = ls.loadLastRun() || ls.loadPrevLastRun() || null;
      const allDecisions: Record<string, any> = {};
      if (lastRun?.decisions) for(const d of lastRun.decisions) allDecisions[d.id] = d;
      const prev = ls.loadPrevLastRun();
      if (prev?.decisions) for(const d of prev.decisions) allDecisions[d.id] = allDecisions[d.id] || d;

      // Pending: decisions with PENDING_APPROVAL
      const pend: any[] = [];
      for(const id of Object.keys(statuses||{})){
        const s = statuses[id];
        if (s === 'PENDING_APPROVAL'){
          const d = allDecisions[id];
          if (d) pend.push({ id, ...d, status: 'PENDING' });
        }
      }

      // Approved: map executed trades to decisions when possible
      const appr: any[] = executed.map((t: any) => {
        const d = allDecisions[t.orderId];
        return {
          date: lastRun?.runAt || t.runAt || null,
          id: t.orderId,
          symbol: d?.symbol || t.orderId,
          side: d?.action || '-',
          amount: (t.executedPrice || 0) * (t.quantity || 0),
          quantity: t.quantity,
          confidence: d?.confidence ?? '-',
          status: 'APPROVED',
        };
      });

      // Declined: statuses === DECLINED
      const decl: any[] = [];
      for(const id of Object.keys(statuses||{})){
        const s = statuses[id];
        if (s === 'DECLINED'){
          const d = allDecisions[id];
          decl.push({ id, symbol: d?.symbol || id, side: d?.action || '-', amount: (d?.suggestedQuantity||0) * (d?.suggestedPrice||0), quantity: d?.suggestedQuantity || '-', confidence: d?.confidence ?? '-', status: 'DECLINED', date: lastRun?.runAt || null });
        }
      }

      setTimeout(()=>{ setPending(pend); setApproved(appr); setDeclined(decl); }, 0);
    }catch(e){
      setTimeout(()=>{ setPending([]); setApproved([]); setDeclined([]); }, 0);
    }
  }, []);

  const row = (r: any) => (
    <div className="flex items-center gap-4 py-2 border-b" key={r.id}>
      <div className="w-40 text-sm">{r.date ? new Date(r.date).toLocaleString() : '-'}</div>
      <div className="w-28 font-medium">{r.symbol}</div>
      <div className="w-20">{r.side}</div>
      <div className="w-28">{r.amount ? Math.round(r.amount) + ' kr' : '-'}</div>
      <div className="w-20">{r.quantity}</div>
      <div className="w-20">{r.confidence ?? '-'}</div>
      <div className="w-24">{r.status}</div>
    </div>
  );

  return (
    <>
      <LeftSidebar />
      <div style={{ marginLeft: 240 }} className="p-6 panel">
      <h1 className="text-xl font-semibold">Ordercenter</h1>

      <section className="mt-6">
        <h2 className="text-sm font-medium">1. Väntar på godkännande</h2>
        <div className="mt-2 border rounded overflow-hidden">
          <div className="bg-gray-50 p-2 flex font-semibold">
            <div className="w-40">Datum</div>
            <div className="w-28">Tillgång</div>
            <div className="w-20">Köp/Sälj</div>
            <div className="w-28">Belopp</div>
            <div className="w-20">Kvantitet</div>
            <div className="w-20">Confidence</div>
            <div className="w-24">Status</div>
          </div>
          <div>
            {pending.length ? pending.map((p)=> row(p)) : <div className="p-3 text-sm text-gray-500">Inga väntande order.</div>}
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">2. Genomförda affärer</h2>
        <div className="mt-2 border rounded overflow-hidden">
          <div className="bg-gray-50 p-2 flex font-semibold">
            <div className="w-40">Datum</div>
            <div className="w-28">Tillgång</div>
            <div className="w-20">Köp/Sälj</div>
            <div className="w-28">Belopp</div>
            <div className="w-20">Kvantitet</div>
            <div className="w-20">Confidence</div>
            <div className="w-24">Status</div>
          </div>
          <div>
            {approved.length ? approved.map((a)=> row(a)) : <div className="p-3 text-sm text-gray-500">Inga genomförda affärer.</div>}
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">3. Avböjda rekommendationer</h2>
        <div className="mt-2 border rounded overflow-hidden">
          <div className="bg-gray-50 p-2 flex font-semibold">
            <div className="w-40">Datum</div>
            <div className="w-28">Tillgång</div>
            <div className="w-20">Köp/Sälj</div>
            <div className="w-28">Belopp</div>
            <div className="w-20">Kvantitet</div>
            <div className="w-20">Confidence</div>
            <div className="w-24">Status</div>
          </div>
          <div>
            {declined.length ? declined.map((d)=> row(d)) : <div className="p-3 text-sm text-gray-500">Inga avböjda rekommendationer.</div>}
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
