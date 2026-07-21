import React from 'react';
import { CoachDecision } from '../../domain/analysis/types';

export default function DecisionCard({ decision, executed, status, onApprove, onDecline, onShow }: { decision: CoachDecision, executed?: { quantity: number; executedPrice?: number }, status?: string, onApprove?: () => void, onDecline?: () => void, onShow?: () => void }){
  const color = decision.action === 'BUY' ? 'text-green-600' : decision.action === 'SELL' ? 'text-red-600' : decision.action === 'WATCH' ? 'text-yellow-500' : 'text-gray-600';
  return (
    <div className="panel p-4 border rounded">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-500">{decision.symbol} {decision.assetName ? `· ${decision.assetName}` : ''}</div>
          <div className={`text-lg font-semibold ${color}`}>{decision.action} · {decision.confidence}%</div>
        </div>
        <div className="text-xs text-gray-400">Risk: {decision.riskLevel}{status ? ` • ${status}` : ''}</div>
      </div>

      <div className="mt-3 text-sm">
        <div><strong>Vad har hänt?</strong> {decision.whatHappened}</div>
        <div><strong>Vad betyder det?</strong> {decision.whatItMeans}</div>
        <div><strong>Vad gör Atlas?</strong> {decision.whatAtlasWillDo}</div>
        <div className="mt-2"><strong>Argument för:</strong> {decision.reasonsFor.join(', ') || '—'}</div>
        <div><strong>Argument emot:</strong> {decision.reasonsAgainst.join(', ') || '—'}</div>
        <div><strong>Invalidation:</strong> {decision.invalidationConditions.join(', ') || '—'}</div>
        <div className="mt-3">
          <div><strong>Föreslagen kvantitet:</strong> {decision.suggestedQuantity}</div>
          {executed ? <div><strong>Genomförd kvantitet:</strong> {executed.quantity} {executed.executedPrice ? `@ ${executed.executedPrice.toFixed(2)}` : ''}</div> : null}
        </div>
        {/* Approval actions for BUY */}
        {decision.action === 'BUY' ? (
          <div className="mt-3 flex gap-2">
            {status !== 'EXECUTED' && status !== 'DECLINED' ? (
              <>
                <button className="btn bg-blue-600 text-white px-3 py-1 rounded text-sm" onClick={onApprove}>Godkänn köp</button>
                <button className="btn bg-blue-600 text-white px-3 py-1 rounded text-sm" onClick={onShow}>Visa analys</button>
                <button className="btn bg-blue-600 text-white px-3 py-1 rounded text-sm" onClick={onDecline}>Avstå</button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
