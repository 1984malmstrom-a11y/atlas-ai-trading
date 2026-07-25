-- Migration: create paper_portfolio and execution receipts + atomic commit RPC
-- Generated: 2026-07-25

-- 1) paper_portfolio table
CREATE TABLE IF NOT EXISTS public.paper_portfolio (
  id text PRIMARY KEY,
  state jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) paper_execution_receipts table
CREATE TABLE IF NOT EXISTS public.paper_execution_receipts (
  execution_id text PRIMARY KEY,
  portfolio_id text NOT NULL REFERENCES public.paper_portfolio(id) ON DELETE CASCADE,
  applied_version bigint NOT NULL CHECK (applied_version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on both tables (policies to be added later as needed)
ALTER TABLE IF EXISTS public.paper_portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.paper_execution_receipts ENABLE ROW LEVEL SECURITY;

-- 3) RPC: atomic commit function
CREATE OR REPLACE FUNCTION public.commit_paper_portfolio_execution(
  p_portfolio_id text,
  p_expected_version bigint,
  p_execution_id text,
  p_next_state jsonb
) RETURNS TABLE(status text, state jsonb, version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_state jsonb;
  v_version bigint;
  v_exists int;
  v_applied_version bigint;
BEGIN
  -- validate inputs
  IF p_portfolio_id IS NULL OR trim(p_portfolio_id) = '' OR p_execution_id IS NULL OR trim(p_execution_id) = '' THEN
    RETURN QUERY SELECT 'INVALID_INPUT'::text, NULL::jsonb, NULL::bigint; RETURN;
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 THEN
    RETURN QUERY SELECT 'INVALID_INPUT'::text, NULL::jsonb, NULL::bigint; RETURN;
  END IF;
  IF p_next_state IS NULL OR jsonb_typeof(p_next_state) IS DISTINCT FROM 'object' THEN
    RETURN QUERY SELECT 'INVALID_INPUT'::text, NULL::jsonb, NULL::bigint; RETURN;
  END IF;

  -- lock the target portfolio row for update to ensure transactional safety
  SELECT state, version INTO v_state, v_version
  FROM public.paper_portfolio
  WHERE id = p_portfolio_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::jsonb, NULL::bigint; RETURN;
  END IF;

  -- check for duplicate execution
  SELECT 1 INTO v_exists FROM public.paper_execution_receipts WHERE execution_id = p_execution_id;
  IF FOUND THEN
    -- return current state/version
    RETURN QUERY SELECT 'DUPLICATE'::text, v_state, v_version; RETURN;
  END IF;

  -- version conflict check
  IF v_version IS DISTINCT FROM p_expected_version THEN
    RETURN QUERY SELECT 'VERSION_CONFLICT'::text, v_state, v_version; RETURN;
  END IF;

  -- apply: compute applied_version, insert receipt, update portfolio atomically (we are inside transaction)
  v_applied_version := v_version + 1;

  INSERT INTO public.paper_execution_receipts(execution_id, portfolio_id, applied_version)
  VALUES (p_execution_id, p_portfolio_id, v_applied_version);

  UPDATE public.paper_portfolio
  SET state = p_next_state,
      version = v_applied_version,
      updated_at = now()
  WHERE id = p_portfolio_id;

  -- return applied status with new state/version
  RETURN QUERY SELECT 'APPLIED'::text, p_next_state, v_applied_version; RETURN;
EXCEPTION WHEN others THEN
  -- On unexpected error, do not expose internals; return INVALID_INPUT as a conservative default
  RETURN QUERY SELECT 'INVALID_INPUT'::text, NULL::jsonb, NULL::bigint; RETURN;
END;
$func$;

-- Revoke execute privileges from PUBLIC for the RPC, grant to service_role
REVOKE EXECUTE ON FUNCTION public.commit_paper_portfolio_execution(text,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_paper_portfolio_execution(text,bigint,text,jsonb) TO service_role;
