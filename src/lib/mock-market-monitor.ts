export type MockQuote = {
  symbol: string;
  name: string;
  price: number;
  prevPrice: number;
  volume: number;
  updatedAt: string;
};

const INSTRUMENTS = [
  { symbol: "NVDA", name: "NVIDIA Corp" },
  { symbol: "MSFT", name: "Microsoft Corp" },
  { symbol: "AAPL", name: "Apple Inc" },
  { symbol: "INVE-B", name: "Investor AB" },
  { symbol: "NOVO-B", name: "Novo Nordisk B" },
];

function nowLabel() {
  return new Date().toLocaleTimeString();
}

function randBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export function getMockMarketData(prev?: MockQuote[]): MockQuote[] {
  if (!prev) {
    return INSTRUMENTS.map((i) => {
      const price = +(randBetween(50, 500)).toFixed(2);
      return {
        symbol: i.symbol,
        name: i.name,
        price,
        prevPrice: price,
        volume: Math.floor(randBetween(1000, 1000000)),
        updatedAt: nowLabel(),
      } as MockQuote;
    });
  }

  // simulate small random walk updates
  return prev.map((p) => {
    const prevPrice = p.price;
    const changeFactor = 1 + randBetween(-0.01, 0.01); // +/-1%
    const price = +Math.max(0.01, +(prevPrice * changeFactor).toFixed(2));
    const volume = Math.max(0, Math.floor(p.volume * (1 + randBetween(-0.2, 0.2))));
    return {
      symbol: p.symbol,
      name: p.name,
      price,
      prevPrice,
      volume,
      updatedAt: nowLabel(),
    };
  });
}
