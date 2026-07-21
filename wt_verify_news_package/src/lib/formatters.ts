export function formatCurrency(value: number, currency = 'USD'){
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency }).format(value);
}

export function formatPercent(value: number){
  return `${(value * 100).toFixed(2)}%`;
}
