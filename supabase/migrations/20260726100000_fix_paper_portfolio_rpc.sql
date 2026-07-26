-- Migration: fix commit_paper_portfolio_execution to remove opaque exception handling
-- Generated: 2026-07-26

-- Recreate function with explicit variables, qualified references and no general exception handler
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
  v_current_state jsonb;
  v_current_version bigint;
  v_exists int;
  v_applied_version bigint;
BEGIN
  -- validate inputs (preserve original validation semantics)
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
  SELECT pp.state, pp.version INTO v_current_state, v_current_version
  FROM public.paper_portfolio AS pp
  WHERE pp.id = p_portfolio_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::jsonb, NULL::bigint; RETURN;
  END IF;

  -- check for duplicate execution
  SELECT 1 INTO v_exists FROM public.paper_execution_receipts AS per WHERE per.execution_id = p_execution_id;
  IF FOUND THEN
    -- return current state/version
    RETURN QUERY SELECT 'DUPLICATE'::text, v_current_state, v_current_version; RETURN;
  END IF;

  -- version conflict check
  IF v_current_version IS DISTINCT FROM p_expected_version THEN
    RETURN QUERY SELECT 'VERSION_CONFLICT'::text, v_current_state, v_current_version; RETURN;
  END IF;

  -- apply: compute applied_version, insert receipt, update portfolio atomically
  v_applied_version := v_current_version + 1;

  INSERT INTO public.paper_execution_receipts(execution_id, portfolio_id, applied_version)
  VALUES (p_execution_id, p_portfolio_id, v_applied_version);

  UPDATE public.paper_portfolio AS pp
  SET state = p_next_state,
      version = v_applied_version,
      updated_at = now()
  WHERE pp.id = p_portfolio_id;

  -- return applied status with new state/version
  RETURN QUERY SELECT 'APPLIED'::text, p_next_state, v_applied_version; RETURN;
END;
$func$;

-- Preserve privileges: revoke from public and grant to service_role
REVOKE EXECUTE ON FUNCTION public.commit_paper_portfolio_execution(text,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_paper_portfolio_execution(text,bigint,text,jsonb) TO service_role;
