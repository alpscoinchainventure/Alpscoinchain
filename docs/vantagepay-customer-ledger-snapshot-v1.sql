-- VantagePay customer ledger read API, version 1.
-- Read-only SECURITY DEFINER function; never posts or modifies money.
CREATE OR REPLACE FUNCTION public.vp_customer_ledger_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_account_ref TEXT;
  v_transactions JSONB;
  v_balances JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in user is required' USING ERRCODE = '42501';
  END IF;

  SELECT a.account_reference INTO v_account_ref
  FROM public.vp_customer_accounts AS a
  WHERE a.user_id = v_user_id;

  IF v_account_ref IS NULL THEN
    RETURN jsonb_build_object('transactions', '[]'::jsonb, 'balances', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_transactions
  FROM (
    SELECT
      tx.id,
      tx.external_reference AS transaction_reference,
      tx.transaction_type,
      tx.status,
      tx.created_at,
      tx.posted_at,
      COALESCE(e.asset_code, tx.asset_code) AS asset_code,
      COALESCE(e.amount_units, 0)::text AS amount_units,
      COALESCE(ad.minor_unit_scale, 2) AS minor_unit_scale
    FROM public.vp_ledger_transactions AS tx
    LEFT JOIN LATERAL (
      SELECT le.asset_code,
             SUM(CASE WHEN le.entry_side = 'credit' THEN le.amount_units ELSE -le.amount_units END) AS amount_units
      FROM public.vp_ledger_entries AS le
      WHERE le.transaction_id = tx.id
        AND le.account_code = 'customer:' || v_user_id::text
      GROUP BY le.asset_code
      ORDER BY le.asset_code
      LIMIT 1
    ) AS e ON TRUE
    LEFT JOIN public.vp_asset_definitions AS ad
      ON ad.asset_code = COALESCE(e.asset_code, tx.asset_code)
    WHERE tx.customer_ref = v_account_ref
    ORDER BY tx.created_at DESC
    LIMIT 100
  ) AS t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'asset_code', b.asset_code,
    'balance_units', b.balance_units::text,
    'minor_unit_scale', b.minor_unit_scale
  ) ORDER BY b.asset_code), '[]'::jsonb)
  INTO v_balances
  FROM (
    SELECT le.asset_code,
           SUM(CASE WHEN le.entry_side = 'credit' THEN le.amount_units ELSE -le.amount_units END) AS balance_units,
           COALESCE(ad.minor_unit_scale, 2) AS minor_unit_scale
    FROM public.vp_ledger_entries AS le
    JOIN public.vp_ledger_transactions AS tx ON tx.id = le.transaction_id
    LEFT JOIN public.vp_asset_definitions AS ad ON ad.asset_code = le.asset_code
    WHERE tx.customer_ref = v_account_ref
      AND tx.status = 'posted'
      AND le.account_code = 'customer:' || v_user_id::text
    GROUP BY le.asset_code, ad.minor_unit_scale
  ) AS b;

  RETURN jsonb_build_object(
    'transactions', COALESCE(v_transactions, '[]'::jsonb),
    'balances', COALESCE(v_balances, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.vp_customer_ledger_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vp_customer_ledger_snapshot() TO authenticated;
