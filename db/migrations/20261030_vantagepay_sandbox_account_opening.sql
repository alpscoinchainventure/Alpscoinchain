-- VantagePay sandbox account-opening workflow.
-- These are explicitly simulated test details, not bank-issued accounts.
BEGIN;

CREATE TABLE IF NOT EXISTS public.vp_demo_account_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  application_reference text NOT NULL UNIQUE DEFAULT ('VP-APP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  account_type text NOT NULL DEFAULT 'personal' CHECK (account_type = 'personal'),
  currency_code text NOT NULL CHECK (currency_code IN ('GBP','USD','EUR','NGN')),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  customer_note text CHECK (customer_note IS NULL OR length(customer_note) <= 500),
  application_status text NOT NULL DEFAULT 'pending' CHECK (application_status IN ('pending','approved','rejected')),
  review_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vp_demo_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  application_id uuid NOT NULL UNIQUE REFERENCES public.vp_demo_account_applications(id),
  account_reference text NOT NULL UNIQUE DEFAULT ('VP-TEST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  account_number text NOT NULL UNIQUE,
  bank_name text NOT NULL DEFAULT 'VantagePay Sandbox Bank',
  sort_code text NOT NULL DEFAULT 'TEST-00-00',
  iban text,
  swift_bic text,
  currency_code text NOT NULL CHECK (currency_code IN ('GBP','USD','EUR','NGN')),
  account_status text NOT NULL DEFAULT 'test_active' CHECK (account_status = 'test_active'),
  is_test_account boolean NOT NULL DEFAULT true CHECK (is_test_account = true),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vp_demo_account_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_demo_bank_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vp_demo_account_applications FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON public.vp_demo_bank_accounts FROM PUBLIC, anonymous, authenticated;

CREATE OR REPLACE FUNCTION public.vp_customer_open_demo_account(
  p_currency_code text,
  p_country_code text,
  p_customer_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_account public.vp_customer_accounts%ROWTYPE;
  v_application public.vp_demo_account_applications%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required' USING ERRCODE = '42501'; END IF;
  IF p_currency_code NOT IN ('GBP','USD','EUR','NGN') THEN RAISE EXCEPTION 'Unsupported currency' USING ERRCODE = '22023'; END IF;
  IF p_country_code IS NULL OR p_country_code !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Use a two-letter country code' USING ERRCODE = '22023'; END IF;
  IF p_customer_note IS NOT NULL AND length(p_customer_note) > 500 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_account FROM public.vp_customer_accounts WHERE user_id = v_user;
  IF NOT FOUND OR v_account.account_status <> 'active' THEN
    RAISE EXCEPTION 'Your VantagePay customer profile must be approved before applying' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.vp_demo_account_applications
    (user_id, currency_code, country_code, customer_note, application_status, review_reason, reviewed_by, reviewed_at, updated_at)
  VALUES (v_user, p_currency_code, p_country_code, NULLIF(btrim(p_customer_note), ''), 'pending', NULL, NULL, NULL, now())
  ON CONFLICT (user_id) DO UPDATE
    SET currency_code = EXCLUDED.currency_code,
        country_code = EXCLUDED.country_code,
        customer_note = EXCLUDED.customer_note,
        application_status = 'pending',
        review_reason = NULL,
        reviewed_by = NULL,
        reviewed_at = NULL,
        updated_at = now()
    WHERE public.vp_demo_account_applications.application_status = 'rejected'
  RETURNING * INTO v_application;

  IF NOT FOUND THEN
    SELECT * INTO v_application FROM public.vp_demo_account_applications WHERE user_id = v_user;
    IF v_application.application_status = 'approved' THEN
      RETURN jsonb_build_object('application', to_jsonb(v_application), 'message', 'A sandbox account has already been approved.');
    END IF;
    RETURN jsonb_build_object('application', to_jsonb(v_application), 'message', 'An account application is already awaiting review.');
  END IF;

  INSERT INTO public.vp_customer_notifications(user_id, notification_type, title, message)
  VALUES (v_user, 'account', 'Sandbox account application received',
    'Your VantagePay test-account application was received and is awaiting review. This is a simulated environment, not a bank account.');
  RETURN jsonb_build_object('application', to_jsonb(v_application), 'message', 'Sandbox account application submitted for review.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.vp_customer_demo_bank_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_application public.vp_demo_account_applications%ROWTYPE;
  v_bank_account public.vp_demo_bank_accounts%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_application FROM public.vp_demo_account_applications WHERE user_id = v_user;
  SELECT * INTO v_bank_account FROM public.vp_demo_bank_accounts WHERE user_id = v_user;
  RETURN jsonb_build_object(
    'application', CASE WHEN v_application.id IS NULL THEN NULL ELSE to_jsonb(v_application) END,
    'account', CASE WHEN v_bank_account.id IS NULL THEN NULL ELSE to_jsonb(v_bank_account) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.vp_admin_list_demo_account_applications()
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
  SELECT admin_role INTO v_role FROM public.vp_admin_memberships
  WHERE user_id = v_actor AND enabled = TRUE LIMIT 1;
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
    ORDER BY a.created_at DESC LIMIT 200
  ) q;
  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vp_admin_review_demo_account_application(
  p_application_id uuid,
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
  v_app public.vp_demo_account_applications%ROWTYPE;
  v_account public.vp_demo_bank_accounts%ROWTYPE;
BEGIN
  SELECT admin_role INTO v_role FROM public.vp_admin_memberships
  WHERE user_id = v_actor AND enabled = TRUE LIMIT 1;
  IF v_actor IS NULL OR v_role NOT IN ('operations','finance','super_admin') THEN
    RAISE EXCEPTION 'Enabled operations, finance, or super-admin access is required' USING ERRCODE = '42501';
  END IF;
  IF p_next_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Choose approve or reject' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 8 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'An audit reason of 8 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_app FROM public.vp_demo_account_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002'; END IF;
  IF v_app.application_status <> 'pending' THEN RAISE EXCEPTION 'Only pending applications can be reviewed' USING ERRCODE = '55000'; END IF;

  UPDATE public.vp_demo_account_applications
  SET application_status = p_next_status, review_reason = btrim(p_reason),
      reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
  WHERE id = p_application_id RETURNING * INTO v_app;

  IF p_next_status = 'approved' THEN
    INSERT INTO public.vp_demo_bank_accounts(user_id, application_id, account_number, currency_code)
    VALUES (
      v_app.user_id, v_app.id,
      'TEST' || lpad((('x' || substr(md5(gen_random_uuid()::text),1,8))::bit(32)::bigint % 100000000)::text,8,'0'),
      v_app.currency_code
    )
    ON CONFLICT (user_id) DO NOTHING
    RETURNING * INTO v_account;
    IF v_account.id IS NULL THEN SELECT * INTO v_account FROM public.vp_demo_bank_accounts WHERE user_id = v_app.user_id; END IF;
  END IF;

  INSERT INTO public.vp_admin_audit_log
    (actor_user_id, action, target_type, target_reference, reason, before_state, after_state)
  VALUES (v_actor,
    CASE WHEN p_next_status = 'approved' THEN 'demo_account_application_approved' ELSE 'demo_account_application_rejected' END,
    'demo_account_application', v_app.id::text, btrim(p_reason),
    jsonb_build_object('application_status','pending'),
    jsonb_build_object('application_status',p_next_status,'test_account_issued',p_next_status='approved'));

  INSERT INTO public.vp_customer_notifications(user_id, notification_type, title, message)
  VALUES (v_app.user_id, 'account',
    CASE WHEN p_next_status='approved' THEN 'VantagePay sandbox account approved' ELSE 'VantagePay account application declined' END,
    CASE WHEN p_next_status='approved'
      THEN 'Your simulated VantagePay test account has been created. It is not a real bank account and cannot receive or send real money.'
      ELSE 'Your VantagePay sandbox account application was declined. Review the admin note and contact support if needed.' END);

  RETURN jsonb_build_object('application',to_jsonb(v_app),'account',CASE WHEN v_account.id IS NULL THEN NULL ELSE to_jsonb(v_account) END);
END;
$function$;

REVOKE ALL ON FUNCTION public.vp_customer_open_demo_account(text,text,text) FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.vp_customer_demo_bank_account() FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.vp_admin_list_demo_account_applications() FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.vp_admin_review_demo_account_application(uuid,text,text) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.vp_customer_open_demo_account(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vp_customer_demo_bank_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vp_admin_list_demo_account_applications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vp_admin_review_demo_account_application(uuid,text,text) TO authenticated;

COMMIT;
