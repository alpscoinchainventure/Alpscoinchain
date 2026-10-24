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

1. **Anonymous execution grants:** Supabase Security Advisor originally flagged multiple `SECURITY DEFINER` functions. The definitions for the following RPCs were inspected and each checks `auth.uid()`; admin actions also check the caller's admin profile:
   - `public.admin_list_client_kyc_status()`
   - `public.admin_review_fund_request(uuid, text, text)`
   - `public.admin_review_kyc(uuid, text, text)`
   - `public.admin_update_client_kyc_status(uuid, text, text, boolean)`
   - `public.submit_kyc(text, date, text, text, text)`

   A migration named `revoke_anon_execute_from_authenticated_rpcs` has been applied to revoke `EXECUTE` from `anon` for those five RPCs. A follow-up SQL query confirmed the `anon` grant is absent and grants to `authenticated` and `service_role` remain.

2. **Remaining SECURITY DEFINER review:** Security Advisor still flags 18 functions executable by `authenticated` and five functions callable by `anon`. Several remaining anonymous entries appear to be trigger helpers (including `require_approved_kyc_for_fund_request`, `sync_profile_kyc_status`, `sync_profile_kyc_status_on_submission`, and `validate_fund_request_beneficiary`) or an event trigger (`rls_auto_enable`). Do not revoke or alter these blindly: trigger execution and event-trigger behavior differ from directly callable RPCs. Continue inspecting each definition, grant, trigger binding, and intended caller before changing permissions. Authenticated admin RPCs generally should retain explicit in-function authorization checks, and access should be limited to the minimum necessary roles.

3. `public.admin_action_audit` has RLS enabled but no policies. This prevents accidental row access but means intended audit access is not fully defined. Design an explicit privileged read model before exposing audit records.

4. **Leaked-password protection is disabled** in Supabase Auth. Enable it in Auth password/security settings before onboarding real users.

5. Review RLS policies on every exposed table, especially ledger entries, profiles, KYC metadata, fund requests, beneficiaries, deposit wallet addresses, and audit tables. Confirm customers can access only their own rows and cannot change privileged columns such as role, KYC status, approval status, reviewer fields, balances, or ledger entries.

7. Review Storage bucket policies for KYC documents. Keep identity documents private and use short-lived signed URLs only after server-side authorization.

## Safe implementation order

1. Finish reviewing all flagged function bodies and grants, including cross-customer access and role checks. Do not blindly revoke all authenticated grants: some admin workflows may depend on functions.
2. Test as anonymous, ordinary authenticated customer, and authorized admin using non-sensitive test accounts. Include negative tests for cross-customer reads/writes and attempts to self-promote to admin or self-approve KYC/withdrawals.
3. Enable leaked-password protection; review email confirmation, password reset, session lifetime, rate limiting, and redirect allow-list settings.
4. Complete end-to-end Supabase Auth tests with a test account. Never ask users to share passwords, verification codes, reset links, or session tokens in chat.
5. Ensure profile creation is tied to `auth.users.id`; derive identity from the verified session, not a user-supplied ID.
6. Add a customer-only dashboard only after authorization and row-level access tests pass.
7. Keep balances derived from server-controlled ledger records. Customers must never write ledger entries or set their own balance. Deposits and withdrawals remain disabled until provider integration, reconciliation, legal authorization, and production controls are verified.
8. Re-run Supabase Security Advisor and automated tests before exposing signup broadly.

## Release gate

Do not describe VantagePay as a live bank or enable real-money movement based on this audit. A successful page response is not proof that authentication works. Mark each feature complete only after integration tests verify expected success paths and unauthorized/invalid cases.
