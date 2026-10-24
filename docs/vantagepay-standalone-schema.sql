-- VantagePay standalone financial-platform schema (design migration).
-- Apply ONLY to a dedicated VantagePay Supabase project after review.
-- Do not apply to the shared AlpsCoinChain project.
-- This schema does not make VantagePay a licensed bank or enable live money movement.
-- Money-moving writes must be performed by a trusted server/provider adapter only.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.vp_customer_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  account_reference TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (account_status IN ('pending','active','restricted','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provision a VantagePay account record after a user signs up in the
-- dedicated VantagePay Supabase Auth project. This does not grant permissions.
CREATE OR REPLACE FUNCTION public.vp_handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $
BEGIN
  INSERT INTO public.vp_customer_accounts (user_id, account_reference, display_name)
  VALUES (
    NEW.id,
    'VP-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 12)),
    left(coalesce(NEW.raw_user_meta_data ->> 'full_name', ''), 120)
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$;

REVOKE EXECUTE ON FUNCTION public.vp_handle_new_auth_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vp_on_auth_user_created ON auth.users;
CREATE TRIGGER vp_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.vp_handle_new_auth_user();

CREATE TABLE IF NOT EXISTS public.vp_admin_memberships (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  admin_role TEXT NOT NULL CHECK (admin_role IN ('support','operations','finance','super_admin')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Store only a provider-issued token and masked details. Never store raw bank
-- account credentials, online-banking passwords, PINs, or card security codes.
CREATE TABLE IF NOT EXISTS public.vp_beneficiary_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider_code TEXT NOT NULL,
  provider_beneficiary_token TEXT NOT NULL,
  beneficiary_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  account_last4 CHAR(4),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','rejected','disabled')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_code, provider_beneficiary_token)
);

CREATE UNIQUE INDEX IF NOT EXISTS vp_one_default_beneficiary_per_user
  ON public.vp_beneficiary_accounts(user_id) WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS public.vp_transaction_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_reference TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('deposit','withdrawal')),
  amount_minor_units NUMERIC(36,0) NOT NULL CHECK (amount_minor_units > 0),
  currency_code CHAR(3) NOT NULL,
  beneficiary_id UUID REFERENCES public.vp_beneficiary_accounts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','under_review','submitted','settled','failed','rejected','cancelled','reversed')),
  provider_reference TEXT UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_note TEXT,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  CHECK (
    (request_type = 'withdrawal' AND beneficiary_id IS NOT NULL)
    OR request_type = 'deposit'
  )
);

CREATE INDEX IF NOT EXISTS vp_transaction_requests_user_date_idx
  ON public.vp_transaction_requests(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.vp_ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_reference TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'deposit_settlement','withdrawal_reservation','withdrawal_settlement',
    'withdrawal_release','withdrawal_reversal','manual_adjustment',
    'apy_credit','apy_reversal','fee'
  )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','posted','reversed','failed')),
  currency_code CHAR(3) NOT NULL,
  amount_minor_units NUMERIC(36,0) NOT NULL CHECK (amount_minor_units > 0),
  source_system TEXT,
  source_reference TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (status <> 'posted' OR posted_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS vp_ledger_source_reference_unique
  ON public.vp_ledger_transactions(source_system, source_reference)
  WHERE source_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vp_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.vp_ledger_transactions(id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('debit','credit')),
  currency_code CHAR(3) NOT NULL,
  amount_minor_units NUMERIC(36,0) NOT NULL CHECK (amount_minor_units > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(transaction_id, account_code, side)
);

CREATE INDEX IF NOT EXISTS vp_ledger_entries_transaction_idx
  ON public.vp_ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS vp_ledger_entries_account_idx
  ON public.vp_ledger_entries(account_code, currency_code, created_at DESC);

-- Source events are internal integration records. APY is posted only after
-- authoritative source reconciliation and an authorized, idempotent posting.
-- Link an external investment-provider customer reference to a VantagePay
-- user. Create/disable these mappings only through an audited trusted admin flow.
CREATE TABLE IF NOT EXISTS public.vp_external_account_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code TEXT NOT NULL,
  external_customer_reference TEXT NOT NULL,
  vantagepay_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(provider_code, external_customer_reference)
);

ALTER TABLE public.vp_external_account_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vp_external_account_links FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.vp_apy_source_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_customer_reference TEXT NOT NULL,
  vantagepay_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  period_start DATE,
  period_end DATE,
  currency_code CHAR(3) NOT NULL,
  amount_minor_units NUMERIC(36,0) NOT NULL CHECK (amount_minor_units > 0),
  rate_basis_points INTEGER CHECK (rate_basis_points >= 0 AND rate_basis_points <= 100000),
  source_status TEXT NOT NULL CHECK (source_status IN ('received','verified','rejected','posted','reversed')),
  source_payload_hash TEXT NOT NULL,
  source_occurred_at TIMESTAMPTZ NOT NULL,
  ledger_transaction_id UUID REFERENCES public.vp_ledger_transactions(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  UNIQUE(provider_code, source_event_id)
);

CREATE TABLE IF NOT EXISTS public.vp_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_reference TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all customer/admin data tables.
ALTER TABLE public.vp_customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_admin_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_beneficiary_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_transaction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_apy_source_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Customers can read only their own account and beneficiary metadata.
DROP POLICY IF EXISTS vp_customer_reads_own_account ON public.vp_customer_accounts;
CREATE POLICY vp_customer_reads_own_account ON public.vp_customer_accounts
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS vp_admin_reads_own_membership ON public.vp_admin_memberships;
CREATE POLICY vp_admin_reads_own_membership ON public.vp_admin_memberships
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id AND enabled = TRUE);

DROP POLICY IF EXISTS vp_customer_reads_own_beneficiaries ON public.vp_beneficiary_accounts;
CREATE POLICY vp_customer_reads_own_beneficiaries ON public.vp_beneficiary_accounts
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS vp_customer_reads_own_requests ON public.vp_transaction_requests;
CREATE POLICY vp_customer_reads_own_requests ON public.vp_transaction_requests
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS vp_customer_reads_own_transactions ON public.vp_ledger_transactions;
CREATE POLICY vp_customer_reads_own_transactions ON public.vp_ledger_transactions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS vp_customer_reads_own_ledger_entries ON public.vp_ledger_entries;
CREATE POLICY vp_customer_reads_own_ledger_entries ON public.vp_ledger_entries
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vp_ledger_transactions t
      WHERE t.id = transaction_id AND t.user_id = (SELECT auth.uid())
    )
  );

