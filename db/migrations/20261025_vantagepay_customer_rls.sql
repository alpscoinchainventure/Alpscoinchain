-- VantagePay customer-facing Data API lockdown and least-privilege grants.
-- Apply only to the dedicated VantagePay Neon database.
BEGIN;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anonymous, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anonymous, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public REVOKE ALL ON TABLES FROM anonymous, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anonymous, authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Every VantagePay table is private unless a narrowly scoped policy below permits access.
ALTER TABLE public.vp_admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_admin_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_apy_source_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_asset_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_beneficiary_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_customer_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_external_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_external_reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_transaction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_webhook_inbox ENABLE ROW LEVEL SECURITY;

-- Customer account: read only the authenticated user's own row.
GRANT SELECT ON public.vp_customer_accounts TO authenticated;
DROP POLICY IF EXISTS vp_customer_accounts_read_own ON public.vp_customer_accounts;
CREATE POLICY vp_customer_accounts_read_own ON public.vp_customer_accounts
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.user_id()::uuid));

-- Notifications: own rows only; the only writable column is read_at.
GRANT SELECT ON public.vp_customer_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.vp_customer_notifications TO authenticated;
DROP POLICY IF EXISTS vp_customer_notifications_read_own ON public.vp_customer_notifications;
CREATE POLICY vp_customer_notifications_read_own ON public.vp_customer_notifications
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.user_id()::uuid));
DROP POLICY IF EXISTS vp_customer_notifications_mark_own_read ON public.vp_customer_notifications;
CREATE POLICY vp_customer_notifications_mark_own_read ON public.vp_customer_notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.user_id()::uuid))
  WITH CHECK (user_id = (SELECT auth.user_id()::uuid));

-- Admin membership: users can inspect only their own membership; clients cannot grant roles.
GRANT SELECT ON public.vp_admin_memberships TO authenticated;
DROP POLICY IF EXISTS vp_admin_memberships_read_own ON public.vp_admin_memberships;
CREATE POLICY vp_admin_memberships_read_own ON public.vp_admin_memberships
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.user_id()::uuid));

-- Beneficiary details are read-only and isolated by owner until provider linking is reviewed.
GRANT SELECT ON public.vp_beneficiary_accounts TO authenticated;
DROP POLICY IF EXISTS vp_beneficiaries_read_own ON public.vp_beneficiary_accounts;
CREATE POLICY vp_beneficiaries_read_own ON public.vp_beneficiary_accounts
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.user_id()::uuid));

-- Transaction requests: own rows only. Insert is column-limited and restricted to pending requests.
GRANT SELECT ON public.vp_transaction_requests TO authenticated;
GRANT INSERT (request_reference,user_id,request_type,amount_minor_units,currency_code,beneficiary_id,idempotency_key,customer_note,status)
  ON public.vp_transaction_requests TO authenticated;
DROP POLICY IF EXISTS vp_transaction_requests_read_own ON public.vp_transaction_requests;
CREATE POLICY vp_transaction_requests_read_own ON public.vp_transaction_requests
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.user_id()::uuid));
DROP POLICY IF EXISTS vp_transaction_requests_insert_own_pending ON public.vp_transaction_requests;
CREATE POLICY vp_transaction_requests_insert_own_pending ON public.vp_transaction_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.user_id()::uuid)
    AND status = 'pending'
    AND request_type IN ('deposit','withdrawal')
    AND amount_minor_units > 0
    AND currency_code IN ('GBP','USD','EUR','NGN')
  );

COMMIT;
