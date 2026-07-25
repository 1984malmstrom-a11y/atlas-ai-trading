import { Portfolio } from '../../domain/portfolio/types';
import { SimulatedExecution } from './types';

function round2(n: number){ return Math.round(n * 100)/100; }

export function computeNextPortfolioState(
  current: Portfolio,
  exec: SimulatedExecution
): Portfolio {
  // Do not mutate inputs
  const state: Portfolio = JSON.parse(JSON.stringify(current));

  const sym = exec.symbol.toUpperCase();

  if (exec.side === 'BUY'){
    state.availableCash = round2(state.availableCash - exec.notional - exec.fee);
    const found = state.holdings.find((h:any)=> h.symbol === sym);
    if (found){
      found.quantity = found.quantity + exec.quantity;
      found.currentPrice = exec.executedPrice;
      found.marketValue = round2(found.quantity * found.currentPrice);
    } else {
      state.holdings.push({ id: `h_${sym}`, symbol: sym, name: sym, assetType: 'Stock', quantity: exec.quantity, averagePrice: exec.executedPrice, currentPrice: exec.executedPrice, marketValue: round2(exec.quantity * exec.executedPrice), unrealizedPnl:0, unrealizedPnlPercent:0, portfolioWeight:0 });
    }
  } else {
    const found = state.holdings.find((h:any)=> h.symbol === sym);
    const sellQty = Math.min(found ? found.quantity : 0, exec.quantity);
    const proceeds = round2(sellQty * exec.executedPrice);
    state.availableCash = round2(state.availableCash + proceeds - exec.fee);
    if (found){
      found.quantity = round2(found.quantity - sellQty);
      found.currentPrice = exec.executedPrice;
      found.marketValue = round2(found.quantity * found.currentPrice);
      if (found.quantity <= 0) state.holdings = state.holdings.filter((h:any)=> h !== found);
    }
  }

  const mv = state.holdings.reduce((s:any,h:any)=> s + (h.marketValue||0), 0);
  state.totalValue = round2(state.availableCash + mv);

  return state;
}

export default computeNextPortfolioState;
