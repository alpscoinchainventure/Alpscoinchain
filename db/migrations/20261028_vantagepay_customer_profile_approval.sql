-- VantagePay: audited customer account-profile approval workflow.
-- Apply only to the dedicated VantagePay Neon database.
BEGIN;

CREATE OR REPLACE FUNCTION public.vp_admin_list_customer_profiles()
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
  SELECT m.admin_role INTO v_role
  FROM public.vp_admin_memberships AS m
  WHERE m.user_id = v_actor AND m.enabled = TRUE
  LIMIT 1;
  IF v_actor IS NULL OR v_role NOT IN ('support','operations','finance','super_admin') THEN
    RAISE EXCEPTION 'Enabled VantagePay admin access is required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT a.user_id, a.account_reference, a.display_name,
           a.account_status, a.created_at, a.updated_at,
           p.phone_number, p.city, p.country_code, p.updated_at AS profile_updated_at
    FROM public.vp_customer_accounts a
    LEFT JOIN public.vp_customer_profiles p ON p.user_id = a.user_id
    WHERE a.account_status = 'pending'
    ORDER BY a.created_at DESC
    LIMIT 200
  ) q;
  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vp_admin_review_customer_profile(
  p_customer_user_id uuid,
  p_next_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_row public.vp_customer_accounts%ROWTYPE;
  v_previous_status text;
BEGIN
  SELECT m.admin_role INTO v_role
  FROM public.vp_admin_memberships AS m
  WHERE m.user_id = v_actor AND m.enabled = TRUE
  LIMIT 1;
  IF v_actor IS NULL OR v_role NOT IN ('support','operations','finance','super_admin') THEN
    RAISE EXCEPTION 'Enabled VantagePay admin access is required' USING ERRCODE = '42501';
  END IF;
  IF p_next_status NOT IN ('active','restricted') THEN
    RAISE EXCEPTION 'Choose active (approve) or restricted (reject)' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 8 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'A review reason of 8 to 500 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.vp_customer_accounts
  WHERE user_id = p_customer_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer account not found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.account_status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending customer accounts can be reviewed by this workflow' USING ERRCODE = '55000';
  END IF;
  v_previous_status := v_row.account_status;

  UPDATE public.vp_customer_accounts
  SET account_status = p_next_status, updated_at = now()
  WHERE user_id = p_customer_user_id
  RETURNING * INTO v_row;

  INSERT INTO public.vp_admin_audit_log
    (actor_user_id, action, target_type, target_reference, reason, before_state, after_state)
  VALUES
    (v_actor, CASE WHEN p_next_status = 'active' THEN 'customer_profile_approved' ELSE 'customer_profile_rejected' END,
     'customer_account', p_customer_user_id::text, btrim(p_reason),
     jsonb_build_object('account_status', v_previous_status),
     jsonb_build_object('account_status', p_next_status));

  INSERT INTO public.vp_customer_notifications(user_id, notification_type, title, message)
  VALUES (p_customer_user_id, 'security',
    CASE WHEN p_next_status = 'active' THEN 'VantagePay profile approved' ELSE 'VantagePay profile requires review' END,
    CASE WHEN p_next_status = 'active'
      THEN 'Your VantagePay account profile has been approved. This does not mean KYC is verified or financial services are enabled.'
      ELSE 'Your VantagePay account profile was not approved and has been restricted. Please contact support for next steps.'
    END);

  RETURN jsonb_build_object('user_id', v_row.user_id, 'account_status', v_row.account_status,
                            'updated_at', v_row.updated_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.vp_admin_list_customer_profiles() FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.vp_admin_review_customer_profile(uuid,text,text) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.vp_admin_list_customer_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vp_admin_review_customer_profile(uuid,text,text) TO authenticated;

COMMIT;
