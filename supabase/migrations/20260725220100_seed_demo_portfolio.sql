-- Seed migration: create initial demo portfolio (idempotent)
-- Generated: 2026-07-25

INSERT INTO public.paper_portfolio (id, state, version)
VALUES (
  'demo',
  '{"id":"demo","baseCurrency":"SEK","totalValue":100000,"availableCash":100000,"totalReturnPercent":0,"benchmarkReturnPercent":0,"holdings":[]}'::jsonb,
  0
)
ON CONFLICT (id) DO NOTHING;
