-- Migration: create append-only victor_audit table
-- Timestamp: 2026-07-26 11:30 (migration id 20260726113000)

CREATE TABLE IF NOT EXISTS public.victor_audit (
  id text PRIMARY KEY,
  portfolio_id text NULL,
  source text NOT NULL,
  kind text NULL,
  execution_id text NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Checks
  CONSTRAINT chk_victor_audit_id_not_blank CHECK (trim(id) <> ''),
  CONSTRAINT chk_victor_audit_source_not_blank CHECK (trim(source) <> ''),
  CONSTRAINT chk_victor_audit_portfolio_not_empty CHECK (portfolio_id IS NULL OR trim(portfolio_id) <> ''),
  CONSTRAINT chk_victor_audit_kind_not_empty CHECK (kind IS NULL OR trim(kind) <> ''),
  CONSTRAINT chk_victor_audit_execution_id_not_empty CHECK (execution_id IS NULL OR trim(execution_id) <> ''),
  CONSTRAINT chk_victor_audit_idempotency_not_empty CHECK (idempotency_key IS NULL OR trim(idempotency_key) <> ''),
  CONSTRAINT chk_victor_audit_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_victor_audit_portfolio_occurred_at ON public.victor_audit (portfolio_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_victor_audit_occurred_at ON public.victor_audit (occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_victor_audit_idempotency_key ON public.victor_audit (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Security: enable RLS but do not create anon/authenticated policies here.
ALTER TABLE public.victor_audit ENABLE ROW LEVEL SECURITY;

-- Revoke broad access from public and typical client roles
REVOKE ALL ON TABLE public.victor_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.victor_audit FROM anon;
REVOKE ALL ON TABLE public.victor_audit FROM authenticated;
REVOKE ALL ON TABLE public.victor_audit FROM service_role;

-- Grant only SELECT and INSERT to the service role (used by server-side operations)
GRANT SELECT, INSERT ON TABLE public.victor_audit TO service_role;

-- Intent: append-only. Do NOT grant UPDATE, DELETE or TRUNCATE to service_role here.
