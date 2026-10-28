-- VantagePay admin balance-adjustment hardening.
-- Review and test on an isolated Neon branch before applying to the shared/main branch.
-- Customer credits fail closed until an authoritative funding/reconciliation source is implemented.
-- This RPC records internal ledger entries only; it never moves external money.
BEGIN;

ALTER TABLE public.vp_ledger_transactions
  DROP CONSTRAINT IF EXISTS vp_ledger_transactions_transaction_type_check;

ALTER TABLE public.vp_ledger_transactions
  ADD CONSTRAINT vp_ledger_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'investment_withdrawal_settlement',
    'investment_withdrawal_reversal',
    'customer_payout_pending',
    'customer_payout_settled',
    'customer_payout_failed',
    'admin_balance_adjustment'
  ]));

CREATE OR REPLACE FUNCTION public.vp_admin_post_balance_adjustment(p_customer_ref text, p_asset_code text, p_side text, p_amount_units numeric, p_external_reference text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid;
  v_customer_user uuid;
  v_account_status text;
  v_tx_id bigint;
  v_existing public.vp_ledger_transactions%ROWTYPE;
  v_customer_side text;
  v_control_side text;
  v_existing_customer_amount numeric;
  v_existing_customer_side text;
  v_existing_control_amount numeric;
  v_existing_control_side text;
  v_customer_balance numeric;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vp_admin_memberships m
    WHERE m.user_id=v_actor AND m.enabled=true
      AND m.admin_role IN ('operations','finance','super_admin')
  ) THEN
    RAISE EXCEPTION 'admin_membership_required' USING ERRCODE='42501';
  END IF;

  IF p_customer_ref IS NULL OR length(btrim(p_customer_ref))=0 OR length(p_customer_ref)>200
    OR p_asset_code IS NULL OR p_side NOT IN ('credit','debit')
    OR p_amount_units IS NULL OR p_amount_units<=0 OR p_amount_units<>trunc(p_amount_units)
    OR p_external_reference IS NULL OR length(btrim(p_external_reference))<8 OR length(p_external_reference)>200
    OR p_reason IS NULL OR length(btrim(p_reason))<12 OR length(p_reason)>1000 THEN
    RAISE EXCEPTION 'invalid_adjustment_parameters' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vp_asset_definitions a
    WHERE a.asset_code=p_asset_code AND a.enabled=true
  ) THEN
    RAISE EXCEPTION 'asset_not_enabled' USING ERRCODE='22023';
  END IF;

  SELECT ca.user_id, ca.account_status
    INTO v_customer_user, v_account_status
  FROM public.vp_customer_accounts ca
  WHERE ca.account_reference=p_customer_ref
  FOR UPDATE;

  IF NOT FOUND OR v_account_status <> 'active' THEN
    RAISE EXCEPTION 'customer_account_not_active' USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_external_reference, 0));

  SELECT * INTO v_existing
  FROM public.vp_ledger_transactions tx
  WHERE tx.external_reference=p_external_reference;

  v_customer_side := p_side;
  v_control_side := CASE WHEN p_side='credit' THEN 'debit' ELSE 'credit' END;

  IF FOUND THEN
    SELECT e.amount_units, e.entry_side INTO v_existing_customer_amount, v_existing_customer_side
    FROM public.vp_ledger_entries e
    WHERE e.transaction_id=v_existing.id
      AND e.account_code='customer:'||v_customer_user::text
      AND e.asset_code=p_asset_code
    LIMIT 1;

    SELECT e.amount_units, e.entry_side INTO v_existing_control_amount, v_existing_control_side
    FROM public.vp_ledger_entries e
    WHERE e.transaction_id=v_existing.id
      AND e.account_code='admin_adjustment_control'
      AND e.asset_code=p_asset_code
    LIMIT 1;

    IF v_existing.transaction_type='admin_balance_adjustment'
      AND v_existing.customer_ref=p_customer_ref
      AND v_existing.asset_code=p_asset_code
      AND v_existing.status='posted'
      AND v_existing_customer_amount=p_amount_units
      AND v_existing_customer_side=v_customer_side
      AND v_existing_control_amount=p_amount_units
      AND v_existing_control_side=v_control_side THEN
      RETURN jsonb_build_object('success',true,'duplicate',true,'transaction_id',v_existing.id,'status','posted');
    END IF;

    RAISE EXCEPTION 'external_reference_already_used_or_payload_mismatch' USING ERRCODE='23505';
  END IF;

  -- Fail closed: customer credits require a verified funding/reconciliation source.
  IF p_side='credit' THEN
    RAISE EXCEPTION 'credit_source_not_configured' USING ERRCODE='55000';
  END IF;

  -- A debit must never make the customer's posted ledger balance negative.
  SELECT coalesce(sum(CASE WHEN e.entry_side='credit' THEN e.amount_units ELSE -e.amount_units END),0)
    INTO v_customer_balance
  FROM public.vp_ledger_entries e
  WHERE e.account_code='customer:'||v_customer_user::text
    AND e.asset_code=p_asset_code;

  IF p_side='debit' AND v_customer_balance < p_amount_units THEN
    RAISE EXCEPTION 'insufficient_customer_balance' USING ERRCODE='23514';
  END IF;

  INSERT INTO public.vp_ledger_transactions
    (external_reference,customer_ref,asset_code,transaction_type,status,posted_at)
  VALUES
    (p_external_reference,p_customer_ref,p_asset_code,'admin_balance_adjustment','posted',pg_catalog.now())
  RETURNING id INTO v_tx_id;

  INSERT INTO public.vp_ledger_entries
    (transaction_id,account_code,asset_code,entry_side,amount_units)
  VALUES
    (v_tx_id,'customer:'||v_customer_user::text,p_asset_code,v_customer_side,p_amount_units),
    (v_tx_id,'admin_adjustment_control',p_asset_code,v_control_side,p_amount_units);

  IF (SELECT count(*) FROM public.vp_ledger_entries e WHERE e.transaction_id=v_tx_id) <> 2
    OR (SELECT coalesce(sum(CASE WHEN e.entry_side='debit' THEN e.amount_units ELSE -e.amount_units END),0)
        FROM public.vp_ledger_entries e WHERE e.transaction_id=v_tx_id) <> 0 THEN
    RAISE EXCEPTION 'ledger_not_balanced' USING ERRCODE='23514';
  END IF;

  INSERT INTO public.vp_admin_audit_log
    (actor_user_id,action,target_type,target_reference,reason,before_state,after_state,request_id)
  VALUES
    (v_actor,'admin_balance_adjustment','customer_account',p_customer_ref,btrim(p_reason),NULL,
     pg_catalog.jsonb_build_object(
       'transaction_id',v_tx_id,'asset_code',p_asset_code,'side',p_side,
       'amount_units',p_amount_units,'external_reference',p_external_reference,
       'counter_account','admin_adjustment_control','funds_transfer_executed',false
     ),p_external_reference);

  RETURN pg_catalog.jsonb_build_object(
    'success',true,'duplicate',false,'transaction_id',v_tx_id,'status','posted',
    'asset_code',p_asset_code,'amount_units',p_amount_units,'side',p_side,
    'funds_transfer_executed',false
  );
END;
$function$


REVOKE ALL ON FUNCTION public.vp_admin_post_balance_adjustment(text,text,text,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vp_admin_post_balance_adjustment(text,text,text,numeric,text,text) TO authenticated;

COMMIT;