-- Deliberately no authenticated write policies for ledger, APY, payout requests,
-- beneficiary records, audit logs, or admin membership. Trusted server code
-- must authenticate the user, authorize the operation, and write atomically.
-- Service-role credentials must never be exposed in the browser.

REVOKE ALL ON public.vp_customer_accounts FROM anon, authenticated;
REVOKE ALL ON public.vp_admin_memberships FROM anon, authenticated;
REVOKE ALL ON public.vp_beneficiary_accounts FROM anon, authenticated;
REVOKE ALL ON public.vp_transaction_requests FROM anon, authenticated;
REVOKE ALL ON public.vp_ledger_transactions FROM anon, authenticated;
REVOKE ALL ON public.vp_ledger_entries FROM anon, authenticated;
REVOKE ALL ON public.vp_apy_source_events FROM anon, authenticated;
REVOKE ALL ON public.vp_external_account_links FROM anon, authenticated;
REVOKE ALL ON public.vp_admin_audit_log FROM anon, authenticated;

GRANT SELECT ON public.vp_customer_accounts TO authenticated;
GRANT SELECT ON public.vp_admin_memberships TO authenticated;
GRANT SELECT ON public.vp_beneficiary_accounts TO authenticated;
GRANT SELECT ON public.vp_transaction_requests TO authenticated;
GRANT SELECT ON public.vp_ledger_transactions TO authenticated;
GRANT SELECT ON public.vp_ledger_entries TO authenticated;

COMMIT;

-- Ledger convention: customer liability account codes use 'customer:' || auth user UUID.
-- For each posted journal, calculate a displayed customer balance as credits minus debits
-- on that account code, grouped by currency; never derive balances from request rows.
-- Required before production:
-- 1) Apply only to the dedicated VantagePay Supabase project; review project cost first.
-- 2) Add server-side authenticated routes/provider adapters for beneficiary verification,
--    deposit reconciliation, withdrawal requests, status webhooks and safe cancellations.
-- 3) Enforce atomic balanced journal posting and prevent UPDATE/DELETE of posted entries.
-- 4) Add account-ownership checks, admin role authorization and audit logging on every write.
-- 5) Verify APY events against authoritative provider records before posting; never trust
--    browser input or a webhook alone. Reconcile duplicates and reversals.
-- 6) Add provider sandbox tests, backups, monitoring, incident procedures, legal review,
--    and independent security review before real funds are accepted or moved.
