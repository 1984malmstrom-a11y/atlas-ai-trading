import React from 'react';
import VictorHero from './VictorHero';
import DashboardV1Header from './DashboardV1Header';
import CompanyLogo from '../CompanyLogo';
import { RECOMMENDATION_LEFT, RECOMMENDATION_WIDTH, RECOMMENDATION_HEIGHT, RECOMMENDATION_TOP } from './layoutConstants';
import { CARD_PADDING, CARD_BORDER_RADIUS, BG_LIGHT, BG_DARK, CARD_HEADING_FONT_SIZE, CARD_HEADING_FONT_WEIGHT, CARD_SECONDARY_FONT_SIZE, CARD_LINE_HEIGHT, BADGE_PADDING, BADGE_BORDER_RADIUS, BADGE_FONT_SIZE, BADGE_FONT_WEIGHT, SEPARATOR_LIGHT, STATUS_COLORS, GLOW } from './cardStyles';

export default function MainArea(){
  return (
    <div className="min-h-0 min-w-0" style={{ minHeight: 0, minWidth: 0, marginTop: '-16px', position: 'relative' }}>
      <DashboardV1Header />
      <VictorHero />
      <div className="px-6 pb-6">
        {/* Absolute overlay layer with three groups (pointer-events: none on container) */}
        <div className="dashboardOverlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>

          {/* Recommendation area: left/mid */}
          <section className="recommendationArea" style={{ pointerEvents: 'auto', position: 'absolute', left: RECOMMENDATION_LEFT, width: RECOMMENDATION_WIDTH, height: RECOMMENDATION_HEIGHT, top: RECOMMENDATION_TOP, boxSizing: 'border-box' }}>
            <div style={{ width: '100%', height: '100%', backgroundColor: BG_LIGHT, borderRadius: CARD_BORDER_RADIUS, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: CARD_PADDING, position: 'relative', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ lineHeight: 1.05, flex: 1 }}>
                  <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, color: 'rgba(0,0,0,0.95)', textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 6 }}>MIN VIKTIGASTE</div>
                  <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, color: 'rgba(0,0,0,0.95)', textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 6 }}>REKOMMENDATION IDAG</div>
                </div>

                <div style={{ textAlign: 'center', minWidth: 64 }}>
                  <div style={{ background: 'rgba(22,163,74,0.12)', color: STATUS_COLORS.green, padding: BADGE_PADDING, borderRadius: BADGE_BORDER_RADIUS, fontSize: BADGE_FONT_SIZE, fontWeight: BADGE_FONT_WEIGHT }}>87%</div>
                  <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(0,0,0,0.6)' }}>Konfidens</div>
                </div>
              </div>

              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 18, justifyContent: 'center', alignContent: 'center' }}>
                <div style={{ fontSize: 21, fontWeight: 600, color: 'rgba(0,0,0,0.95)', textAlign: 'left' }}>Köp mer Investor</div>
                <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.75)', lineHeight: 1.4 }}>Attraktiv värdering, hög kvalitet och förbättrad riskspridning.</div>
              </div>

              {/* Small, discrete link absolutely positioned inside card with 12px breathing room */}
              <div style={{ position: 'absolute', right: 16, bottom: 16 }}>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>Visa analys</div>
              </div>
            </div>
          </section>



          {/* Right column: stacked DIN PORTFÖLJ + PORTFÖLJENS HÄLSA */}
          <section className="rightColumn" style={{ pointerEvents: 'auto', position: 'absolute', right: 20, top: 28, width: 434, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ width: '100%', height: 250, transform: 'translateX(-28px) translateY(71px)' }}>
              <div style={{ backgroundColor: BG_DARK, color: '#fff', borderRadius: CARD_BORDER_RADIUS, height: '100%', boxSizing: 'border-box', padding: CARD_PADDING }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 6 }}>DIN PORTFÖLJ</div>
                    <div style={{ marginTop: 6, fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(255,255,255,0.75)' }}>Totalt värde</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <div style={{ background: 'rgba(255,255,255,0.06)', color: '#d1fae5', padding: BADGE_PADDING, borderRadius: BADGE_BORDER_RADIUS, fontSize: BADGE_FONT_SIZE, fontWeight: BADGE_FONT_WEIGHT }}>+2,34% <span style={{ fontWeight: 400, marginLeft: 6, color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>Idag</span></div>
                  </div>
                </div>

                <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 44, lineHeight: '44px', fontWeight: 700, color: '#ffffff' }}>2 847 235 kr</div>
                  <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: STATUS_COLORS.green, fontWeight: 600 }}>+64 285 kr idag</div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>Aktier</div>
                    <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>68%</div>
                  </div>
                  <div style={{ width: '100%', height: 11, background: 'rgba(255,255,255,0.06)', borderRadius: 9999, overflow: 'hidden' }}>
                    <div style={{ width: '68%', height: '100%', background: STATUS_COLORS.green, boxShadow: GLOW, borderRadius: 9999 }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 8 }}>
                    <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>ETF</div>
                    <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>22%</div>
                  </div>
                  <div style={{ width: '100%', height: 11, background: 'rgba(255,255,255,0.06)', borderRadius: 9999, overflow: 'hidden' }}>
                    <div style={{ width: '22%', height: '100%', background: STATUS_COLORS.green, boxShadow: GLOW, borderRadius: 9999 }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 8 }}>
                    <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>Likvida medel</div>
                    <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>10%</div>
                  </div>
                  <div style={{ width: '100%', height: 11, background: 'rgba(255,255,255,0.06)', borderRadius: 9999, overflow: 'hidden' }}>
                    <div style={{ width: '10%', height: '100%', background: STATUS_COLORS.green, boxShadow: GLOW, borderRadius: 9999 }} />
                  </div>
                </div>

                <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(255,255,255,0.75)' }}>Risknivå</div>
                    <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.95)', fontWeight: 600 }}>Medel</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(255,255,255,0.75)' }}>Diversifiering</div>
                    <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.95)', fontWeight: 700 }}>92%</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ width: '100%', height: 134, transform: 'translateX(-28px) translateY(66px)' }}>
              <div style={{ height: '100%', boxSizing: 'border-box', backgroundColor: BG_LIGHT, borderRadius: CARD_BORDER_RADIUS, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: CARD_PADDING }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 6 }}>PORTFÖLJENS HÄLSA</div>
                    <div style={{ marginTop: 6, fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.6)' }}>Övergripande bedömning</div>
                  </div>
                  <div style={{ alignSelf: 'flex-start' }}>
                    <div style={{ background: STATUS_COLORS.darkGreen, color: '#e6ffef', padding: '4px 8px', borderRadius: BADGE_BORDER_RADIUS, fontSize: BADGE_FONT_SIZE, fontWeight: BADGE_FONT_WEIGHT }}>STARK</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                  <div style={{ width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9999, background: '#021824', marginTop: -2 }}>
                    <div style={{ width: 60, height: 60, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18, background: 'conic-gradient(' + STATUS_COLORS.green + ' 0% 92%, rgba(255,255,255,0.12) 92% 100%)' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 16, lineHeight: '16px' }}>92</div>
                        <div style={{ fontSize: 11, opacity: 0.85 }}>/100</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: CARD_HEADING_FONT_SIZE, color: 'rgba(0,0,0,0.8)', fontWeight: CARD_HEADING_FONT_WEIGHT }}>Mycket god hälsa</div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 9999, background: STATUS_COLORS.green }} />
                          <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.75)' }}>Diversifiering</div>
                        </div>
                        <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.8)', fontWeight: CARD_HEADING_FONT_WEIGHT }}>92%</div>
                      </div>
                      <div style={{ height: 1, background: SEPARATOR_LIGHT }} />

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 9999, background: STATUS_COLORS.yellow }} />
                          <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.75)' }}>Risknivå</div>
                        </div>
                        <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.8)', fontWeight: CARD_HEADING_FONT_WEIGHT }}>Medel</div>
                      </div>
                      <div style={{ height: 1, background: SEPARATOR_LIGHT }} />

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 9999, background: STATUS_COLORS.green }} />
                          <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.75)' }}>Likviditet</div>
                        </div>
                        <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.8)', fontWeight: CARD_HEADING_FONT_WEIGHT }}>God</div>
                      </div>
                    </div>
                  </div>

                </div>

                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.75)', fontWeight: CARD_HEADING_FONT_WEIGHT }}>Victor säger</div>
                  <div style={{ marginTop: 4, fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.8)' }}>
                    Portföljen är väl diversifierad och har en stabil risknivå. Den största bevakningspunkten är den relativt höga exponeringen mot amerikansk teknik.
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Bottom row: three cards */}
          <section className="bottomRow" style={{ pointerEvents: 'auto', position: 'absolute', left: 20, right: 20, bottom: -290, height: 177, display: 'flex', gap: 16, boxSizing: 'border-box', zIndex: 25, transform: 'translateX(0.6px)' }}>
            <div style={{ flex: '0 0 calc(42% - 13.5px)', height: '100%' }}>
              <div style={{ height: '100%', boxSizing: 'border-box', backgroundColor: BG_LIGHT, borderRadius: CARD_BORDER_RADIUS, padding: CARD_PADDING, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}>
                <div>
                  <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 6 }}>DAGENS MÖJLIGHETER</div>
                  <div style={{ marginTop: 6, fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.6)' }}>Atlas AI har identifierat dagens mest intressanta möjligheter.</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {/* Row 1: Investor (Victor favorit badge) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CompanyLogo symbol={'INVE-B.ST'} name={'Investor'} companyName={'Investor'} domain={'investorab.com'} size={22} innerPadding={4} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT }}>Investor</div>
                          <div style={{ background: STATUS_COLORS.yellow, color: '#222222', padding: '5px 7px', borderRadius: BADGE_BORDER_RADIUS, fontSize: BADGE_FONT_SIZE * 0.9, fontWeight: BADGE_FONT_WEIGHT }}>VICTOR FAVORIT</div>
                        </div>
                        <div style={{ marginTop: 3, fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.7)' }}>Stark värdering och defensiv exponering</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 72 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.85)' }}>92%</div>
                      <div style={{ width: 56, height: 4, background: 'rgba(0,0,0,0.06)', borderRadius: 9999, marginTop: 4, overflow: 'hidden' }}>
                        <div style={{ width: '92%', height: '100%', background: STATUS_COLORS.green, borderRadius: 9999 }} />
                      </div>
                      <div style={{ marginTop: 4, fontSize: 14, color: STATUS_COLORS.green }}>▲</div>
                    </div>
                  </div>
                  <div style={{ height: 1, background: SEPARATOR_LIGHT }} />

                  {/* Row 2: Microsoft */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CompanyLogo symbol={'MSFT'} name={'Microsoft'} companyName={'Microsoft'} domain={'microsoft.com'} size={22} innerPadding={4} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>Microsoft</div>
                        <div style={{ marginTop: 3, fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.7)' }}>AI-tillväxt fortsätter överträffa prognoser</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 72 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.85)' }}>89%</div>
                      <div style={{ width: 56, height: 4, background: 'rgba(0,0,0,0.06)', borderRadius: 9999, marginTop: 4, overflow: 'hidden' }}>
                        <div style={{ width: '89%', height: '100%', background: STATUS_COLORS.green, borderRadius: 9999 }} />
                      </div>
                      <div style={{ marginTop: 4, fontSize: 14, color: STATUS_COLORS.green }}>▲</div>
                    </div>
                  </div>
                  <div style={{ height: 1, background: SEPARATOR_LIGHT }} />

                  {/* Row 3: Atlas Copco */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CompanyLogo symbol={'ATCO-A.ST'} name={'Atlas Copco'} companyName={'Atlas Copco'} domain={'atlascopcogroup.com'} size={22} innerPadding={4} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>Atlas Copco</div>
                        <div style={{ marginTop: 3, fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.7)' }}>Stabil orderingång</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 72 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.85)' }}>84%</div>
                      <div style={{ width: 56, height: 4, background: 'rgba(0,0,0,0.06)', borderRadius: 9999, marginTop: 4, overflow: 'hidden' }}>
                        <div style={{ width: '84%', height: '100%', background: STATUS_COLORS.green, borderRadius: 9999 }} />
                      </div>
                      <div style={{ marginTop: 4, fontSize: 14, color: STATUS_COLORS.green }}>▲</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>Senast uppdaterad</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(0,0,0,0.6)', fontSize: 12 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                      <path d="M12 7V12L15 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M21 12A9 9 0 1 1 3 12a9 9 0 0 1 18 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div>08:30 idag</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ flex: '0 0 calc(33% - 3.5px)', height: '100%', transform: 'translateX(-8px)' }}>
              <div style={{ height: '100%', boxSizing: 'border-box', backgroundColor: BG_LIGHT, borderRadius: CARD_BORDER_RADIUS, padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 9999, background: STATUS_COLORS.green }} />
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(0,0,0,0.85)' }}>Victor arbetar</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>08:30</div>
                  </div>

                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg aria-hidden="true" className="w-4 h-4 text-blue-500 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flex: '0 0 auto' }}>
                        <path d="M21 12a9 9 0 11-3.36-6.64" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(0,0,0,0.92)', lineHeight: 1.18 }}>Analyserar NVIDIA:s kvartalsrapport.</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 8, height: 1, background: SEPARATOR_LIGHT }} />

                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(0,0,0,0.85)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <path d="M5 13l4 4L19 7" stroke={STATUS_COLORS.green} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div>Microsoft Q2</div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(0,0,0,0.85)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <path d="M12 7V12L15 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M21 12A9 9 0 1 1 3 12a9 9 0 0 1 18 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div>Fed 14:30</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ flex: '0 0 calc(25% - 13.5px)', height: '100%', transform: 'translateX(-15px)' }}>
              <div style={{ height: '100%', boxSizing: 'border-box', backgroundColor: BG_LIGHT, borderRadius: CARD_BORDER_RADIUS, padding: CARD_PADDING }}>
                <div style={{ fontSize: CARD_HEADING_FONT_SIZE, fontWeight: CARD_HEADING_FONT_WEIGHT, textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 6 }}>MARKNADSPULS</div>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>S&P 500</div>
                    <div style={{ fontSize: 13, color: STATUS_COLORS.green, fontWeight: 700 }}>+0,7% ▲</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>OMXS30</div>
                    <div style={{ fontSize: 13, color: STATUS_COLORS.green, fontWeight: 700 }}>+0,4% ▲</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Nasdaq</div>
                    <div style={{ fontSize: 13, color: STATUS_COLORS.green, fontWeight: 700 }}>+0,9% ▲</div>
                  </div>
                  <div style={{ height: 1, background: SEPARATOR_LIGHT, marginTop: 6 }} />
                  <div style={{ marginTop: 6, fontSize: CARD_SECONDARY_FONT_SIZE, color: 'rgba(0,0,0,0.8)' }}>Victor: Marknaden visar fortsatt stabilt momentum, fokus på teknik och makrodata.</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
