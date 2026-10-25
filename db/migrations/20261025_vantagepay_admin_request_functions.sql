-- VantagePay admin request review functions.
-- These functions update request metadata only. They never post ledger entries or move funds.
BEGIN;

CREATE OR REPLACE FUNCTION public.vp_admin_list_transaction_requests(p_actor_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id <> auth.user_id()::uuid THEN
    RAISE EXCEPTION 'actor identity mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vp_admin_memberships m
    WHERE m.user_id = p_actor_user_id
      AND m.enabled
      AND m.admin_role IN ('support','operations','finance','super_admin')
  ) THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC), '[]'::jsonb)
    INTO result
  FROM (
    SELECT id, request_reference, user_id, request_type, amount_minor_units,
           currency_code, beneficiary_id, status, provider_reference,
           customer_note, created_at, updated_at
    FROM public.vp_transaction_requests
    ORDER BY created_at DESC
    LIMIT 200
  ) q;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.vp_admin_update_request_status(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_next_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  prior public.vp_transaction_requests%ROWTYPE;
  changed public.vp_transaction_requests%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id <> auth.user_id()::uuid THEN
    RAISE EXCEPTION 'actor identity mismatch' USING ERRCODE = '42501';
  END IF;

  IF p_next_status NOT IN ('under_review','submitted','rejected','cancelled')
     OR p_reason IS NULL OR length(btrim(p_reason)) < 8 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'invalid status or reason' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vp_admin_memberships m
    WHERE m.user_id = p_actor_user_id
      AND m.enabled
      AND m.admin_role IN ('operations','finance','super_admin')
  ) THEN
    RAISE EXCEPTION 'operations access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior
  FROM public.vp_transaction_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002';
  END IF;

  IF prior.status NOT IN ('pending','under_review','submitted') THEN
    RAISE EXCEPTION 'request is not eligible for this metadata status change' USING ERRCODE = '22023';
  END IF;

  IF prior.status = 'pending' AND p_next_status NOT IN ('under_review','rejected','cancelled') THEN
    RAISE EXCEPTION 'invalid status transition' USING ERRCODE = '22023';
  END IF;

  UPDATE public.vp_transaction_requests
  SET status = p_next_status, updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO changed;

  INSERT INTO public.vp_admin_audit_log
    (actor_user_id, action, target_type, target_reference, reason, before_state, after_state, request_id)
  VALUES
    (p_actor_user_id, 'transaction_request_status_changed', 'transaction_request',
     changed.request_reference, btrim(p_reason),
     jsonb_build_object('status', prior.status),
     jsonb_build_object('status', changed.status), changed.id::text);

  INSERT INTO public.vp_customer_notifications
    (user_id, notification_type, title, message, related_request_id)
  VALUES
    (changed.user_id, 'request_status', 'Request status updated',
     'Your ' || changed.request_type || ' request ' || changed.request_reference ||
     ' status is now ' || replace(changed.status, '_', ' ') ||
     '. This status update does not confirm a transfer or settlement.',
     changed.id);

  RETURN jsonb_build_object(
    'id', changed.id,
    'request_reference', changed.request_reference,
    'user_id', changed.user_id,
    'request_type', changed.request_type,
    'amount_minor_units', changed.amount_minor_units,
    'currency_code', changed.currency_code,
    'beneficiary_id', changed.beneficiary_id,
    'status', changed.status,
    'provider_reference', changed.provider_reference,
    'customer_note', changed.customer_note,
    'created_at', changed.created_at,
    'updated_at', changed.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.vp_admin_list_transaction_requests(uuid) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.vp_admin_update_request_status(uuid, uuid, text, text) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.vp_admin_list_transaction_requests(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vp_admin_update_request_status(uuid, uuid, text, text) TO authenticated;

COMMIT;
