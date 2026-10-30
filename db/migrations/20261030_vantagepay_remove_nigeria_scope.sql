-- VantagePay market scope: exclude Nigeria and NGN from sandbox account opening.
-- Existing customer records are preserved; no historical data is deleted.
BEGIN;

ALTER TABLE public.vp_demo_account_applications
  DROP CONSTRAINT IF EXISTS vp_demo_account_applications_currency_code_check,
  DROP CONSTRAINT IF EXISTS vp_demo_account_applications_country_code_check;
ALTER TABLE public.vp_demo_account_applications
  ADD CONSTRAINT vp_demo_account_applications_currency_code_check
    CHECK (currency_code IN ('GBP','USD','EUR')),
  ADD CONSTRAINT vp_demo_account_applications_country_code_check
    CHECK (country_code ~ '^[A-Z]{2}$' AND country_code <> 'NG');

ALTER TABLE public.vp_demo_bank_accounts
  DROP CONSTRAINT IF EXISTS vp_demo_bank_accounts_currency_code_check;
ALTER TABLE public.vp_demo_bank_accounts
  ADD CONSTRAINT vp_demo_bank_accounts_currency_code_check
    CHECK (currency_code IN ('GBP','USD','EUR'));

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
  IF p_currency_code NOT IN ('GBP','USD','EUR') THEN RAISE EXCEPTION 'Unsupported currency' USING ERRCODE = '22023'; END IF;
  IF p_country_code IS NULL OR p_country_code !~ '^[A-Z]{2}$' OR p_country_code = 'NG' THEN
    RAISE EXCEPTION 'Use an eligible two-letter country code' USING ERRCODE = '22023';
  END IF;
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
  VALUES (v_user, 'security', 'Sandbox account application received',
    'Your VantagePay test-account application was received and is awaiting review. This is a simulated environment, not a bank account.');
  RETURN jsonb_build_object('application', to_jsonb(v_application), 'message', 'Sandbox account application submitted for review.');
END;
$function$;

COMMIT;
