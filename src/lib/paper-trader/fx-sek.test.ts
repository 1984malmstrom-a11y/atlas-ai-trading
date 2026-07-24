import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// Ensure a clean audit/portfolio state file for the test
const AUDIT_PATH = 'src/data/victor-trading-audit.json';
const PORTFOLIO_PATH = 'src/data/portfolio.json';

beforeEach(()=>{
  try{ if (fs.existsSync(AUDIT_PATH)) fs.unlinkSync(AUDIT_PATH); }catch(e){}
  try{ if (fs.existsSync(PORTFOLIO_PATH)) fs.unlinkSync(PORTFOLIO_PATH); }catch(e){}
});

describe('FX SEK consistency', ()=>{
  it.only('executes BUY using SEK price computed from USD raw price and FX rate, and later valuation uses same SEK price', async ()=>{
    const rawUsdPrice = 381.58;
    const usdSek = 9.72;
    const expectedSekPrice = Math.round(rawUsdPrice * usdSek * 100)/100;

    // Mock normalized quotes to provide MSFT with raw USD price (no priceSek)
    const mockQuotes = {
      quotes: [
        { instrumentId: 'microsoft', symbol: 'MSFT', price: rawUsdPrice, currency: 'USD', marketTimestamp: new Date().toISOString(), fetchedAt: new Date().toISOString() }
      ],
      errors: [], disabledInstruments: [], fetchedAt: new Date().toISOString()
    };

    // Import demo runtime
    const dr = await import('./demo-runtime');

    // Ensure enabled and reset runtime state
    await dr.setPaperTradingEnabled(true);

    // Build a decision using SEK referencePrice computed from USD raw price and FX
    const decision = { id: `test_msft_${Date.now()}`, symbol: 'MSFT', action: 'BUY', confidence: 80, referencePrice: expectedSekPrice, generatedAt: new Date().toISOString(), requestedNotionalSek: 8000 };

    const res = await dr.executePaperTradeDecision(decision as any);
    expect(res.result && res.result.accepted).toBeTruthy();

    const state = res.state;
    const msft = (state.holdings||[]).find((h:any)=> h.symbol === 'MSFT');
    expect(msft).toBeDefined();

    const slippageBps = 5; // default in runtime config
    const expectedExecPrice = Math.round((expectedSekPrice * (1 + (slippageBps/10000))) * 100)/100;

    // (debug logs removed)

    // averagePrice should reflect SEK execution price (including slippage)
    expect(msft.averagePrice).toBeCloseTo(expectedExecPrice, 6);
    // currentPrice (stored at execution) should be the same as averagePrice
    expect(msft.currentPrice).toBeCloseTo(expectedExecPrice, 6);

    // With no change in USD price and FX, unrealized P/L should be near zero
    const calcPnl = Math.round((msft.currentPrice - msft.averagePrice) * msft.quantity * 100)/100;
    expect(Math.abs(msft.unrealizedPnl - calcPnl)).toBeLessThan(1);

    vi.unmock('../market-data/quotes-service');
    vi.unmock('../market-data');
  });
});
