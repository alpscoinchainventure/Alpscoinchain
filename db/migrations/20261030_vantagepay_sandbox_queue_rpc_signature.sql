-- PostgREST-compatible named-argument entry point for the VantagePay sandbox queue.
-- The explicit argument avoids relying on discovery of a zero-argument RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.vp_admin_list_demo_account_applications(p_queue_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_rows jsonb;
BEGIN
  IF p_queue_version <> 1 THEN
    RAISE EXCEPTION 'Unsupported sandbox queue version' USING ERRCODE = '22023';
  END IF;

  SELECT admin_role INTO v_role
  FROM public.vp_admin_memberships
  WHERE user_id = v_actor AND enabled = TRUE
  LIMIT 1;

  IF v_actor IS NULL OR v_role NOT IN ('support','operations','finance','super_admin') THEN
    RAISE EXCEPTION 'Enabled VantagePay admin access is required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT a.id, a.user_id, a.application_reference, a.currency_code, a.country_code,
           a.customer_note, a.application_status, a.created_at,
           c.account_reference AS customer_reference, c.display_name
    FROM public.vp_demo_account_applications a
    LEFT JOIN public.vp_customer_accounts c ON c.user_id = a.user_id
    WHERE a.application_status = 'pending'
    ORDER BY a.created_at DESC
    LIMIT 200
  ) q;

  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.vp_admin_list_demo_account_applications(integer) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.vp_admin_list_demo_account_applications(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
