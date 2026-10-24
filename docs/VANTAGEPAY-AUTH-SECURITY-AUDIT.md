# VantagePay Authentication and Security Audit (2026-10-24)

## Scope and status

This is a configuration/schema audit of the connected Supabase project named "Alpscoinchain Investment Ventures" (project ref `uevofmlzpwrdidjnwxfd`) and the VantagePay integration branch. It is not a penetration test. A successful HTTP response proves that the page is served, not that a user can complete authentication or that every database permission is safe.

## Current implementation and deployment checks

- Supabase project is active and healthy.
- The customer authentication page `vantagepay-auth.html` is committed on `vantagepay-integration-plan` and the current Vercel preview serves it with HTTP 200.
- Verified page response contains the Supabase client, sign-up/sign-in controls, password reset, and the notice that balances and money movement are not enabled.
- The VantagePay demo page links to the authentication page. The demo uses fictional browser-side data only.\n- Added `vantagepay-dashboard.html`, a session-guarded, read-only customer dashboard. It queries the signed-in user's profile with `id = auth user id` and ledger entries with `user_id = auth user id`; it does not create or alter records and does not calculate or display a balance.\n- Added an explicit Express route for the dashboard and a link from the signed-in authentication view.\n- Latest Vercel preview is READY; smoke fetches returned HTTP 200 for authentication, dashboard, and demo pages.\n- Latest GitHub Actions validation workflow completed successfully after adding dashboard script syntax, session-guard, read-only query, and route checks.
- GitHub Actions validation workflow for commit `b4489ca2eadb8a5e8f34041a46e39a2f7ba749c6` completed successfully.
- Registration, confirmation-email delivery, sign-in, and password-reset email have **not** been end-to-end tested with a real test account. Redirect allow-list and email provider settings may still need adjustment.
- Existing schema includes `profiles`, `fund_requests`, `ledger_entries`, `beneficiaries`, `kyc_submissions`, `test_deposits`, `test_withdrawals`, and `test_transactions`. Tables with `test_*` names are not production financial records.

## Security findings and actions

1. **Anonymous execution grants reduced.** The definitions and trigger bindings for the following five SECURITY DEFINER helper functions were inspected. They are bound to table triggers or a DDL event trigger, not intended as public RPCs:
   - `public.require_approved_kyc_for_fund_request()`
   - `public.rls_auto_enable()` (bound to event trigger `ensure_rls`)
   - `public.sync_profile_kyc_status()`
   - `public.sync_profile_kyc_status_on_submission()`
   - `public.validate_fund_request_beneficiary()`

   A migration named `restrict_trigger_helper_execution` revoked direct EXECUTE grants from `PUBLIC`, `anon`, `authenticated`, and `service_role` for these helpers. A follow-up query confirmed their ACLs now grant execute only to `postgres`; the four table-trigger bindings remain present. The DDL event trigger `ensure_rls` was separately verified as bound to `rls_auto_enable()`. Security Advisor no longer reports anonymous-callable SECURITY DEFINER functions.

2. **Test request policies hardened.** A migration named `tighten_test_financial_request_rls` changed client-created `test_deposits` and `test_withdrawals` inserts to require `user_id = auth.uid()`, `status = 'pending'`, and `reviewed_at IS NULL`. Admin select/update policies for `test_deposits`, `test_withdrawals`, and `test_transactions` now require both `role = 'admin'` and an active account status. A follow-up query verified the expected policies. These are test tables; this does not enable real deposits or withdrawals.

3. **Remaining authenticated SECURITY DEFINER functions.** The latest Security Advisor reports 13 functions executable by `authenticated`: `admin_adjust_client_balance`, `admin_list_balance_adjustments`, `admin_list_beneficiaries`, `admin_list_client_kyc_status`, `admin_list_profiles`, `admin_post_ledger_entry`, `admin_preview_client_balance`, `admin_review_fund_request`, `admin_review_kyc`, `admin_review_test_deposit`, `admin_update_client_kyc_status`, `submit_kyc`, and `update_my_profile_name`. The inspected function definitions include caller identity checks and, for privileged administrative operations, admin/account-status checks. The profile-name helper is intended to update the caller's own name; `submit_kyc` is a signed-in customer workflow. Keep these grants only if the functions are needed, and continue testing unauthorized and cross-customer calls. The advisor finding alone is not proof of an exploit, but these functions are privileged and require careful review.

4. **Profile table grants are restrictive.** The inspected `public.profiles` table grants `authenticated` table-level SELECT only; no authenticated UPDATE grant was present. Although a self-update RLS policy exists, the inspected Data API privileges do not currently permit authenticated users to update profile rows. Do not grant broad UPDATE access: fields such as `role`, `account_status`, and `kyc_status` are privileged. Use a narrow, reviewed column/function path if profile editing is added later.

5. `public.admin_action_audit` has RLS enabled but no policies. This currently blocks normal row access but leaves intended privileged audit access undefined. Design and test a least-privilege read model before exposing audit records.

6. **Leaked-password protection remains disabled** in Supabase Auth. Enable it in Auth password/security settings before onboarding real users. The available project tools do not expose that Auth security setting, so it has not been changed here.

7. Review RLS policies on all exposed tables, especially ledger entries, profiles, KYC metadata, fund requests, beneficiaries, test financial requests, and audit tables. Confirm ordinary customers can access only their own rows and cannot change role, KYC status, approval status, reviewer fields, balances, or ledger entries.

8. Review Storage bucket policies for KYC documents. Keep identity documents private and use short-lived signed URLs only after server-side authorization.

## Safe implementation order

1. Finish reviewing all flagged function bodies and grants, including cross-customer access and role checks. Do not blindly revoke all authenticated grants: some admin workflows may depend on functions.
2. Test as anonymous, ordinary authenticated customer, and authorized admin using non-sensitive test accounts. Include negative tests for cross-customer reads/writes and attempts to self-promote to admin or self-approve KYC/withdrawals.
3. Enable leaked-password protection; review email confirmation, password reset, session lifetime, rate limiting, and redirect allow-list settings.
4. Complete end-to-end Supabase Auth tests with a test account. Never ask users to share passwords, verification codes, reset links, or session tokens in chat.
5. Ensure profile creation is tied to `auth.users.id`; derive identity from the verified session, not a user-supplied ID.
6. A read-only session-guarded dashboard is now deployed, but test with an ordinary customer and a second account to verify cross-customer isolation; static smoke tests are not a penetration test.
7. Keep balances derived from server-controlled ledger records. Customers must never write ledger entries or set their own balance. Deposits and withdrawals remain disabled until provider integration, reconciliation, legal authorization, and production controls are verified.
8. Re-run Supabase Security Advisor and automated tests before exposing signup broadly.

## Release gate

Do not describe VantagePay as a live bank or enable real-money movement based on this audit. A successful page response is not proof that authentication works. Mark each feature complete only after integration tests verify expected success paths and unauthorized/invalid cases.
