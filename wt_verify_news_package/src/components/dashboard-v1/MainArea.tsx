import React from 'react';
import VictorHero from './VictorHero';
import { RECOMMENDATION_LEFT, RECOMMENDATION_WIDTH, RECOMMENDATION_HEIGHT, RECOMMENDATION_TOP } from './layoutConstants';

export default function MainArea(){
  return (
    <div className="min-h-0 min-w-0" style={{ minHeight: 0, minWidth: 0, marginTop: '-16px', position: 'relative' }}>
      <VictorHero />
      <div className="px-6 pb-6">
        {/* Absolute overlay layer with three groups (pointer-events: none on container) */}
        <div className="dashboardOverlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
          {/* Recommendation area: left/mid */}
          <section className="recommendationArea" style={{ pointerEvents: 'auto', position: 'absolute', left: RECOMMENDATION_LEFT, width: RECOMMENDATION_WIDTH, height: RECOMMENDATION_HEIGHT, top: RECOMMENDATION_TOP, boxSizing: 'border-box' }}>
            <div className="bg-white rounded-md p-3 shadow-sm" style={{ width: '100%', height: '100%', backgroundColor: '#e9e5cf', borderRadius: 12 }}>
              <div className="font-medium">MIN VIKTIGASTE REKOMMENDATION IDAG</div>
              <div className="text-xs text-gray-500 mt-2">Kort med dagens rekommendation (mock)</div>
            </div>
          </section>

          {/* Right column: stacked DIN PORTFÖLJ + PORTFÖLJENS HÄLSA */}
            <section className="rightColumn" style={{ pointerEvents: 'auto', position: 'absolute', right: 20, top: 28, width: 434, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ width: '100%', height: 250, transform: 'translateX(-28px) translateY(71px)' }}>
                <div className="rounded-md p-5" style={{ backgroundColor: '#08203a', color: '#fff', borderRadius: 12, height: '100%', boxSizing: 'border-box' }}>
                  <div className="text-sm font-semibold">DIN PORTFÖLJ</div>
                  <div className="mt-3 text-xs text-white/80">Största informationskortet (mock)</div>
                </div>
              </div>

              <div style={{ width: '100%', height: 134, transform: 'translateX(-28px) translateY(66px)' }}>
                <div className="bg-white rounded-md p-3 shadow-sm" style={{ height: '100%', boxSizing: 'border-box', backgroundColor: '#e9e5cf', borderRadius: 12 }}>
                  <div className="font-medium">PORTFÖLJENS HÄLSA</div>
                  <div className="text-xs text-gray-500 mt-2">Sammanfattning av hälsa (mock)</div>
                </div>
              </div>
            </section>

          {/* Bottom row: three cards */}
          <section className="bottomRow" style={{ pointerEvents: 'auto', position: 'absolute', left: 20, right: 20, bottom: -290, height: 177, display: 'flex', gap: 16, boxSizing: 'border-box', zIndex: 25, transform: 'translateX(0.6px)' }}>
            <div style={{ flex: '0 0 calc(41% - 13.5px)', height: '100%' }}>
              <div className="bg-white rounded-md p-3 shadow-sm" style={{ height: '100%', boxSizing: 'border-box', backgroundColor: '#e9e5cf', borderRadius: 12 }}>
                <div className="font-medium">DAGENS MÖJLIGHETER</div>
                <div className="text-xs text-gray-500 mt-2">Bredd: största rutan i nedersta raden (mock)</div>
              </div>
            </div>

            <div style={{ flex: '0 0 calc(22% - 3.5px)', height: '100%', transform: 'translateX(-8px)' }}>
              <div className="bg-white rounded-md p-3 shadow-sm" style={{ height: '100%', boxSizing: 'border-box', backgroundColor: '#e9e5cf', borderRadius: 12 }}>
                <div className="font-medium">VAD VICTOR BEVAKAR</div>
                <div className="text-xs text-gray-500 mt-2">Narrow middle card (mock)</div>
              </div>
            </div>

            <div style={{ flex: '0 0 434px', height: '100%', transform: 'translateX(-15px)' }}>
              <div className="bg-white rounded-md p-3 shadow-sm" style={{ height: '100%', boxSizing: 'border-box', backgroundColor: '#e9e5cf', borderRadius: 12 }}>
                <div className="font-medium">MARKNADSPULS</div>
                <div className="text-xs text-gray-500 mt-2">Bredd: bred ruta till höger (mock)</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
